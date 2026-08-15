/**
 * Window lifecycle for the tray-hosted desktop shell.
 *
 * The window is a view over the Host, not the application's owner: closing it
 * hides rather than quits, and the tray restores it. `window-all-closed` is a
 * no-op on every platform because the tray and Host own application lifetime.
 * @module @deepseek-ai/dsh-desktop/window-lifecycle
 */

import { BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Directory of this bundled module, for resolving the preload beside it (ESM-safe: no `__dirname`). */
const MODULE_DIR = fileURLToPath(new URL('.', import.meta.url))

/** The product title shown in the window chrome and macOS title bar. */
const WINDOW_TITLE = 'DeepSeek Work'

/** The web title's brand suffix, replaced with {@link WINDOW_TITLE} in the chrome. */
const WEB_BRAND_SUFFIX = 'DeepSeek Harness'

/**
 * Rebrand the page's document title for the desktop chrome only, preserving any
 * session title the web UI prepends (e.g. `Session — DeepSeek Harness` becomes
 * `Session — DeepSeek Work`).
 * @param title - the page title emitted by `page-title-updated`.
 * @returns the rebranded title.
 */
function rebrandTitle(title: string): string {
  return title.replace(WEB_BRAND_SUFFIX, WINDOW_TITLE)
}

/**
 * Create the single main window pointing at a Host origin, or restore the
 * existing window when one is already open.
 * @param origin - the Host HTTP origin the window loads.
 * @returns the created or restored window.
 */
export function showWindow(origin: string): BrowserWindow {
  const existing = BrowserWindow.getAllWindows()[0]
  if (existing !== undefined) {
    if (existing.isMinimized()) existing.restore()
    existing.focus()
    return existing
  }
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    show: false,
    title: WINDOW_TITLE,
    webPreferences: {
      preload: join(MODULE_DIR, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  window.once('ready-to-show', () => window.show())
  // Keep the desktop chrome title branded without mutating the web app: any
  // title the page sets has its `DeepSeek Harness` suffix rewritten.
  window.webContents.on('page-title-updated', (event, title) => {
    event.preventDefault()
    window.setTitle(rebrandTitle(title))
  })
  // External links and new windows open in the system browser, never in-process.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== origin && !url.startsWith(`${origin}/`)) {
      event.preventDefault()
      void shell.openExternal(url)
    }
  })
  void window.loadURL(origin)
  return window
}
