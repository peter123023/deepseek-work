/**
 * Preload bridge: the only surface the renderer gets. It exposes the Host
 * state subscription and the restart/quit commands the failure surface needs,
 * with context isolation on and no Node access in the renderer.
 * @module @deepseek-ai/dsh-desktop/preload
 */

import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopBridge, HostState } from '../shared/contracts.ts'

const bridge: DesktopBridge = {
  onHostState(listener: (state: HostState) => void): () => void {
    const handler = (_event: unknown, state: HostState): void => listener(state)
    ipcRenderer.on('desktop:host-state', handler)
    return () => {
      ipcRenderer.removeListener('desktop:host-state', handler)
    }
  },
  restartHost(): void {
    ipcRenderer.send('desktop:restart-host')
  },
  quit(): void {
    ipcRenderer.send('desktop:quit')
  },
}

contextBridge.exposeInMainWorld('desktop', bridge)
