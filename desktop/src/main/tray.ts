/**
 * The tray icon and menu: the application's resident surface when no window is
 * open, and the recovery entry point for a failed Host.
 * @module @deepseek-ai/dsh-desktop/tray
 */

import { Menu, Tray, nativeImage, type NativeImage } from 'electron'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { HostState } from '../shared/contracts.ts'

/** Directory of this bundled module, for resolving assets beside it (ESM-safe: no `__dirname`). */
const MODULE_DIR = fileURLToPath(new URL('.', import.meta.url))

/**
 * Create the tray icon and its menu.
 * @param onShowWindow - restore or create the main window.
 * @param onRestartHost - restart a failed Host.
 * @param onQuit - quit the application.
 * @param getHostState - read the current Host state for menu labels.
 * @returns the created tray.
 */
export function createTray(
  onShowWindow: () => void,
  onRestartHost: () => void,
  onQuit: () => void,
  getHostState: () => HostState,
): Tray {
  const icon = trayIcon()
  const tray = new Tray(icon)
  tray.setToolTip('DeepSeek Harness')

  const rebuild = (): void => {
    const state = getHostState()
    const hostLabel = state.status === 'ready' ? 'Host running' : state.status === 'failed' ? 'Host failed' : 'Host starting'
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Open DeepSeek Harness', click: onShowWindow },
      { label: hostLabel, enabled: false },
      ...(state.status === 'failed'
        ? [{ label: 'Restart Host', click: onRestartHost }]
        : []),
      { type: 'separator' },
      { label: 'Quit', click: onQuit },
    ]))
  }
  rebuild()
  tray.on('click', onShowWindow)
  // The tray menu is rebuilt on demand by the caller when Host state changes.
  return tray
}

/** Resolve the tray icon from the committed build assets. */
function trayIcon(): NativeImage {
  return nativeImage.createFromPath(join(MODULE_DIR, '../../build/tray-icon.png'))
}
