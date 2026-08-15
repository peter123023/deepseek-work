/**
 * Dispatch electron-builder to the target matching the current OS. The CI
 * matrix runs each target on its native runner (macOS for DMG/ZIP, Windows for
 * NSIS/portable), so this script derives the target from `process.platform`
 * rather than taking it as input.
 */

import { spawn } from 'node:child_process'

const target = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : null
if (target === null) {
  console.error(`package-platform: no desktop installer target for platform ${process.platform}`)
  process.exit(1)
}

const builder = process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder'
console.log(`package-platform: electron-builder --${target}`)
const child = spawn(builder, [`--${target}`], { stdio: 'inherit' })
child.once('error', error => {
  console.error(`package-platform: failed to spawn ${builder}: ${error.message}`)
  process.exit(1)
})
child.once('exit', code => {
  process.exit(code ?? 1)
})
