/**
 * mode-switch.mjs — L4 ↔ L3 Mode Controller
 *
 * Allows P4 Desktop (Electron) to upgrade to L3 Cluster mode.
 * Requirements for L3:
 *   - Docker installed (checked via `docker --version`)
 *   - Stable internet connection (relay reachable)
 *
 * When L3 mode is activated:
 *   1. ClusterNode is instantiated with current p2p peerId
 *   2. Incoming GossipSub messages are forwarded to ClusterNode.onMessage()
 *   3. ClusterNode batch-syncs to L2 Backbone
 *   4. UI badge changes from "L4" to "L3+L4"
 */

import { execSync } from 'child_process'
import { ClusterNode } from './cluster.mjs'

export class ModeController {
  constructor() {
    this.currentMode = 'L4'        // 'L4' or 'L3+L4'
    this.clusterNode = null
    this.dockerAvailable = false
    this.dockerVersion = null
  }

  /**
   * Check if Docker is available on this machine
   */
  checkDocker() {
    try {
      const out = execSync('docker --version', { encoding: 'utf-8', timeout: 5000 })
      this.dockerVersion = out.trim()
      this.dockerAvailable = true
      console.log(`[Mode] Docker found: ${this.dockerVersion}`)
      return { available: true, version: this.dockerVersion }
    } catch {
      this.dockerAvailable = false
      this.dockerVersion = null
      console.log('[Mode] Docker not found')
      return { available: false, version: null }
    }
  }

  /**
   * Upgrade to L3+L4 mode.
   * @param {string} peerId — current libp2p PeerId
   * @param {string} nodeName — current node name
   * @returns {ClusterNode|null}
   */
  async upgradeToL3(peerId, nodeName) {
    if (this.currentMode === 'L3+L4') {
      console.log('[Mode] Already in L3+L4 mode')
      return this.clusterNode
    }

    // Docker is NOT strictly required for cluster.mjs logic, 
    // but it's required for full L3 (PostgreSQL, etc.)
    // For now, we allow L3 mode without Docker (in-memory only)
    const docker = this.checkDocker()

    this.clusterNode = new ClusterNode(peerId, `${nodeName} [L3]`)
    await this.clusterNode.init()

    this.currentMode = 'L3+L4'
    console.log(`[Mode] ⬆ Upgraded to L3+L4 (Docker: ${docker.available ? '✓' : '✗'})`)

    return this.clusterNode
  }

  /**
   * Downgrade back to L4 only.
   */
  async downgradeToL4() {
    if (this.currentMode === 'L4') {
      console.log('[Mode] Already in L4 mode')
      return
    }

    if (this.clusterNode) {
      await this.clusterNode.destroy()
      this.clusterNode = null
    }

    this.currentMode = 'L4'
    console.log('[Mode] ⬇ Downgraded to L4')
  }

  /**
   * Get current mode status for UI
   */
  getStatus() {
    return {
      mode: this.currentMode,
      dockerAvailable: this.dockerAvailable,
      dockerVersion: this.dockerVersion,
      clusterStats: this.clusterNode?.getStats() || null,
    }
  }

  /**
   * Forward a GossipSub message to cluster node (if in L3 mode)
   */
  onGossipMessage(msg) {
    if (this.clusterNode) {
      this.clusterNode.onMessage(msg)
    }
  }

  /**
   * Forward peer update to cluster node
   */
  updatePeer(peerId, info) {
    if (this.clusterNode) {
      this.clusterNode.updatePeer(peerId, info)
    }
  }

  /**
   * Forward peer disconnect to cluster node
   */
  removePeer(peerId) {
    if (this.clusterNode) {
      this.clusterNode.removePeer(peerId)
    }
  }

  async destroy() {
    if (this.clusterNode) {
      await this.clusterNode.destroy()
      this.clusterNode = null
    }
  }
}
