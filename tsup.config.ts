import { defineConfig } from 'tsup'

export default defineConfig([
  {
    entry: {
      index: 'src/index.ts',
      manage: 'src/manage/index.ts',
      ws: 'src/ws.ts',
      node: 'src/node.ts'
    },
    format: ['esm', 'cjs'],
    external: ['axios', 'archiver', 'form-data', 'jiti', 'commander', 'socket.io-client'],
    dts: true,
    sourcemap: true,
    clean: false,
    target: 'es2020',
    outDir: 'dist'
  },
  {
    entry: {
      cli: 'src/cli.ts'
    },
    format: ['cjs'],
    external: ['axios', 'archiver', 'form-data', 'jiti', 'commander', 'socket.io-client'],
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
