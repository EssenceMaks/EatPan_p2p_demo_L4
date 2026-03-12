/**
 * EatPan P2P Backend — libp2p нода для Electron
 * 
 * Експортує createP2PBackend() для використання main.js
 */

// Polyfill: Node 18 (Electron 28) не має CustomEvent
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
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { gossipsub } from '@chainsafe/libp2p-gossipsub'
import { identify } from '@libp2p/identify'
import { mdns } from '@libp2p/mdns'
import { randomBytes } from 'crypto'

const TOPIC = 'eatpan-chat'

export async function createP2PBackend(callbacks = {}) {
  const nodeName = 'User-' + randomBytes(3).toString('hex')

  // ─── Створення libp2p ноди ───
  const node = await createLibp2p({
    addresses: { listen: ['/ip4/0.0.0.0/tcp/0'] },
    transports: [tcp()],
    connectionEncryption: [noise()],
    streamMuxers: [yamux()],
    peerDiscovery: [mdns({ interval: 2000 })],
    services: {
      identify: identify(),
      pubsub: gossipsub({
        emitSelf: false,
        allowPublishToZeroTopicPeers: true,
      })
    }
  })

  node.services.pubsub.subscribe(TOPIC)

  const peerId = node.peerId.toString()
  const onlinePeers = new Map()
  onlinePeers.set(peerId, { name: nodeName, lastSeen: Date.now() })

  console.log(`[P2P] Started: ${nodeName} (${peerId.substring(0, 12)}...)`)

  // ─── P2P Events ───
  node.addEventListener('peer:connect', (evt) => {
    const remote = evt.detail.toString()
    console.log(`[P2P] Connected: ${remote.substring(0, 16)}...`)
    callbacks.onConnected?.(remote)
  })

  node.addEventListener('peer:disconnect', (evt) => {
    const remote = evt.detail.toString()
    onlinePeers.delete(remote)
    console.log(`[P2P] Disconnected: ${remote.substring(0, 16)}...`)
    callbacks.onDisconnected?.(remote)
    callbacks.onPeersUpdate?.(Object.fromEntries(onlinePeers))
  })

  // ─── Обробка повідомлень ───
  node.services.pubsub.addEventListener('message', (evt) => {
    if (evt.detail.topic !== TOPIC) return
    try {
      const data = JSON.parse(new TextDecoder().decode(evt.detail.data))

      if (data.type === 'chat' && data.text) {
        callbacks.onChat?.(data)
      }

      if (data.type === 'ping') {
        onlinePeers.set(data.peerId, { name: data.name, lastSeen: Date.now() })
        callbacks.onPeersUpdate?.(Object.fromEntries(onlinePeers))
      }
    } catch (e) { /* ignore */ }
  })

  // ─── Ping кожні 3 сек ───
  const pingInterval = setInterval(async () => {
    try {
      const encoded = new TextEncoder().encode(JSON.stringify({
        type: 'ping', name: nodeName, peerId, timestamp: Date.now()
      }))
      await node.services.pubsub.publish(TOPIC, encoded)
    } catch (e) { /* ignore */ }

    // Очистка старих пірів
    const now = Date.now()
    for (const [id, info] of onlinePeers) {
      if (id !== peerId && now - info.lastSeen > 10000) {
        onlinePeers.delete(id)
      }
    }
    callbacks.onPeersUpdate?.(Object.fromEntries(onlinePeers))
  }, 3000)

  // ─── Публічний API ───
  return {
    sendChat: async (text) => {
      const msg = {
        type: 'chat',
        from: nodeName,
        peerId,
        text,
        timestamp: Date.now()
      }
      try {
        const encoded = new TextEncoder().encode(JSON.stringify(msg))
        await node.services.pubsub.publish(TOPIC, encoded)
      } catch (e) { /* ignore */ }
      // Показати собі теж
      callbacks.onChat?.(msg)
    },

    getStatus: () => ({
      name: nodeName,
      peerId,
      addresses: node.getMultiaddrs().map(a => a.toString()),
      peers: Object.fromEntries(onlinePeers),
      connections: node.getConnections().length,
    }),

    stop: async () => {
      clearInterval(pingInterval)
      await node.stop()
      console.log('[P2P] Stopped')
    }
  }
}
