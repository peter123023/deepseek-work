import { defineConfig } from 'tsdown'

/**
 * Bundle the desktop shell's main and preload processes. `electron` must stay
 * external: the Electron runtime injects it at launch, so bundling it would
 * duplicate the API surface and break `app`/`ipcMain` singletons.
 */
export default defineConfig({
  entry: ['lib/types/main/index.js', 'lib/types/preload/index.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
  deps: {
    neverBundle: ['electron'],
  },
})
