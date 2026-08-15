/**
 * Types shared between the Electron main process and the preload bridge.
 *
 * The Host supervisor owns a small state machine; this module carries the
 * state vocabulary across the process boundary so the renderer can render
 * Host readiness and crash recovery without reaching into supervisor internals.
 * @module @deepseek-ai/dsh-desktop/shared
 */

/** The observable state of the hosted `dsh web` child process. */
export type HostStatus = 'starting' | 'ready' | 'failed'

/** A failed Host, carrying what the supervisor knows for the recovery surface. */
export interface HostFailure {
  /** Exit code when the child exited normally, null when it was signalled. */
  exitCode: number | null
  /** Terminating signal when exitCode is null. */
  signal: string | null
  /** The bound origin the Host reported before failing, if readiness was reached. */
  origin: string | null
}

/** One event the main process forwards to the renderer over the preload bridge. */
export interface HostState {
  status: HostStatus
  /** The HTTP origin the Host serves once ready (e.g. http://127.0.0.1:3080). */
  origin: string | null
  /** Populated when status is `failed`. */
  failure: HostFailure | null
}

/** The channels the preload bridge exposes to the renderer. */
export interface DesktopBridge {
  /** Subscribe to Host state changes; returns a disposer. */
  onHostState(listener: (state: HostState) => void): () => void
  /** Ask the main process to restart a failed Host. */
  restartHost(): void
  /** Ask the main process to quit the whole application. */
  quit(): void
}
