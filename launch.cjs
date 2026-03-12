/**
 * Launcher для EatPan Electron App
 * 
 * Вирішує проблему ELECTRON_RUN_AS_NODE=1 (встановлений VS Code)
 * яка вимикає Electron API
 */
const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')

// Шлях до Electron бінарника
let electronExe
try {
  electronExe = require('electron')
} catch (e) {
  // Fallback: читаємо path.txt
  const pathFile = path.join(__dirname, 'node_modules', 'electron', 'path.txt')
  if (fs.existsSync(pathFile)) {
    const relPath = fs.readFileSync(pathFile, 'utf-8').trim()
    electronExe = path.join(__dirname, 'node_modules', 'electron', 'dist', relPath)
  } else {
    electronExe = path.join(__dirname, 'node_modules', 'electron', 'dist', 'electron.exe')
  }
}

// Середовище: видаляємо ELECTRON_RUN_AS_NODE
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const child = spawn(electronExe, ['.', ...process.argv.slice(2)], {
  stdio: 'inherit',
  cwd: __dirname,
  env
})

child.on('close', (code) => process.exit(code || 0))
process.on('SIGINT', () => { if (!child.killed) child.kill('SIGINT') })
process.on('SIGTERM', () => { if (!child.killed) child.kill('SIGTERM') })
