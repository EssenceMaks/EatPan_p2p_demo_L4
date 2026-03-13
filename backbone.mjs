/**
 * backbone.mjs — L2 Backbone API Client for Electron (L4)
 *
 * Connects P4 Terminal (Electron) to P2 Backbone (Django REST API).
 * Handles:
 *   - Loading chat history on startup
 *   - Syncing sent messages to L2 for persistence
 *   - Buffer + batch sync (to avoid flooding L2 API)
 *   - Graceful fallback when L2 is offline
 */

// L2 Backbone API URL — can be overridden via env or settings
const BACKBONE_URL = process.env.BACKBONE_URL || 'http://localhost:8000'
const SYNC_BATCH_SIZE = 20      // Max messages per batch sync call
const SYNC_INTERVAL_MS = 5000   // Sync every 5 seconds
const HISTORY_LIMIT = 100       // Messages to load on startup

/**
 * BackboneClient — communicates with the Django L2 API
 */
export class BackboneClient {
  constructor(nodeId, nodeName) {
    this.nodeId = nodeId
    this.nodeName = nodeName
    this.isOnline = false
    this.pendingSync = []       // Buffer of messages not yet synced to L2
    this.syncTimer = null
    this.room = 'eatpan-chat'  // Default GossipSub topic = room topic
  }

  /**
   * Initialize — check L2 connectivity, start sync timer
   */
  async init() {
    this.isOnline = await this._checkConnectivity()
    if (this.isOnline) {
      console.log(`[Backbone] Connected to L2 at ${BACKBONE_URL}`)
      this._startSyncTimer()
    } else {
      console.warn(`[Backbone] L2 offline (${BACKBONE_URL}) — operating in P2P-only mode`)
      // Retry connectivity every 30s
      setInterval(() => this._retryConnection(), 30000)
    }
    return this.isOnline
  }

  /**
   * Load chat history from L2 on startup
   * @returns {Array} Array of message objects sorted by timestamp
   */
  async loadHistory() {
    if (!this.isOnline) return []
    try {
      const url = `${BACKBONE_URL}/api/v1/chat/history/${this.room}/?limit=${HISTORY_LIMIT}`
      const res = await fetch(url)
      if (!res.ok) return []
      const data = await res.json()
      const messages = data.results || []
      console.log(`[Backbone] Loaded ${messages.length} historical messages from L2`)
      // Normalize to L4 chat format
      return messages.map(m => ({
        id: m.id,
        from: m.sender_name,
        peerId: m.sender_peer_id,
        text: m.text,
        timestamp: m.client_timestamp,
        route: m.received_via || 'backbone',
        gsn: m.global_sequence_number,
        vectorClock: m.vector_clock,
        isHistory: true,    // ← mark as historical (displayed differently)
        type: 'chat',
      })).sort((a, b) => a.timestamp - b.timestamp)
    } catch (e) {
      console.warn('[Backbone] Failed to load history:', e.message)
      return []
    }
  }

  /**
   * Queue a message for sync to L2.
   * Called immediately when a message is sent or received.
   */
  enqueueSync(msg) {
    if (!msg?.id || !msg?.text) return
    this.pendingSync.push({
      id: msg.id,
      sender_peer_id: msg.peerId || this.nodeId,
      sender_name: msg.from || this.nodeName,
      text: msg.text,
      message_type: 'chat',
      client_timestamp: msg.timestamp || Date.now(),
      room_topic: this.room,
      version: msg.version || 1,
      vector_clock: msg.vectorClock || { [this.nodeId]: 1 },
      node_origin: this.nodeId,
      received_via: msg.route || 'direct',
    })
  }

  /**
   * Force-flush sync buffer immediately (e.g. before app close)
   */
  async flush() {
    if (this.pendingSync.length > 0) {
      await this._syncBatch()
    }
  }

  // ── Private ───────────────────────────────────────────────────────────────

  async _checkConnectivity() {
    try {
      const res = await fetch(`${BACKBONE_URL}/api/v1/chat/rooms/`, {
        method: 'GET',
        signal: AbortSignal.timeout(3000),
      })
      return res.ok
    } catch {
      return false
    }
  }

  async _retryConnection() {
    if (this.isOnline) return
    this.isOnline = await this._checkConnectivity()
    if (this.isOnline) {
      console.log('[Backbone] L2 reconnected!')
      this._startSyncTimer()
    }
  }

  _startSyncTimer() {
    if (this.syncTimer) return
    this.syncTimer = setInterval(() => this._syncBatch(), SYNC_INTERVAL_MS)
  }

  async _syncBatch() {
    if (!this.isOnline || this.pendingSync.length === 0) return

    const batch = this.pendingSync.splice(0, SYNC_BATCH_SIZE)
    try {
      const res = await fetch(`${BACKBONE_URL}/api/v1/chat/sync/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: batch,
          node_id: this.nodeId,
        }),
        signal: AbortSignal.timeout(5000),
      })
      if (res.ok) {
        const result = await res.json()
        if (result.saved > 0) {
          console.log(`[Backbone] Synced ${result.saved} messages to L2 (conflicts: ${result.conflicts})`)
        }
      } else {
        // Put back failed messages
        this.pendingSync.unshift(...batch)
        this.isOnline = false
      }
    } catch (e) {
      // Network error — put back and mark offline
      this.pendingSync.unshift(...batch)
      this.isOnline = false
      console.warn('[Backbone] Sync failed, L2 unreachable:', e.message)
    }
  }

  destroy() {
    if (this.syncTimer) {
      clearInterval(this.syncTimer)
      this.syncTimer = null
    }
  }
}
