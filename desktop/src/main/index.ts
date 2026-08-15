/**
 * Main-process entry: wires the Host supervisor, tray, and window together
 * under the tray-hosted lifecycle. The tray and the Host own application
 * lifetime on every platform, so `window-all-closed` does not quit.
 * @module @deepseek-ai/dsh-desktop/main
 */

import { app, dialog, ipcMain, type Tray } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { HostState } from '../shared/contracts.ts'
import { HostSupervisor } from './host-supervisor.ts'
import { createTray } from './tray.ts'
import { showWindow } from './window-lifecycle.ts'

let supervisor: HostSupervisor | null = null
let tray: Tray | null = null
let hostOrigin: string | null = null

/**
 * Resolve the staged harness bin or fail loudly: a desktop shell without its
 * Host closure is misconfigured, not recoverable.
 * @returns the absolute path to the staged `dsh` bin.
 */
function requireDshBin(): string {
  // Packaged: the closure is materialized beside the asar under resources/host.
  // Development: it lives at apps/desktop/runtime-host.
  const candidates = [
    join(app.getAppPath(), '../host/node_modules/@deepseek-ai/dsh/lib/bin.js'),
    join(app.getAppPath(), 'runtime-host/node_modules/@deepseek-ai/dsh/lib/bin.js'),
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  throw new Error('dsh-desktop: runtime-host closure is missing; run `pnpm --filter @deepseek-ai/dsh-desktop run stage-runtime` before launching.')
}

function startHost(): void {
  supervisor = new HostSupervisor(requireDshBin())
  supervisor.onState((state) => {
    hostOrigin = state.origin
    if (state.status === 'ready' && state.origin !== null) {
      showWindow(state.origin)
    } else if (state.status === 'failed') {
      void showFailureDialog(state)
    }
  })
  supervisor.start()
}

function showFailureDialog(state: HostState): void {
  const failure = state.failure
  const cause = failure?.exitCode === null ? `signal ${failure?.signal ?? 'unknown'}` : `exit code ${failure?.exitCode ?? 'unknown'}`
  void dialog.showMessageBox({
    type: 'error',
    title: 'DeepSeek Harness',
    message: 'The harness host stopped unexpectedly.',
    detail: `The hosted dsh process ended (${cause}).`,
    buttons: ['Restart', 'Quit'],
    defaultId: 0,
    cancelId: 1,
  }).then(({ response }) => {
    if (response === 0) restartHost()
    else app.quit()
  })
}

function restartHost(): void {
  supervisor?.stop()
  supervisor = null
  startHost()
}

app.whenReady().then(() => {
  ipcMain.on('desktop:restart-host', () => restartHost())
  ipcMain.on('desktop:quit', () => app.quit())
  tray = createTray(
    () => {
      if (hostOrigin !== null) showWindow(hostOrigin)
    },
    () => restartHost(),
    () => app.quit(),
    () => ({
      status: supervisor?.current.status ?? 'starting',
      origin: hostOrigin,
      failure: supervisor?.current.failure ?? null,
    }),
  )
  startHost()
})

// Tray and Host own application lifetime on every platform.
app.on('window-all-closed', () => {
  // Intentionally empty: the app stays resident in the tray.
})

app.on('before-quit', () => {
  supervisor?.stop()
  supervisor = null
  if (tray !== null) {
    tray.destroy()
    tray = null
  }
})
