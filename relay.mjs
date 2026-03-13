/**
 * relay.mjs — EatPan Relay + L3 Cluster Node
 * 
 * Запуск: node relay.mjs
 * 
 * Dual role:
 *   1. Circuit Relay Server — ретранслює трафік між пірами за NAT
 *   2. L3 Cluster Node — збирає повідомлення через GossipSub
 *      та batch-синхронізує до L2 Backbone (якщо BACKBONE_URL задано)
 */

// Polyfill: Node 18 не має CustomEvent
if (typeof globalThis.CustomEvent === 'undefined') {
  globalThis.CustomEvent = class CustomEvent extends Event {
    constructor(type, params = {}) {
      super(type, params)
      this.detail = params.detail ?? null
    }
  }
}

import { createLibp2p } from 'libp2p'
import { tcp } from '@libp2p/tcp'
import { webSockets } from '@libp2p/websockets'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { identify } from '@libp2p/identify'
import { circuitRelayServer } from '@libp2p/circuit-relay-v2'
import { gossipsub } from '@chainsafe/libp2p-gossipsub'
import { ClusterNode } from './cluster.mjs'

const TCP_PORT = process.env.RELAY_TCP_PORT || 9090
const WS_PORT  = process.env.RELAY_WS_PORT  || 9091
const BACKBONE_URL = process.env.BACKBONE_URL || ''  // empty = no L2 sync
const TOPIC = 'eatpan-chat'

async function startRelay() {
  const node = await createLibp2p({
    addresses: {
      listen: [
        `/ip4/0.0.0.0/tcp/${TCP_PORT}`,
        `/ip4/0.0.0.0/tcp/${WS_PORT}/ws`,
      ]
    },
    transports: [tcp(), webSockets()],
    connectionEncryption: [noise()],
    streamMuxers: [yamux()],
    services: {
      identify: identify(),
      relay: circuitRelayServer({
        reservations: {
          maxReservations: 128,
          defaultDurationLimit: 600000,
          defaultDataLimit: BigInt(1 << 24)
        }
      }),
      pubsub: gossipsub({
        emitSelf: false,
        allowPublishToZeroTopicPeers: true,
      })
    }
  })

  const peerId = node.peerId.toString()

  // ─── Subscribe to GossipSub topic ───
  node.services.pubsub.subscribe(TOPIC)

  // ─── L3 Cluster Node (if BACKBONE_URL is set) ───
  let cluster = null
  if (BACKBONE_URL) {
    cluster = new ClusterNode(peerId, `EC2-Relay-L3`)
    const online = await cluster.init()
    console.log(`[L3] Cluster mode: ${online ? 'L2 connected' : 'buffering (L2 offline)'}`)
  }

  // ─── Forward GossipSub messages to ClusterNode ───
  node.services.pubsub.addEventListener('message', (evt) => {
    if (evt.detail.topic !== TOPIC) return
    try {
      const data = JSON.parse(new TextDecoder().decode(evt.detail.data))
      if (data.type === 'chat' && data.text && cluster) {
        cluster.onMessage(data)
      }
      if (data.type === 'ping' && cluster) {
        cluster.updatePeer(data.peerId, {
          name: data.name,
          route: 'relay',
          role: 'edge',
        })
      }
    } catch { /* ignore malformed */ }
  })

  console.log('═══════════════════════════════════════════')
  console.log('  🔄 EatPan Relay Server + L3 Cluster')
  console.log('═══════════════════════════════════════════')
  console.log('')
  console.log('  Peer ID:', peerId)
  console.log('  L3 Cluster:', cluster ? '✓ enabled' : '✗ disabled (no BACKBONE_URL)')
  console.log('  Backbone:', BACKBONE_URL || '(none)')
  console.log('')
  console.log('  Multiaddrs:')
  for (const ma of node.getMultiaddrs()) {
    console.log(`    ${ma.toString()}`)
  }
  console.log('')
  const localIp = node.getMultiaddrs().find(ma => {
    const str = ma.toString()
    return str.includes('/tcp/') && !str.includes('/ws/') && !str.includes('127.0.0.1')
  })
  if (localIp) {
    console.log(`  RELAY_ADDR = '${localIp.toString()}'`)
  }
  console.log('═══════════════════════════════════════════')

  // ─── Log connections ───
  let connCount = 0
  node.addEventListener('peer:connect', (evt) => {
    connCount++
    const remote = evt.detail.toString()
    console.log(`[Relay] + Connected (${connCount} active): ${remote.substring(0, 20)}...`)
    if (cluster) cluster.updatePeer(remote, { name: remote.substring(0, 12), route: 'relay', role: 'edge' })
  })
  node.addEventListener('peer:disconnect', (evt) => {
    connCount = Math.max(0, connCount - 1)
    const remote = evt.detail.toString()
    console.log(`[Relay] - Disconnected (${connCount} active): ${remote.substring(0, 20)}...`)
    if (cluster) cluster.removePeer(remote)
  })

  // ─── Stats logging every 60s ───
  setInterval(() => {
    const stats = cluster?.getStats()
    if (stats) {
      console.log(`[L3 Stats] uptime:${stats.uptimeFormatted} peers:${stats.peerCount} buf:${stats.buffer} synced:${stats.totalSynced} recv:${stats.totalReceived} backbone:${stats.backboneOnline ? 'online' : 'offline'}`)
    } else {
      console.log(`[Relay] Connections: ${connCount}`)
    }
  }, 60_000)

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n[Relay] Shutting down...')
    if (cluster) await cluster.destroy()
    await node.stop()
    process.exit(0)
  })
}

startRelay().catch((e) => {
  console.error('Relay failed to start:', e)
  process.exit(1)
})
