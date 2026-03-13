/**
 * Preload Script (CommonJS) — безпечний міст між Electron і Renderer
 */

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('eatpan', {
  // Chat
  sendMessage: (text) => ipcRenderer.send('send-message', text),
  onChatMessage: (cb) => ipcRenderer.on('chat-message', (_e, msg) => cb(msg)),

  // Peers
  onPeersUpdate: (cb) => ipcRenderer.on('peers-update', (_e, peers) => cb(peers)),
  onPeerConnected: (cb) => ipcRenderer.on('peer-connected', (_e, id) => cb(id)),
  onPeerDisconnected: (cb) => ipcRenderer.on('peer-disconnected', (_e, id) => cb(id)),

  // Status
  getStatus: () => ipcRenderer.invoke('get-status'),

  // Updates
  onUpdateAvailable: (cb) => ipcRenderer.on('update-available', (_e, info) => cb(info)),
  onUpdateProgress: (cb) => ipcRenderer.on('update-progress', (_e, p) => cb(p)),
  onUpdateDownloaded: (cb) => ipcRenderer.on('update-downloaded', () => cb()),
  onUpdateError: (cb) => ipcRenderer.on('update-error', (_e, err) => cb(err)),
  downloadUpdate: () => ipcRenderer.send('download-update'),
  installUpdate: () => ipcRenderer.send('install-update'),

  // L2 Backbone
  onChatHistory: (cb) => ipcRenderer.on('chat-history', (_e, msgs) => cb(msgs)),
  backboneStatus: () => ipcRenderer.invoke('backbone-status'),
  backboneFlush: () => ipcRenderer.send('backbone-flush'),

  // L3 Cluster Mode
  checkDocker: () => ipcRenderer.invoke('check-docker'),
  modeStatus: () => ipcRenderer.invoke('mode-status'),
  upgradeToL3: () => ipcRenderer.invoke('upgrade-to-l3'),
  downgradeToL4: () => ipcRenderer.invoke('downgrade-to-l4'),
  clusterStats: () => ipcRenderer.invoke('cluster-stats'),
  onModeChanged: (cb) => ipcRenderer.on('mode-changed', (_e, s) => cb(s)),
})


