/**
 * cluster.mjs — L3 Cluster Node Logic
 *
 * Transforms a P4 Edge node into an L3 Cluster participant.
 * Responsibilities:
 *   - Subscribe to GossipSub topics and collect messages
 *   - Maintain routing table (Map<PeerId, NodeInfo>)
 *   - Batch-sync buffered messages to L2 Backbone every N seconds
 *   - Expose cluster stats for dashboard rendering
 *
 * Can run:
 *   1. Inside Electron (as child module when user clicks "Upgrade to L3")
 *   2. Standalone on EC2 relay server (node cluster.mjs)
 */

const BACKBONE_URL = process.env.BACKBONE_URL || 'http://localhost:8000'
const BATCH_INTERVAL_MS = 10_000   // Sync to L2 every 10 seconds
const BATCH_MAX_SIZE = 50          // Max messages per batch
const PEER_TIMEOUT_MS = 30_000     // Mark peer stale after 30s
const STATS_INTERVAL_MS = 5_000    // Update internal stats every 5s

export class ClusterNode {
  constructor(nodeId, nodeName) {
    this.nodeId = nodeId
    this.nodeName = nodeName || `Cluster-${nodeId.substring(0, 8)}`
    this.role = 'cluster'  // L3

    // ── State ──────────────────────────────────────────────
    this.messageBuffer = new Map()      // UUID → message object (dedup)
    this.routingTable = new Map()       // PeerId → {name, lastSeen, route, role, ip}
    this.syncLog = []                   // last 100 sync results
    this.startedAt = Date.now()
    this.totalSynced = 0
    this.totalReceived = 0
    this.totalConflicts = 0
    this.backboneOnline = false

    // ── Timers ──────────────────────────────────────────────
    this.batchTimer = null
    this.statsTimer = null
  }

  /**
   * Initialize — start batch sync timer, check L2 connectivity
   */
  async init() {
    this.backboneOnline = await this._checkBackbone()
    if (this.backboneOnline) {
      console.log(`[L3 Cluster] Connected to L2 Backbone at ${BACKBONE_URL}`)
    } else {
      console.warn(`[L3 Cluster] L2 Backbone offline — buffering only`)
    }

    // Start batch sync timer
    this.batchTimer = setInterval(() => this._syncBatch(), BATCH_INTERVAL_MS)

    // Start stats/cleanup timer
    this.statsTimer = setInterval(() => this._cleanupStale(), STATS_INTERVAL_MS)

    // Retry backbone connection every 30s if offline
    if (!this.backboneOnline) {
      this._retryInterval = setInterval(async () => {
        if (!this.backboneOnline) {
          this.backboneOnline = await this._checkBackbone()
          if (this.backboneOnline) {
            console.log('[L3 Cluster] L2 Backbone reconnected!')
            clearInterval(this._retryInterval)
          }
        }
      }, 30_000)
    }

    return this.backboneOnline
  }

  /**
   * Called when a GossipSub message arrives.
   * Deduplicates by UUID and adds to buffer.
   */
  onMessage(msg) {
    if (!msg || !msg.text) return
    this.totalReceived++

    // Generate UUID if missing (older clients)
    const id = msg.id || `cluster-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`
    msg.id = id

    // Dedup — skip if already buffered or already synced
    if (this.messageBuffer.has(id)) return

    // Add cluster metadata
    msg.received_via = 'cluster'
    msg.cluster_node = this.nodeId
    msg.cluster_received_at = Date.now()

    this.messageBuffer.set(id, msg)
  }

  /**
   * Called when a peer connects/pings. Updates routing table.
   */
  updatePeer(peerId, info) {
    this.routingTable.set(peerId, {
      name: info.name || peerId.substring(0, 12),
      lastSeen: Date.now(),
      route: info.route || 'unknown',
      role: info.role || 'edge',  // edge | cluster | backbone
      ip: info.ip || null,
    })
  }

  /**
   * Called when a peer disconnects.
   */
  removePeer(peerId) {
    this.routingTable.delete(peerId)
  }

