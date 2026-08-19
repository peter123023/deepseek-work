/**
 * Ensure the bundled plugin market is listed in the `web` profile's bundles
 * and resolvable from the profile's module lookup path.
 *
 * The desktop ships `dsh-featured-plugins` inside its own `runtime-host`
 * closure (see `desktop/runtime/package.json`, which pins it via a `file:`
 * reference so the staged installation is self-contained and offline). For the
 * harness loader to actually compose that bundle, two things must hold:
 *
 *   1. its package name must appear in the profile's `dsh.profile.bundles`;
 *   2. the name must resolve from the profile directory through Node's module
 *      lookup — which the harness's `healProfilesModuleFallback` satisfies for
 *      every package in the *dsh app's* dependency closure, but NOT for the
 *      market, because the market is a `desktop/runtime` dependency, not an
 *      `apps/cli` dependency.
 *
 * This module therefore does both: it appends the bundle name (once), and it
 * maintains a `$DSH_HOME/profiles/node_modules/dsh-featured-plugins` symlink
 * pointing at the staged market, replacing any stale/dangling link left by an
 * older workspace layout (e.g. a previous `apps/cli` link that no longer
 * resolves). Neither step runs a package-manager command.
 *
 * @module @deepseek-ai/dsh-desktop/ensure-featured-plugins
 */

import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** The bundle name the staged market publishes under. */
const MARKET_BUNDLE = 'dsh-featured-plugins'
/** The profile the desktop Host always launches (`dsh web`). */
const PROFILE_NAME = 'web'
/** The manifest key path holding the ordered bundle list. */
const PROFILE_DIR_NAME = 'profiles'
/** The harness's own default bundle list for the `web` profile template. */
const WEB_DEFAULT_BUNDLES = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']

interface ProfileManifest {
  dsh?: { profile?: { bundles?: string[] } }
}

/**
 * Resolve the DSH home directory, honouring `DSH_HOME` and falling back to
 * `$HOME/.deepseek-work`, matching the supervisor's own resolution.
 */
function resolveHome(): string {
  const explicit = process.env.DSH_HOME
  if (explicit !== undefined && explicit !== '') return explicit
  const home = process.env.HOME ?? process.env.USERPROFILE ?? ''
  return home === '' ? '.deepseek-work' : `${home}/.deepseek-work`
}

/**
 * Ensure the profile's module fallback links the staged market.
 *
 * `healProfilesModuleFallback` builds `$DSH_HOME/profiles/node_modules/…`
 * symlinks from the dsh app's own dependency closure, but the market lives in
 * the desktop runtime closure instead, so it is never linked there. The
 * loader's Node resolution from `profiles/web/` walks up to this directory and
 * must find a working link; a dangling one (from an older workspace layout)
 * makes resolution fail with `ERR_MODULE_NOT_FOUND`.
 *
 * @param home - the DSH home directory.
 * @param marketDir - absolute path of the staged market package directory.
 * @returns true when the link was created or re-pointed, false when it was
 *   already correct (or the target is missing, in which case it is a no-op).
 */
export function ensureMarketLink(home: string, marketDir: string): boolean {
  const fallbackDir = join(home, PROFILE_DIR_NAME, 'node_modules')
  const linkPath = join(fallbackDir, MARKET_BUNDLE)

  // No staged market means there is nothing to link; leave resolution to the
  // harness's own (authoritative) failure path.
  if (!existsSync(join(marketDir, 'package.json'))) return false

  // Idempotent fast path: an existing link pointing at the current target.
  if (existsSync(linkPath) && lstatSync(linkPath).isSymbolicLink()) {
    if (readlinkSync(linkPath) === marketDir) return false
    // Re-point a stale (or dangling) link at the current staged market.
    unlinkSync(linkPath)
  } else if (existsSync(linkPath)) {
    // A real directory (not a symlink) in the fallback slot is unexpected;
    // leave it alone rather than delete user data.
    return false
  }

  mkdirSync(fallbackDir, { recursive: true })
  symlinkSync(marketDir, linkPath, 'dir')
  return true
}

/**
 * Ensure the market bundle is present in the `web` profile's bundle list.
 *
 * Two first-launch shapes are handled:
 *  - manifest exists → append the market name to `dsh.profile.bundles`;
 *  - manifest missing → seed a fresh manifest with the harness's `web` default
 *    bundles plus the market, so the Host composes the market on the very
 *    first launch (no second-run needed). The harness's `initProfile` is a
 *    no-op once the manifest exists, so seeding ahead of Host start is safe.
 *
 * Idempotent: once `dsh-featured-plugins` is listed it is never re-appended.
 *
 * @param home - optional DSH home override; defaults to {@link resolveHome}.
 * @returns true when the manifest was modified, false otherwise.
 */
export function ensureFeaturedPlugins(home: string = resolveHome()): boolean {
  const profileDir = join(home, PROFILE_DIR_NAME, PROFILE_NAME)
  const manifestPath = join(profileDir, 'package.json')

  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as ProfileManifest
    const bundles = manifest.dsh?.profile?.bundles
    if (bundles === undefined) return false
    if (bundles.includes(MARKET_BUNDLE)) return false

    manifest.dsh!.profile!.bundles = [...bundles, MARKET_BUNDLE]
    writeFileSync(manifestPath, JSON.stringify(manifest, undefined, 2) + '\n')
    return true
  }

  // First launch before the harness has initialised the profile: seed it with
  // the same default bundles the harness would, plus the market, so the market
  // is composed immediately rather than after a second run.
  mkdirSync(profileDir, { recursive: true })
  const manifest: ProfileManifest & { name: string; private: boolean; dependencies: Record<string, never> } = {
    name: `dsh-profile-${PROFILE_NAME}`,
    private: true,
    dependencies: {},
    dsh: { profile: { bundles: [...WEB_DEFAULT_BUNDLES, MARKET_BUNDLE] } },
  }
  writeFileSync(manifestPath, JSON.stringify(manifest, undefined, 2) + '\n')
  return true
}
