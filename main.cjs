/**
 * EatPan P4 Terminal — Electron Main Process (CJS)
 * 
 * Використовує require('electron') — працює коректно тому що
 * launch.cjs тимчасово перейменовує node_modules/electron/ 
 * перед запуском, дозволяючи Electron використати вбудований модуль.
 * 
 * libp2p (ESM-only) завантажується через dynamic import().
 */

const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')

const isDev = process.argv.includes('--dev')

let mainWindow = null
let p2pBackend = null
let backboneClient = null   // L2 Backbone API client
let modeController = null   // L4 ↔ L3 mode controller

// ═══════════════════════════════════════════
//  Вікно
// ═══════════════════════════════════════════

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 480,
    minHeight: 500,
    title: 'EatPan',
    backgroundColor: '#0a0a0f',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    }
  })

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'))
  mainWindow.once('ready-to-show', () => mainWindow.show())
  if (isDev) mainWindow.webContents.openDevTools()
  mainWindow.on('closed', () => { mainWindow = null })
}

// ═══════════════════════════════════════════
//  IPC
// ═══════════════════════════════════════════

function setupIPC() {
  ipcMain.on('send-message', (_event, text) => {
    if (p2pBackend) p2pBackend.sendChat(text)
  })
  ipcMain.handle('get-status', () => {
    if (!p2pBackend) return null
    return p2pBackend.getStatus()
  })
  // L2 Backbone IPC
  ipcMain.handle('backbone-status', () => ({
    online: backboneClient?.isOnline ?? false,
    pending: backboneClient?.pendingSync?.length ?? 0,
    url: process.env.BACKBONE_URL || 'http://localhost:8000',
  }))
  ipcMain.on('backbone-flush', async () => {
    if (backboneClient) await backboneClient.flush()
  })

  // L3 Cluster Mode IPC
  ipcMain.handle('check-docker', async () => {
    if (!modeController) return { available: false }
    return modeController.checkDocker()
  })
  ipcMain.handle('mode-status', () => {
    if (!modeController) return { mode: 'L4' }
    return modeController.getStatus()
  })
  ipcMain.handle('upgrade-to-l3', async () => {
    if (!modeController || !p2pBackend) return { success: false, reason: 'not ready' }
    const status = p2pBackend.getStatus()
    try {
      await modeController.upgradeToL3(status.peerId, status.name)
      if (mainWindow) mainWindow.webContents.send('mode-changed', modeController.getStatus())
      return { success: true, mode: modeController.currentMode }
    } catch (e) {
      return { success: false, reason: e.message }
    }
  })
  ipcMain.handle('downgrade-to-l4', async () => {
    if (!modeController) return { success: false }
    await modeController.downgradeToL4()
    if (mainWindow) mainWindow.webContents.send('mode-changed', modeController.getStatus())
    return { success: true, mode: 'L4' }
  })
  ipcMain.handle('cluster-stats', () => {
    return modeController?.clusterNode?.getStats() || null
  })
}

// ═══════════════════════════════════════════
//  Auto-Updater
// ═══════════════════════════════════════════

async function setupAutoUpdater() {
  if (isDev) return
  try {
    const { autoUpdater } = require('electron-updater')
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = true

    // Логування
    autoUpdater.logger = {
      info: (...args) => console.log('[Updater]', ...args),
      warn: (...args) => console.warn('[Updater]', ...args),
      error: (...args) => console.error('[Updater]', ...args),
      debug: (...args) => console.log('[Updater:debug]', ...args),
    }

    autoUpdater.on('checking-for-update', () => {
      console.log('[Updater] Checking for update...')
    })
    autoUpdater.on('update-available', (info) => {
      console.log('[Updater] Update available:', info.version)
      if (mainWindow) mainWindow.webContents.send('update-available', {
        version: info.version, releaseNotes: info.releaseNotes
      })
    })
    autoUpdater.on('update-not-available', () => {
      console.log('[Updater] No update available')
    })
    autoUpdater.on('download-progress', (progress) => {
      console.log(`[Updater] Download: ${Math.round(progress.percent)}%`)
      if (mainWindow) mainWindow.webContents.send('update-progress', {
        percent: Math.round(progress.percent)
      })
    })
    autoUpdater.on('update-downloaded', () => {
      console.log('[Updater] Download complete!')
      if (mainWindow) mainWindow.webContents.send('update-downloaded')
    })
    autoUpdater.on('error', (err) => {
      console.error('[Updater] Error:', err.message)
      if (mainWindow) mainWindow.webContents.send('update-error', {
        message: err.message
      })
    })

    ipcMain.on('download-update', async () => {
      try {
        console.log('[Updater] Starting download...')
        await autoUpdater.downloadUpdate()
      } catch (e) {
        console.error('[Updater] Download failed:', e.message)
        if (mainWindow) mainWindow.webContents.send('update-error', {
          message: e.message
        })
      }
    })
    ipcMain.on('install-update', () => autoUpdater.quitAndInstall())

    autoUpdater.checkForUpdates()
    setInterval(() => autoUpdater.checkForUpdates(), 30 * 60 * 1000)
  } catch (e) {
    console.log('Auto-updater not available:', e.message)
  }
}

