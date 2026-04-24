import { defineConfig } from 'tsup'

export default defineConfig([
  {
    entry: {
      index: 'src/index.ts'
    },
    format: ['esm', 'cjs'],
    external: ['axios', 'socket.io-client'],
    dts: true,
    sourcemap: true,
    clean: true,
    target: 'es2020',
    outDir: 'dist'
  },
  {
    entry: {
      cli: 'src/cli.ts'
    },
    format: ['cjs'],
    external: ['axios', 'socket.io-client'],
    dts: false,
    sourcemap: true,
    clean: false,
    target: 'node18',
    outDir: 'dist',
    banner: {
      js: '#!/usr/bin/env node'
    }
  }
])