  /**
   * Get cluster stats for dashboard display
   */
  getStats() {
    const now = Date.now()
    const peers = []
    for (const [id, info] of this.routingTable) {
      peers.push({
        peerId: id.substring(0, 16) + '...',
        name: info.name,
        route: info.route,
        role: info.role,
        lastSeen: Math.round((now - info.lastSeen) / 1000) + 's ago',
        stale: (now - info.lastSeen) > PEER_TIMEOUT_MS,
      })
    }

    return {
      nodeId: this.nodeId,
      nodeName: this.nodeName,
      role: this.role,
      uptime: Math.round((now - this.startedAt) / 1000),
      uptimeFormatted: this._formatUptime(now - this.startedAt),
      backboneOnline: this.backboneOnline,
      backboneUrl: BACKBONE_URL,
      buffer: this.messageBuffer.size,
      totalReceived: this.totalReceived,
      totalSynced: this.totalSynced,
      totalConflicts: this.totalConflicts,
      peers,
      peerCount: this.routingTable.size,
      lastSyncs: this.syncLog.slice(-10),  // last 10 sync results
    }
  }

  /**
   * Force flush buffer to L2
   */
  async flush() {
    if (this.messageBuffer.size > 0) {
      await this._syncBatch()
    }
  }

  /**
   * Shutdown: flush + clear timers
   */
  async destroy() {
    if (this.batchTimer) clearInterval(this.batchTimer)
    if (this.statsTimer) clearInterval(this.statsTimer)
    if (this._retryInterval) clearInterval(this._retryInterval)
    await this.flush()
  }

  // ── Private ──────────────────────────────────────────────────────────────

  async _checkBackbone() {
    try {
      const res = await fetch(`${BACKBONE_URL}/api/v1/chat/rooms/`, {
        signal: AbortSignal.timeout(3000),
      })
      return res.ok
    } catch { return false }
  }

  async _syncBatch() {
    if (!this.backboneOnline || this.messageBuffer.size === 0) return

    // Extract batch from buffer
    const entries = [...this.messageBuffer.entries()]
    const batch = entries.slice(0, BATCH_MAX_SIZE)
    const messages = batch.map(([, msg]) => ({
      id: msg.id,
      sender_peer_id: msg.peerId || msg.sender_peer_id || this.nodeId,
      sender_name: msg.from || msg.sender_name || 'Unknown',
      text: msg.text,
      message_type: msg.type || 'chat',
      client_timestamp: msg.timestamp || msg.client_timestamp || Date.now(),
      room_topic: msg.room_topic || 'eatpan-chat',
      version: msg.version || 1,
      vector_clock: msg.vectorClock || msg.vector_clock || { [this.nodeId]: 1 },
      node_origin: msg.peerId || this.nodeId,
      received_via: 'cluster',
    }))

    try {
      const res = await fetch(`${BACKBONE_URL}/api/v1/chat/sync/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages, node_id: this.nodeId }),
        signal: AbortSignal.timeout(10_000),
      })

      if (res.ok) {
        const result = await res.json()
        // Remove synced messages from buffer
        for (const [id] of batch) {
          this.messageBuffer.delete(id)
        }
        this.totalSynced += result.saved || 0
        this.totalConflicts += result.conflicts || 0

        this.syncLog.push({
          time: new Date().toISOString(),
          sent: messages.length,
          saved: result.saved,
          skipped: result.skipped,
          conflicts: result.conflicts,
        })
        // Keep log bounded
        if (this.syncLog.length > 100) this.syncLog.shift()

        if (result.saved > 0) {
          console.log(`[L3 Cluster] Synced ${result.saved}/${messages.length} to L2 (buffer: ${this.messageBuffer.size})`)
        }
      } else {
        this.backboneOnline = false
        console.warn(`[L3 Cluster] L2 returned ${res.status}, marking offline`)
      }
    } catch (e) {
      this.backboneOnline = false
      console.warn(`[L3 Cluster] Sync failed: ${e.message}`)
    }
  }

  _cleanupStale() {
    const now = Date.now()
    for (const [id, info] of this.routingTable) {
      if (now - info.lastSeen > PEER_TIMEOUT_MS * 3) {
        this.routingTable.delete(id)
      }
    }
  }

  _formatUptime(ms) {
    const s = Math.floor(ms / 1000)
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    return h > 0 ? `${h}h ${m}m` : `${m}m ${s % 60}s`
  }
}
