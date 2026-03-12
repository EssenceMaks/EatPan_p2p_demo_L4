import * as esbuild from 'esbuild'

await esbuild.build({
  entryPoints: ['p2p-browser.mjs'],
  bundle: true,
  outfile: 'p2p-bundle.js',
  format: 'esm',
  platform: 'browser',
  target: ['es2020'],
  minify: true,
  define: {
    'process.env.NODE_DEBUG': '""',
    'global': 'globalThis',
  }
})

console.log('✅ Built p2p-bundle.js')
