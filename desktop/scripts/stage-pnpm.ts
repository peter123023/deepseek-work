/**
 * Stage a self-contained pnpm standalone binary into the desktop Host closure.
 *
 * The Host runs `spawnSync('pnpm', ...)` (see `apps/cli/src/plugin.ts`'s
 * `runPlugin`) to install plugins, but the packaged desktop must not assume a
 * system-wide pnpm. pnpm publishes platform-specific standalone archives that
 * bundle their own Node runtime, so this script downloads the matching archive,
 * extracts the executable, and places it where `host-supervisor` prepends it to
 * the Host's `PATH`.
 *
 * Run as part of `stage-runtime` (after the closure is materialized).
 *
 * @module @deepseek-ai/dsh-desktop/stage-pnpm
 */

import { spawn } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync } from 'node:fs'
import { chmod, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'

const desktopRoot = resolve(import.meta.dirname, '..')
const staging = join(desktopRoot, 'runtime-host')

/** Version must match the repository's pnpm (see `packageManager`). */
const PNPM_VERSION = '11.7.0'

/** Directory inside the closure that holds the pnpm executable. */
export const PNPM_BIN_DIR = 'node_modules/.pnpm-bin'

/** Map `process.platform` + `process.arch` to a pnpm standalone archive name. */
function standaloneArchiveName(): string {
  const { platform, arch } = process
  if (platform === 'darwin') {
    if (arch === 'arm64') return 'pnpm-darwin-arm64.tar.gz'
    if (arch === 'x64') return 'pnpm-darwin-x64.tar.gz'
  }
  if (platform === 'linux') {
    if (arch === 'x64') return 'pnpm-linux-x64.tar.gz'
    if (arch === 'arm64') return 'pnpm-linux-arm64.tar.gz'
  }
  if (platform === 'win32') {
    if (arch === 'x64') return 'pnpm-win32-x64.zip'
    if (arch === 'arm64') return 'pnpm-win32-arm64.zip'
  }
  throw new Error(`stage-pnpm: unsupported platform/arch ${platform}/${arch}`)
}

/** Absolute path where the pnpm executable will live. */
export function pnpmExecutablePath(): string {
  const name = process.platform === 'win32' ? 'pnpm.exe' : 'pnpm'
  return join(staging, PNPM_BIN_DIR, name)
}

/** Download a URL to a destination via `curl` (handles redirects + progress). */
async function download(url: string, destination: string): Promise<void> {
  mkdirSync(dirname(destination), { recursive: true })
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn('curl', ['-fsSL', '--output', destination, url], { stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) resolvePromise()
      else reject(new Error(`stage-pnpm: curl failed (exit ${code}) for ${url}`))
    })
  })
}

/** Extract a `.tar.gz` or `.zip` archive into `destinationDir`. */
async function extract(archivePath: string, destinationDir: string): Promise<void> {
  mkdirSync(destinationDir, { recursive: true })
  const isZip = archivePath.endsWith('.zip')
  const args = isZip
    ? ['-q', '-o', archivePath, '-d', destinationDir]
    : ['-xzf', archivePath, '-C', destinationDir]
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(isZip ? 'unzip' : 'tar', args, { stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) resolvePromise()
      else reject(new Error(`stage-pnpm: ${isZip ? 'unzip' : 'tar'} failed (exit ${code})`))
    })
  })
}

/** Download the pnpm standalone archive, extract it, and place the executable. */
export async function stagePnpm(): Promise<void> {
  const destination = pnpmExecutablePath()
  if (existsSync(destination)) {
    console.log(`stage-pnpm: pnpm already staged at ${destination}`)
    return
  }
  const asset = standaloneArchiveName()
  const url = `https://github.com/pnpm/pnpm/releases/download/v${PNPM_VERSION}/${asset}`
  const isZip = asset.endsWith('.zip')
  const archivePath = join(staging, PNPM_BIN_DIR, asset)

  console.log(`stage-pnpm: downloading ${url}`)
  await rm(join(staging, PNPM_BIN_DIR), { recursive: true, force: true })
  await download(url, archivePath)

  // Extract the archive into the bin dir. The archive is flat: the `pnpm`
  // executable sits at the top level next to its `dist/` payload, and both must
  // stay together because the executable loads `dist/pnpm.mjs` at runtime. Drop
  // the archive afterward so only the extracted tree remains.
  await extract(archivePath, join(staging, PNPM_BIN_DIR))
  await rm(archivePath, { force: true })

  const extracted = join(staging, PNPM_BIN_DIR, isZip ? 'pnpm.exe' : 'pnpm')
  if (!existsSync(extracted)) {
    throw new Error(`stage-pnpm: extracted executable not found at ${extracted}`)
  }
  if (process.platform !== 'win32') {
    await chmod(extracted, 0o755)
  }
  console.log(`stage-pnpm: staged pnpm standalone at ${extracted}`)
}

// Direct invocation: `pnpm --filter @deepseek-ai/dsh-desktop run stage-pnpm`
if (import.meta.main) {
  await stagePnpm()
}
