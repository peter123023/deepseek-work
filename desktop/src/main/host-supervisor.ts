/**
 * Owns the lifecycle of the hosted `dsh web` child process.
 *
 * The harness is a Node program, so the supervisor runs it as a child of the
 * Electron main process with `ELECTRON_RUN_AS_NODE=1`, using the staged
 * `runtime-host` closure as the harness installation. Readiness is detected by
 * the URL line the Host prints on stdout once settled, backed by polling its
 * HTTP origin; an unexpected exit surfaces as `failed` and is reported through
 * {@link HostSupervisor.onState}, leaving the restart and quit decision to the
 * caller (the tray-hosted lifecycle, not this supervisor).
 * @module @deepseek-ai/dsh-desktop/host-supervisor
 */

import { spawn, type ChildProcess } from 'node:child_process'
import type { HostFailure, HostState } from '../shared/contracts.ts'

/** The port the Host binds by default; overridable via DSH_HOST_PORT for tests. */
const DEFAULT_PORT = 3080
/** How long to wait between readiness polls while the Host starts. */
const READINESS_POLL_MS = 200
/** How long to wait for a single readiness probe before treating it as not-ready. */
const READINESS_TIMEOUT_MS = 500

/** A listener for {@link HostState} changes. */
export type HostStateListener = (state: HostState) => void

/**
 * Supervise one `dsh web` child process.
 *
 * The supervisor is disposable: {@link stop} terminates the child and drains
 * listeners. It is deliberately restart-free — the caller owns retry policy and
 * creates a fresh supervisor per attempt.
 */
export class HostSupervisor {
  private child: ChildProcess | null = null
  private readonly listeners = new Set<HostStateListener>()
  private state: HostState = { status: 'starting', origin: null, failure: null }
  private stopped = false

  /**
   * @param dshBin - absolute path to the staged `dsh` bin.
   * @param port - the port to request from the Host.
   */
  constructor(
    private readonly dshBin: string,
    private readonly port: number = DEFAULT_PORT,
  ) {}

  /** Subscribe to Host state changes; returns a disposer. */
  onState(listener: HostStateListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** The current {@link HostState} snapshot. */
  get current(): HostState {
    return this.state
  }

  /** Start the child and begin readiness polling. */
  start(): void {
    // `--expose-internals` lets the Host's HMR service reach Node's internal ESM
    // loader. The `node-addon-require-builtin` fallback does not load under
    // Electron's Node (native-ABI mismatch), so the flag is required, not a
    // development convenience.
    const child = spawn(process.execPath, ['--expose-internals', this.dshBin, 'web', '--port', String(this.port)], {
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        DSH_HOME: process.env.DSH_HOME ?? this.defaultHome(),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    this.child = child
    child.stdout.on('data', (chunk: Buffer) => {
      if (!this.stopped) this.onChildOutput(String(chunk))
    })
    child.once('error', (error) => {
      if (!this.stopped) this.fail({ exitCode: null, signal: null, origin: this.state.origin }, error.message)
    })
    child.once('exit', (code, signal) => {
      if (this.stopped) return
      if (this.state.status === 'ready') {
        this.fail({ exitCode: code, signal, origin: this.state.origin })
      } else {
        this.fail({ exitCode: code, signal, origin: null })
      }
    })
    void this.pollReadiness()
  }

  /** Terminate the child and stop polling; idempotent. */
  stop(): void {
    this.stopped = true
    if (this.child !== null && !this.child.killed) {
      this.child.kill('SIGTERM')
    }
    this.child = null
  }

  private defaultHome(): string {
    const home = process.env.HOME ?? process.env.USERPROFILE ?? ''
    return home === '' ? '.deepseek-work' : `${home}/.deepseek-work`
  }

  private onChildOutput(chunk: string): void {
    // The harness prints its URL line (`dsh web: http://127.0.0.1:<port>`) on
    // stdout once the Web server and its /api route owner have settled; that
    // line is the authoritative readiness signal the supervisor keys on. The
    // HTTP probe below is the backstop for a host whose stdout is unavailable.
    for (const line of chunk.split('\n')) {
      const match = /^dsh web: (http:\/\/\S+)/.exec(line)
      if (match !== null) this.onReadyOrigin(match[1]!)
    }
  }

  private setState(next: HostState): void {
    this.state = next
    for (const listener of this.listeners) listener(next)
  }

  private fail(failure: HostFailure, reason?: string): void {
    void reason
    this.setState({ status: 'failed', origin: this.state.origin, failure })
  }

  private async pollReadiness(): Promise<void> {
    while (!this.stopped && this.state.status !== 'ready') {
      const origin = await this.probe()
      if (origin !== null) {
        this.onReadyOrigin(origin)
        return
      }
      if (this.state.status === 'failed') return
      await new Promise(resolve => setTimeout(resolve, READINESS_POLL_MS))
    }
  }

  /** Transition to `ready` at most once; the URL line and HTTP probe race to it. */
  private onReadyOrigin(origin: string): void {
    if (this.stopped || this.state.status === 'ready') return
    this.setState({ status: 'ready', origin, failure: null })
  }

  private async probe(): Promise<string | null> {
    const origin = `http://127.0.0.1:${this.port}`
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), READINESS_TIMEOUT_MS)
      // The SPA index is served by the frontend fallback only after the whole
      // Host tree has settled, so a 200 here means ready. `/api/*` routes are
      // POST-only and return 404 to a GET, so they cannot serve as the probe.
      const response = await fetch(`${origin}/`, { signal: controller.signal })
      clearTimeout(timer)
      return response.ok ? origin : null
    } catch {
      return null
    }
  }
}
