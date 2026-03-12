/**
 * EatPan Web Chat — browser P2P module
 * Connects to relay via WebSocket and joins GossipSub chat
 */

import { createLibp2p } from 'libp2p'
import { webSockets } from '@libp2p/websockets'
import { all as wsFilters } from '@libp2p/websockets/filters'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { gossipsub } from '@chainsafe/libp2p-gossipsub'
import { identify } from '@libp2p/identify'
import { bootstrap } from '@libp2p/bootstrap'
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2'

const TOPIC = 'eatpan-chat'
const RELAY_WS = '/ip4/63.177.83.41/tcp/9091/ws/p2p/12D3KooWPjuetDeAeyArEwXZtnnyRm9E4sgbLkS4y9myzESB8pa5'

function randomName() {
  const adj = ['Cool','Fast','Brave','Wild','Calm','Wise','Bold','Keen']
  const noun = ['Fox','Wolf','Bear','Hawk','Lion','Lynx','Puma','Deer']
  const r = () => Math.floor(Math.random() * 8)
  return `${adj[r()]}-${noun[r()]}-${Math.random().toString(36).substring(2,5)}`
}

window.startP2P = async function startP2P(callbacks = {}) {
  const nodeName = randomName()

  const node = await createLibp2p({
    transports: [
      webSockets({ filter: wsFilters }),
      circuitRelayTransport({ discoverRelays: 1 })
    ],
    connectionEncryption: [noise()],
    streamMuxers: [yamux()],
    peerDiscovery: [bootstrap({ list: [RELAY_WS] })],
    services: {
      identify: identify(),
      pubsub: gossipsub({ emitSelf: false, allowPublishToZeroTopicPeers: true })
    }
  })

  node.services.pubsub.subscribe(TOPIC)

  const peerId = node.peerId.toString()
  const peers = new Map()
  peers.set(peerId, { name: nodeName, lastSeen: Date.now(), via: 'self' })

  node.addEventListener('peer:connect', (evt) => {
    callbacks.onStatus?.(`Підключено: ${evt.detail.toString().substring(0,12)}...`)
  })

  node.addEventListener('peer:disconnect', (evt) => {
    peers.delete(evt.detail.toString())
    callbacks.onPeers?.(Object.fromEntries(peers))
  })

  node.services.pubsub.addEventListener('message', (evt) => {
    if (evt.detail.topic !== TOPIC) return
    try {
      const data = JSON.parse(new TextDecoder().decode(evt.detail.data))
      if (data.type === 'chat' && data.text) callbacks.onChat?.(data)
      if (data.type === 'ping') {
        peers.set(data.peerId, { name: data.name, lastSeen: Date.now(), via: 'relay' })
        callbacks.onPeers?.(Object.fromEntries(peers))
      }
    } catch (e) {}
  })

  // Ping
  setInterval(async () => {
    try {
      const enc = new TextEncoder().encode(JSON.stringify({
        type: 'ping', name: nodeName, peerId, timestamp: Date.now()
      }))
      await node.services.pubsub.publish(TOPIC, enc)
    } catch (e) {}
    const now = Date.now()
    for (const [id, info] of peers) {
      if (id !== peerId && now - info.lastSeen > 15000) peers.delete(id)
    }
    callbacks.onPeers?.(Object.fromEntries(peers))
  }, 3000)

  callbacks.onStatus?.(`Я: ${nodeName}`)
  callbacks.onPeers?.(Object.fromEntries(peers))

  return {
    sendChat: async (text) => {
      const msg = { type: 'chat', from: nodeName, peerId, text, timestamp: Date.now() }
      try {
        await node.services.pubsub.publish(TOPIC, new TextEncoder().encode(JSON.stringify(msg)))
      } catch (e) {}
      callbacks.onChat?.(msg)
    },
    name: nodeName,
    peerId
  }
}
