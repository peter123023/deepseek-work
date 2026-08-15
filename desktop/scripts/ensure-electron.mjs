/**
 * Ensure the Electron runtime binary is present before `dev` or packaging.
 *
 * Electron 43 removed its `postinstall` download (the package ships no `scripts`
 * field), so `pnpm install` no longer fetches the platform binary. The binary is
 * downloaded lazily by `electron/install.js`; this script runs it once so that
 * `electron-builder` (which copies `node_modules/electron/dist` verbatim) always
 * has the runtime to pack. Idempotent: `install.js` exits immediately when
 * `path.txt` already exists.
 */

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const electronDir = join(require.resolve('electron/package.json'), '..')
const pathFile = join(electronDir, 'path.txt')

if (existsSync(pathFile)) {
  console.log(`ensure-electron: runtime already present (${electronDir})`)
  process.exit(0)
}

console.log('ensure-electron: downloading Electron runtime...')
const result = spawnSync(process.execPath, [join(electronDir, 'install.js')], { stdio: 'inherit' })
if (result.status !== 0) {
  console.error('ensure-electron: Electron runtime download failed; run `node node_modules/electron/install.js` manually to diagnose.')
  process.exit(result.status ?? 1)
}
console.log('ensure-electron: runtime ready')