// ═══════════════════════════════════════════
//  Запуск
// ═══════════════════════════════════════════

app.whenReady().then(async () => {
  setupIPC()

  // libp2p = ESM only — dynamic import
  // Polyfill CustomEvent для Node 18 (Electron 28)
  if (typeof globalThis.CustomEvent === 'undefined') {
    globalThis.CustomEvent = class CustomEvent extends Event {
      constructor(type, params = {}) {
        super(type, params)
        this.detail = params.detail ?? null
      }
    }
  }
  try {
    // ─── L2 Backbone Client ──────────────────────────────────────────────────
    const backboneModule = await import('./backbone.mjs')
    backboneClient = new backboneModule.BackboneClient(
      `electron-${Date.now()}`,
      'EatPan Desktop'
    )
    const backboneOnline = await backboneClient.init()

    // ─── Load chat history from L2 on startup ────────────────────────────────
    if (backboneOnline) {
      const history = await backboneClient.loadHistory()
      if (history.length > 0 && mainWindow) {
        mainWindow.webContents.send('chat-history', history)
      }
    }

    // ─── L3 Mode Controller ─────────────────────────────────────────────────
    const modeModule = await import('./mode-switch.mjs')
    modeController = new modeModule.ModeController()
    modeController.checkDocker()

    // ─── P2P Backend (passes backboneClient for sync) ────────────────────────
    const p2pModule = await import('./p2p.mjs')
    p2pBackend = await p2pModule.createP2PBackend({
      onChat: (msg) => {
        if (mainWindow) mainWindow.webContents.send('chat-message', msg)
        // Forward to L3 cluster node (if active)
        modeController?.onGossipMessage(msg)
      },
      onPeersUpdate: (peers) => {
        if (mainWindow) mainWindow.webContents.send('peers-update', peers)
        // Forward peer updates to cluster routing table
        if (modeController?.clusterNode) {
          for (const [id, info] of Object.entries(peers)) {
            modeController.updatePeer(id, info)
          }
        }
      },
      onConnected: (peerId) => {
        if (mainWindow) mainWindow.webContents.send('peer-connected', peerId)
      },
      onDisconnected: (peerId) => {
        if (mainWindow) mainWindow.webContents.send('peer-disconnected', peerId)
        modeController?.removePeer(peerId)
      }
    }, backboneClient)  // ← pass backbone client
    console.log('[P2P] Backend started')

    // ─── Send history AFTER window loads (if window was created first) ───────
    mainWindow?.webContents.once('did-finish-load', async () => {
      if (backboneOnline) {
        const history = await backboneClient.loadHistory()
        if (history.length > 0) {
          mainWindow.webContents.send('chat-history', history)
        }
      }
    })
  } catch (e) {
    console.error('[P2P/Backbone] Failed to start:', e.message)
  }

  createWindow()
  setupAutoUpdater()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', async () => {
  if (modeController) await modeController.destroy()  // ← Flush L3 cluster
  if (backboneClient) await backboneClient.flush()     // ← Sync remaining messages
  if (backboneClient) backboneClient.destroy()
  if (p2pBackend) await p2pBackend.stop()
  if (process.platform !== 'darwin') app.quit()
})
