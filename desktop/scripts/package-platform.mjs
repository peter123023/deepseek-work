/**
 * Dispatch electron-builder to the target matching the current OS. The CI
 * matrix runs each target on its native runner (macOS for DMG/ZIP, Windows for
 * NSIS/ZIP), so this script derives the target from `process.platform` rather
 * than taking it as input.
 *
 * On Windows, electron-builder's `zip` target is hard-coded to place the
 * `win-unpacked` contents at the zip root (`withoutDir = !isMac` in
 * ArchiveTarget), so the archive has no enclosing folder. A portable Windows
 * zip should unpack into a single directory (like VS Code), so after the build
 * this script re-archives `win-unpacked` with 7za under a top-level
 * `<productName>-<version>/` folder, replacing the flat zip.
 */

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const target = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : null
if (target === null) {
  console.error(`package-platform: no desktop installer target for platform ${process.platform}`)
  process.exit(1)
}

const builder = process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder'
console.log(`package-platform: electron-builder --${target}`)
const child = spawn(builder, [`--${target}`], {
  stdio: 'inherit',
  // Node cannot execute `.cmd` shims directly on Windows; `shell: true`
  // re-parses the command through cmd.exe.
  shell: process.platform === 'win32',
})
child.once('error', error => {
  console.error(`package-platform: failed to spawn ${builder}: ${error.message}`)
  process.exit(1)
})
child.once('exit', code => {
  const exitCode = code ?? 1
  if (exitCode === 0 && process.platform === 'win32') {
    try {
      rezipPortable()
    } catch (error) {
      console.error(`package-platform: failed to re-archive the portable zip: ${error.message}`)
      process.exit(1)
    }
  }
  process.exit(exitCode)
})

/**
 * Re-archive `dist/win-unpacked` into a zip whose top-level entry is a single
 * `<productName>-<version>/` folder, replacing electron-builder's flat zip.
 */
function rezipPortable() {
  const desktopDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const distDir = join(desktopDir, 'dist')
  const unpackedDir = join(distDir, 'win-unpacked')
  const manifest = JSON.parse(readFileSync(join(desktopDir, 'package.json'), 'utf8'))
  const productName = manifest.build?.productName ?? manifest.name
  const version = manifest.version

  // electron-builder's flat zip and the re-archived zip share the same
  // artifact name (the portable archive replaces the flat one), so the CI
  // `desktop/dist/*.zip` glob still matches the portable archive.
  const zip = join(distDir, `${productName}-${version}-win.zip`)
  if (!existsSync(unpackedDir) || !existsSync(zip)) {
    console.log('package-platform: no win-unpacked/flat zip to re-archive; skipping')
    return
  }

  const topDir = `${productName}-${version}`

  // Rename win-unpacked to the target top-level folder (same-volume rename is
  // atomic and copy-free), archive it, then restore the original name so any
  // later electron-builder steps still find `win-unpacked`.
  const renamedDir = join(distDir, topDir)
  renameSync(unpackedDir, renamedDir)
  try {
    const sevenZip = resolve7za()
    // Replace the flat zip in place; 7za writes the archive to the final path
    // only after the input directory has been fully read.
    rmSync(zip, { force: true })
    const result = spawnSync(sevenZip, ['a', '-tzip', '-mx=7', zip, topDir], {
      cwd: distDir,
      stdio: 'inherit',
    })
    if (result.status !== 0) {
      throw new Error(`7za exited with status ${result.status}`)
    }
  } finally {
    renameSync(renamedDir, unpackedDir)
  }
  console.log(`package-platform: portable zip written to ${zip}`)
}

/**
 * Locate the 7za executable electron-builder uses. electron-builder downloads
 * it into its tool cache (and honors `ELECTRON_BUILDER_7ZIP_PATH`), so prefer
 * that env var and fall back to a glob over the cache directory.
 */
function resolve7za() {
  if (process.env.ELECTRON_BUILDER_7ZIP_PATH && existsSync(process.env.ELECTRON_BUILDER_7ZIP_PATH)) {
    return process.env.ELECTRON_BUILDER_7ZIP_PATH
  }
  const cacheRoot = join(
    process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'),
    'electron-builder',
    'Cache',
  )
  if (!existsSync(cacheRoot)) {
    throw new Error(`7za not found: ${cacheRoot} does not exist`)
  }
  for (const dir of readdirSync(cacheRoot)) {
    if (!dir.startsWith('7zip@')) continue
    const candidates = walkFor7za(join(cacheRoot, dir))
    if (candidates.length > 0) return candidates[0]
  }
  throw new Error(`7za not found under ${cacheRoot}`)
}

function walkFor7za(dir) {
  const found = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) found.push(...walkFor7za(full))
    else if (entry.name === '7za.exe') found.push(full)
  }
  return found
}
