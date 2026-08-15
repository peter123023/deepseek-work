/**
 * electron-builder `afterPack` hook: verify the packaged app carries a complete
 * Host closure before the installer is produced. The hook receives the
 * after-pack context; `appOutDir` is the packaged `.app`/unpacked directory
 * whose `Contents/Resources` (macOS) or root (Windows) holds the `extraResources`
 * `host/` payload.
 */

import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/** Entry points the packaged Host must carry, relative to the resources root. */
const REQUIRED = [
  'host/node_modules/@deepseek-ai/dsh/lib/bin.js',
  'host/node_modules/@deepseek-ai/dsh-web-frontend/dist/index.html',
] as const

/** afterPack context shape: the `appOutDir` is the unpacked app directory. */
interface AfterPackContext {
  appOutDir: string
  electronPlatformName: string
}

export default function verifyPackagedRuntime(context: AfterPackContext): void {
  const resourcesRoot = context.electronPlatformName === 'darwin'
    ? macResourcesRoot(context.appOutDir)
    : context.appOutDir
  for (const entry of REQUIRED) {
    const full = join(resourcesRoot, entry)
    if (!existsSync(full)) {
      throw new Error(`verify-packaged-runtime: ${entry} missing from packaged app at ${full}`)
    }
    console.log(`verify-packaged-runtime: verified ${entry}`)
  }
}

/**
 * Locate the `.app/Contents/Resources` directory under `appOutDir`. On macOS the
 * extraResources payload lands inside the named `.app` bundle, one level below
 * `appOutDir`; find it rather than assuming the product name.
 */
function macResourcesRoot(appOutDir: string): string {
  for (const entry of readdirSync(appOutDir)) {
    if (entry.endsWith('.app')) {
      const candidate = join(appOutDir, entry, 'Contents', 'Resources')
      if (existsSync(candidate)) return candidate
    }
  }
  // Fallback for a `dir` target without the .app wrapper.
  return join(appOutDir, 'Contents', 'Resources')
}
