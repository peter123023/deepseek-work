/**
 * Materialize the desktop Host closure into `apps/desktop/runtime-host/`.
 *
 * The closure root is the pure dependency manifest `apps/desktop/runtime`
 * (`@deepseek-ai/dsh-desktop-runtime`), whose dependencies name the dsh CLI and
 * the web bundle. This script reuses the single-exe build's deploy recipe —
 * `pnpm deploy --legacy --prod` into a cleared staging dir, restore legacy
 * hoists, materialize symlinks — then verifies the two packaged entries exist:
 * the `dsh` bin and the web frontend's built `index.html`.
 *
 * Run: `pnpm --filter @deepseek-ai/dsh-desktop run stage-runtime`.
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { cp, lstat, mkdir, readdir, readFile, realpath, rm } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'

const desktopRoot = resolve(import.meta.dirname, '..')
const repositoryRoot = resolve(desktopRoot, '..')
const staging = join(desktopRoot, 'runtime-host')
const deployRoot = join(desktopRoot, 'runtime')
const deployPackage = '@deepseek-ai/dsh-desktop-runtime'

/** Entries whose presence proves the closure is complete. */
const REQUIRED_ENTRIES = [
  'node_modules/@deepseek-ai/dsh/lib/bin.js',
  'node_modules/@deepseek-ai/dsh-web-frontend/dist/index.html',
  // Vendored `overrides` targets `cordis` resolves at runtime; their absence
  // makes the Host fail to boot, so they are first-class closure entries.
  'node_modules/@deepseek-ai/cosmokit/lib/index.js',
  'node_modules/@deepseek-ai/schemastery/lib/index.mjs',
] as const

function pnpmBin(): string {
  return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
}

/** Render a command for logs, quoting arguments with spaces. */
function formatCommand(command: string, args: string[]): string {
  return [command, ...args].map(part => (part.includes(' ') ? JSON.stringify(part) : part)).join(' ')
}

/** Run one subprocess with inherited stdio; failures include the command. */
async function run(label: string, command: string, args: string[]): Promise<void> {
  const printable = formatCommand(command, args)
  console.log(`stage-runtime: ${label}: ${printable}`)
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: repositoryRoot,
      stdio: 'inherit',
      env: { ...process.env, CI: 'true' },
    })
    child.once('error', (error) => {
      reject(new Error(`stage-runtime: ${label} failed to spawn: ${error.message} (${printable})`))
    })
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolvePromise()
        return
      }
      const cause = code === null ? `signal ${signal ?? 'unknown'}` : `exit code ${code}`
      reject(new Error(`stage-runtime: ${label} failed (${cause}): ${printable}`))
    })
  })
}

/** Clear and deploy the runtime closure into the staging directory. */
async function deployStaging(): Promise<void> {
  if (staging === repositoryRoot || repositoryRoot.startsWith(staging + sep)) {
    throw new Error(`stage-runtime: refusing to clear staging dir ${staging}: it contains the repo root.`)
  }
  await rm(staging, { recursive: true, force: true })
  await run('deploy', pnpmBin(), [
    '--config.verify-deps-before-run=false',
    '--config.confirm-modules-purge=false',
    '--filter',
    deployPackage,
    'deploy',
    '--legacy',
    '--prod',
    '--config.node-linker=hoisted',
    '--config.auto-install-peers=false',
    '--config.link-workspace-packages=true',
    staging,
  ])
}

/**
 * Restore direct dependencies pnpm's legacy hoister places beside the deploy
 * source instead of in the target.
 */
async function restoreLegacyHoists(): Promise<void> {
  const manifestPath = join(staging, 'package.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
    dependencies?: Record<string, string>
  }
  const sourceNodeModules = join(deployRoot, 'node_modules')
  for (const dependency of Object.keys(manifest.dependencies ?? {}).sort()) {
    const destination = join(staging, 'node_modules', dependency)
    if (existsSync(destination)) continue
    const source = join(sourceNodeModules, dependency)
    if (!existsSync(source)) {
      throw new Error(`stage-runtime: deployed dependency ${dependency} is absent from both ${destination} and ${source}.`)
    }
    await mkdir(dirname(destination), { recursive: true })
    const nestedNodeModules = join(source, 'node_modules')
    await cp(source, destination, {
      recursive: true,
      dereference: true,
      filter: path => path !== nestedNodeModules && !path.startsWith(nestedNodeModules + sep),
    })
  }
}

/** Replace every staged symlink with its target bytes; reject any remaining link. */
async function materializeLinks(): Promise<void> {
  const nodeModules = join(staging, 'node_modules')
  let remaining = await findSymlink(nodeModules)
  while (remaining !== undefined) {
    const segments = remaining.slice(nodeModules.length + 1).split(sep)
    const binIndex = segments.lastIndexOf('.bin')
    if (binIndex >= 0) {
      await rm(join(nodeModules, ...segments.slice(0, binIndex + 1)), { recursive: true, force: true })
      remaining = await findSymlink(nodeModules)
      continue
    }
    const source = await realpath(remaining)
    const nestedNodeModules = join(source, 'node_modules')
    await rm(remaining, { recursive: true, force: true })
    await cp(source, remaining, {
      recursive: true,
      dereference: true,
      filter: path => path !== nestedNodeModules && !path.startsWith(nestedNodeModules + sep),
    })
    remaining = await findSymlink(nodeModules)
  }
}

/** Return the first symbolic link below a directory, if one exists. */
async function findSymlink(directory: string): Promise<string | undefined> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    const metadata = await lstat(path)
    if (metadata.isSymbolicLink()) return path
    if (metadata.isDirectory()) {
      const nested = await findSymlink(path)
      if (nested !== undefined) return nested
    }
  }
  return undefined
}

/** Verify the packaged entries exist. */
function verifyEntries(): void {
  for (const entry of REQUIRED_ENTRIES) {
    const path = join(staging, entry)
    if (!existsSync(path)) {
      throw new Error(`stage-runtime: ${entry} is missing after deploy; run \`pnpm run build\` so lib/ and dist/ artifacts exist.`)
    }
    console.log(`stage-runtime: verified ${entry}`)
  }
}

await deployStaging()
await restoreLegacyHoists()
await materializeLinks()
verifyEntries()
console.log(`stage-runtime: materialized ${deployPackage} closure into ${staging}`)
