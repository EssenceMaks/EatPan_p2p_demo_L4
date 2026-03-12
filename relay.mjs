/**
 * EatPan Relay Server — standalone circuit-relay-v2 node
 * 
 * Запуск: node relay.mjs
 * Призначення: ретранслює трафік між пірами за NAT
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

const TCP_PORT = process.env.RELAY_TCP_PORT || 9090
const WS_PORT  = process.env.RELAY_WS_PORT  || 9091

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

  console.log('═══════════════════════════════════════════')
  console.log('  🔄 EatPan Relay Server Started!')
  console.log('═══════════════════════════════════════════')
  console.log('')
  console.log('  Peer ID:', peerId)
  console.log('')
  console.log('  Multiaddrs:')
  for (const ma of node.getMultiaddrs()) {
    console.log(`    ${ma.toString()}`)
  }
  console.log('')
  console.log('  For p2p.mjs, use one of:')
  const localIp = node.getMultiaddrs().find(ma => {
    const str = ma.toString()
    return str.includes('/tcp/') && !str.includes('/ws/') && !str.includes('127.0.0.1')
  })
  if (localIp) {
    console.log(`  RELAY_ADDR = '${localIp.toString()}'`)
  }
  console.log('═══════════════════════════════════════════')

  // Лог підключень
  let connCount = 0
  node.addEventListener('peer:connect', (evt) => {
    connCount++
    console.log(`[Relay] + Connected (${connCount} active): ${evt.detail.toString().substring(0, 20)}...`)
  })
  node.addEventListener('peer:disconnect', (evt) => {
    connCount = Math.max(0, connCount - 1)
    console.log(`[Relay] - Disconnected (${connCount} active): ${evt.detail.toString().substring(0, 20)}...`)
  })

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n[Relay] Shutting down...')
    await node.stop()
    process.exit(0)
  })
}

startRelay().catch((e) => {
  console.error('Relay failed to start:', e)
  process.exit(1)
})
