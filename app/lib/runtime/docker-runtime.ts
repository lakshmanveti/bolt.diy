import { atom } from 'nanostores';
import {
  DEFAULT_RUNTIME_DAEMON_URL,
  type AppRuntime,
  type ExecResult,
  type PreviewInfoEvent,
} from './types';
import { isDockerRuntimeAvailable, setDockerRuntimeAvailable } from './deployment-target';
import { formatStartStatus, IDLE_START_STATUS, isLiveDockerStartStage, type DockerStartStatus } from './start-status';

/** Bumps when Docker files change so the iframe reloads once — without mutating the stored preview URL. */
export const dockerPreviewReloadToken = atom(0);

/** True while a follow-up restart is killing/booting the preview process. */
export const dockerPreviewBusy = atom(false);

/** Live Docker start stage for the preview overlay (install / Vite / error). */
export const dockerStartStatus = atom<DockerStartStatus>(IDLE_START_STATUS);

const RELOAD_QUERY = '_bl';
const SKIP_RELOAD_FILES = /(?:^|\/)(?:\.buildlive-|buildlive-inspector\.js$|vite\.config\.|\.bltmp$)/;

function canonicalPreviewUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.searchParams.delete(RELOAD_QUERY);
    parsed.searchParams.delete('blinsp');
    return parsed.toString();
  } catch {
    return url;
  }
}

type PreviewListener = (preview: PreviewInfoEvent) => void;

/** Require a few failures before flipping Ready → Offline (avoids Windows Docker flicker). */
const FAILURES_BEFORE_OFFLINE = 3;
const HEALTH_TIMEOUT_MS = 5000;
const PREVIEW_VERIFY_TIMEOUT_MS = 5000;
/** How often to read start-status while waiting for Vite. Do not poll /preview this often. */
const PREVIEW_WATCH_MS = 2000;
const PREVIEW_HEALTH_MS = 15_000;
const PREVIEW_GIVE_UP_MS = 240_000;
const PREVIEW_INSTALL_GIVE_UP_MS = 10 * 60_000;
const FALLBACK_START_COMMAND = 'npm install && npm run dev -- --host 0.0.0.0 --port 5173';

/** Probe a mapped preview URL — 2xx/3xx counts as reachable (404 = broken preview). */
export async function verifyPreviewReachable(baseUrl: string, timeoutMs = PREVIEW_VERIFY_TIMEOUT_MS): Promise<boolean> {
  try {
    const res = await fetch(baseUrl, {
      method: 'GET',
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    });

    return res.ok || (res.status >= 300 && res.status < 400);
  } catch {
    return false;
  }
}

export interface ResumeResult {
  resumed: boolean;
  softStarted: boolean;
  hasNodeModules: boolean;
  hasFiles: boolean;
  preview?: PreviewInfoEvent;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;

  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }

  return btoa(binary);
}

function toPreviewEvent(preview: {
  port: number;
  hostPort?: number;
  url: string;
  ready: boolean;
}): PreviewInfoEvent {
  return {
    port: preview.hostPort || preview.port,
    ready: preview.ready,
    baseUrl: preview.url,
  };
}

/**
 * Docker-backed AppRuntime talking to the local runtime-daemon (M3).
 */
export class DockerRuntime implements AppRuntime {
  readonly target = 'docker' as const;

  #daemonUrl: string;
  #sessionId: string | undefined;
  #sessionKey: string | undefined;
  #previewListeners = new Set<PreviewListener>();
  #previewPoll: ReturnType<typeof setInterval> | undefined;
  #lastPreviewUrl: string | undefined;
  #lastPreviewPort: number | undefined;
  #reloadTimer: ReturnType<typeof setTimeout> | undefined;
  #previewLock: Promise<unknown> = Promise.resolve();
  #filesWrittenSinceRedeploy = false;
  #streamLocked = false;
  #pendingStartCommand: string | undefined;
  #consecutiveFailures = 0;
  #healthInFlight: Promise<boolean> | undefined;
  /** When reopening a chat, skip rewriting files/exec/start that are already on disk. */
  #hydrateSkipWrites = false;
  #sessionCreate: Promise<void> | undefined;
  /** True after spawn until GET /preview reports HTTP-ready — keep overlay + polling. */
  #waitingForPreview = false;
  #previewWatchId = 0;
  #previewWatchRunning = false;
  /** After install, call POST /resume once — same attach path as a chat page reload. */
  #triedResumeAttach = false;

  constructor(daemonUrl: string = DEFAULT_RUNTIME_DAEMON_URL) {
    this.#daemonUrl = daemonUrl.replace(/\/$/, '');
  }

  async ready(): Promise<void> {
    const healthy = await this.checkHealth({ strict: true });

    if (!healthy) {
      throw new Error(
        'Docker runtime daemon is not available. Start it with `pnpm runtime:daemon` and ensure Docker Desktop is running.',
      );
    }

    if (this.#sessionKey) {
      await this.ensureSession(this.#sessionKey);
    }
  }

  /**
   * While the LLM stream is in flight: write files only. Do not start, restart,
   * or remount the live preview until flushPreview({ fromStreamEnd: true }).
   */
  setStreamLocked(locked: boolean): void {
    if (this.#streamLocked === locked) {
      return;
    }

    this.#streamLocked = locked;

    if (locked && this.#reloadTimer) {
      clearTimeout(this.#reloadTimer);
      this.#reloadTimer = undefined;
      dockerPreviewBusy.set(false);
    }

    if (!locked) {
      void this.flushPreview({ fromStreamEnd: true });
    }
  }

  #setPreviewBusy(busy: boolean) {
    dockerPreviewBusy.set(busy);

    if (!busy && !this.#waitingForPreview) {
      if (dockerStartStatus.get().stage === 'ready') {
        dockerStartStatus.set(IDLE_START_STATUS);
      }
    }
  }

  #markPreviewPending() {
    this.#waitingForPreview = true;
    this.#setPreviewBusy(true);
    this.#beginPreviewWatch();
  }

  #markPreviewLive(preview: PreviewInfoEvent) {
    this.#stopPreviewWatch();
    this.#waitingForPreview = false;
    this.#lastPreviewUrl = undefined;
    this.#emitPreview(preview);
    this.#bumpReloadToken();
    this.#setPreviewBusy(false);
    this.#startPreviewPolling();
  }

  async #pullStartStatus() {
    if (!this.#sessionId) {
      return;
    }

    try {
      const res = await fetch(`${this.#daemonUrl}/sessions/${this.#sessionId}/start-status`, {
        cache: 'no-store',
      });

      if (!res.ok) {
        return;
      }

      const data = (await res.json()) as {
        stage?: string;
        packageName?: string | null;
        packagesAdded?: number | null;
        error?: string | null;
        startedAt?: number;
      };
      const formatted = formatStartStatus(data);
      const current = dockerStartStatus.get();

      if (formatted.stage === 'idle' && isLiveDockerStartStage(current.stage)) {
        return;
      }

      dockerStartStatus.set(formatted);
    } catch {
      // overlay keeps the last known status
    }
  }
  /**
   * Chat reopen: session files/preview already exist — don't replay snapshot writes.
   * Cleared automatically on the next real user turn.
   */
  setHydrateSkipWrites(skip: boolean): void {
    this.#hydrateSkipWrites = skip;

    if (skip) {
      dockerPreviewReloadToken.set(0);
    }
  }

  async checkHealth(options?: { strict?: boolean }): Promise<boolean> {
    if (this.#healthInFlight && !options?.strict) {
      return this.#healthInFlight;
    }

    const probe = this.#probeHealth(Boolean(options?.strict)).finally(() => {
      if (this.#healthInFlight === probe) {
        this.#healthInFlight = undefined;
      }
    });

    if (!options?.strict) {
      this.#healthInFlight = probe;
    }

    return probe;
  }

  async #probeHealth(strict: boolean): Promise<boolean> {
    try {
      const res = await fetch(`${this.#daemonUrl}/health`, {
        signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
      });

      if (!res.ok) {
        return this.#recordFailure(strict);
      }

      const data = (await res.json()) as { ok?: boolean; docker?: boolean };
      const available = Boolean(data.ok && data.docker);

      if (available) {
        this.#consecutiveFailures = 0;
        setDockerRuntimeAvailable(true);
        return true;
      }

      return this.#recordFailure(strict);
    } catch {
      return this.#recordFailure(strict);
    }
  }

  #recordFailure(strict: boolean): boolean {
    this.#consecutiveFailures += 1;

    if (strict || this.#consecutiveFailures >= FAILURES_BEFORE_OFFLINE || !isDockerRuntimeAvailable()) {
      setDockerRuntimeAvailable(false);
      return false;
    }

    // Soft failure while already Ready — keep badge stable through transient blips
    return true;
  }

  /**
   * Bind to a chat/project. Reuses the daemon session for this chatId when present.
   */
  async ensureSession(sessionKey?: string): Promise<void> {
    if (sessionKey && sessionKey !== this.#sessionKey) {
      this.#sessionKey = sessionKey;
      this.#sessionId = undefined;
      this.#sessionCreate = undefined;
      this.#lastPreviewUrl = undefined;
      this.#lastPreviewPort = undefined;
      this.#pendingStartCommand = undefined;
      this.#waitingForPreview = false;
      this.#triedResumeAttach = false;
      this.#stopPreviewWatch();
      this.#stopPreviewPolling();
      void import('~/lib/stores/workbench')
        .then(({ workbenchStore }) => {
          workbenchStore.clearPreviews();
        })
        .catch(() => undefined);
    } else if (sessionKey) {
      this.#sessionKey = sessionKey;
    }

    if (!this.#sessionKey) {
      return;
    }

    if (this.#sessionId) {
      return;
    }

    if (!this.#sessionCreate) {
      this.#sessionCreate = this.#createDaemonSession();
    }

    try {
      await this.#sessionCreate;
    } catch (error) {
      this.#sessionCreate = undefined;
      throw error;
    }
  }

  /**
   * Stop the container and delete the on-disk session for this chat.
   * No-ops if the daemon is down or the session is already gone.
   */
  async destroySessionForChat(chatId: string): Promise<void> {
    const key = chatId.trim();

    if (!key) {
      return;
    }

    if (this.#sessionKey === key || this.#sessionId === key) {
      this.#unbindLocalSession();
    }

    try {
      const res = await fetch(`${this.#daemonUrl}/sessions/by-chat/${encodeURIComponent(key)}`, {
        method: 'DELETE',
      });

      if (!res.ok && res.status !== 404) {
        console.warn(`[docker-runtime] failed to destroy session for chat ${key}: ${res.status}`);
      }
    } catch {
      // Daemon not running — chat delete should still succeed
    }
  }

  #unbindLocalSession() {
    this.#stopPreviewPolling();
    this.#sessionId = undefined;
    this.#sessionKey = undefined;
    this.#sessionCreate = undefined;
    this.#lastPreviewUrl = undefined;
    this.#lastPreviewPort = undefined;
    this.#waitingForPreview = false;
    this.#triedResumeAttach = false;
    this.#hydrateSkipWrites = false;
    this.#stopPreviewWatch();
    dockerPreviewBusy.set(false);
    dockerStartStatus.set(IDLE_START_STATUS);
  }

  async #createDaemonSession(): Promise<void> {
    const chatId = this.#sessionKey;

    if (!chatId) {
      throw new Error('Docker session requires a chat id');
    }
    const res = await fetch(`${this.#daemonUrl}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err as { error?: string }).error || 'Failed to create Docker runtime session');
    }

    const data = (await res.json()) as {
      id: string;
      preview?: { port: number; hostPort: number; url: string; ready: boolean } | null;
    };
    this.#sessionId = data.id;

    if (data.preview?.ready && data.preview.url) {
      this.#emitPreview(toPreviewEvent(data.preview));
      this.#startPreviewPolling();
    }
  }

  /**
   * Attach like a chat page reload: probe the running server, or soft-start Vite
   * now that node_modules exists. `quiet` skips resetting the overlay (used from
   * the first-generate wait loop).
   */
  async resume(chatId: string, options?: { quiet?: boolean }): Promise<ResumeResult> {
    if (!options?.quiet) {
      dockerStartStatus.set(formatStartStatus({ stage: 'container', startedAt: Date.now() }));
      this.#setPreviewBusy(true);
    }

    try {
      await this.ensureSession(chatId);
      void this.#pullStartStatus();

      const res = await fetch(`${this.#daemonUrl}/sessions/${this.#sessionId}/resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || 'Failed to resume Docker session');
      }

      const data = (await res.json()) as {
        resumed?: boolean;
        softStarted?: boolean;
        hasNodeModules?: boolean;
        hasFiles?: boolean;
        preview?: { port: number; hostPort: number; url: string; ready: boolean } | null;
      };

      const preview = data.preview?.ready && data.preview.url ? toPreviewEvent(data.preview) : undefined;

      if (preview) {
        this.#markPreviewLive(preview);
      } else if (data.softStarted || data.preview) {
        this.#markPreviewPending();
      }

      return {
        resumed: Boolean(data.resumed),
        softStarted: Boolean(data.softStarted),
        hasNodeModules: Boolean(data.hasNodeModules),
        hasFiles: Boolean(data.hasFiles),
        preview,
      };
    } finally {
      if (!this.#waitingForPreview) {
        this.#setPreviewBusy(false);
      }
    }
  }

  async writeFile(filePath: string, content: string | Uint8Array): Promise<void> {
    await this.ensureSession();

    const normalized = filePath.replace(/\\/g, '/').replace(/^\/home\/project\//, '').replace(/^\//, '');
    const body =
      typeof content === 'string'
        ? { path: normalized, content }
        : { path: normalized, content: { data: toBase64(content), encoding: 'base64' } };

    const res = await fetch(`${this.#daemonUrl}/sessions/${this.#sessionId}/files`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err as { error?: string }).error || `Failed to write ${normalized}`);
    }

    if (!this.#hydrateSkipWrites && !SKIP_RELOAD_FILES.test(normalized)) {
      this.#filesWrittenSinceRedeploy = true;

      // Never restart Docker while /api/chat is still streaming.
      if (!this.#streamLocked && this.#lastPreviewUrl) {
        this.#schedulePreviewRedeploy();
      }
    }
  }

  /**
   * Force a fresh preview document load so disk changes are visible (no HMR).
   */
  reloadPreview(): void {
    void this.restartPreview({ ignoreHydrateSkip: true });
  }

  /**
   * Kill and boot Vite again. Used after .env writes and on chat reopen so
   * import.meta.env is not stuck from the previous process.
   */
  async restartPreview(options?: { ignoreHydrateSkip?: boolean }): Promise<PreviewInfoEvent | null> {
    if (this.#hydrateSkipWrites && !options?.ignoreHydrateSkip) {
      return null;
    }

    this.#streamLocked = false;
    this.#setPreviewBusy(true);

    try {
      const preview = await this.#restartPreviewProcess();

      if (preview) {
        return preview;
      }

      this.#markPreviewPending();
      return null;
    } finally {
      if (!this.#waitingForPreview) {
        this.#setPreviewBusy(false);
      }
    }
  }

  /**
   * After a chat turn finishes (including "Ask BuildLive" error fixes), wait for
   * pending file writes to land, restart if needed, then remount the iframe.
   */
  async flushPreview(options?: { fromStreamEnd?: boolean }): Promise<void> {
    if (options?.fromStreamEnd) {
      this.#streamLocked = false;
    }

    if (this.#hydrateSkipWrites || this.#streamLocked) {
      return;
    }

    await this.ensureSession();

    if (!this.#sessionId) {
      return;
    }

    if (this.#waitingForPreview || this.#previewWatchRunning) {
      this.#beginPreviewWatch();
      return;
    }

    if (this.#reloadTimer) {
      clearTimeout(this.#reloadTimer);
      this.#reloadTimer = undefined;
    }

    await this.#withPreviewLock(async () => undefined);

    const needsRestart = this.#filesWrittenSinceRedeploy || Boolean(this.#pendingStartCommand);

    // A reachable old Vite URL is not enough after file writes: .env and new
    // deps are only picked up after a process restart.
    if (!needsRestart && this.#lastPreviewUrl && (await verifyPreviewReachable(this.#lastPreviewUrl))) {
      this.#bumpReloadToken();
      this.#setPreviewBusy(false);
      return;
    }

    if (this.#pendingStartCommand) {
      const command = this.#pendingStartCommand;
      this.#pendingStartCommand = undefined;
      await this.#startProcess(command);
      return;
    }

    if (needsRestart || !this.#lastPreviewUrl) {
      const preview = await this.#restartPreviewProcess();

      if (preview) {
        return;
      }

      try {
        await this.#startProcess(FALLBACK_START_COMMAND);
      } catch (error) {
        console.warn('[DockerRuntime] fallback start failed', error);
        this.#beginPreviewWatch();
      }

      return;
    }

    this.#setPreviewBusy(false);
  }

  /**
   * Restart the preview process in Docker (user retry or auto-recovery).
   * Emits a new preview event when the daemon reports ready.
   */
  async recoverPreview(): Promise<PreviewInfoEvent | null> {
    await this.ensureSession();

    if (!this.#sessionId) {
      return null;
    }

    if (this.#waitingForPreview || this.#previewWatchRunning) {
      return null;
    }

    this.#setPreviewBusy(true);

    try {
      const restarted = await this.#restartPreviewProcess();

      if (restarted) {
        return restarted;
      }

      await this.#startProcess(this.#pendingStartCommand || FALLBACK_START_COMMAND);
      this.#beginPreviewWatch();
      return null;
    } finally {
      if (!this.#waitingForPreview) {
        this.#setPreviewBusy(false);
      }
    }
  }

  #schedulePreviewRedeploy(delayMs = 1500) {
    if (this.#hydrateSkipWrites || this.#streamLocked) {
      return;
    }

    if (this.#reloadTimer) {
      clearTimeout(this.#reloadTimer);
    }

    this.#reloadTimer = setTimeout(() => {
      this.#reloadTimer = undefined;
      void this.#redeployPreview();
    }, delayMs);
  }

  #bumpReloadToken() {
    dockerPreviewReloadToken.set(dockerPreviewReloadToken.get() + 1);
  }

  #withPreviewLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.#previewLock.then(fn, fn);
    this.#previewLock = run.then(
      () => undefined,
      () => undefined,
    );

    return run;
  }

  async #restartPreviewProcess(): Promise<PreviewInfoEvent | null> {
    if (!this.#sessionId || this.#streamLocked) {
      return null;
    }

    try {
      const res = await fetch(`${this.#daemonUrl}/sessions/${this.#sessionId}/restart`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });

      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        preview?: { port: number; hostPort: number; url: string; ready: boolean } | null;
      };

      if (!res.ok) {
        this.#waitingForPreview = false;
        console.warn('[DockerRuntime] preview restart failed:', data.error);
        return null;
      }

      this.#filesWrittenSinceRedeploy = false;

      if (data.preview?.ready && data.preview.url) {
        this.#markPreviewLive(toPreviewEvent(data.preview));
        return toPreviewEvent(data.preview);
      }

      this.#markPreviewPending();
      return null;
    } catch (error) {
      console.warn('[DockerRuntime] preview restart failed:', error);
      return null;
    }
  }

  async #redeployPreview(): Promise<PreviewInfoEvent | null> {
    if (this.#hydrateSkipWrites || !this.#sessionId || this.#streamLocked) {
      return null;
    }

    return this.#withPreviewLock(async () => {
      this.#setPreviewBusy(true);

      try {
        let lastResult: PreviewInfoEvent | null = null;

        do {
          lastResult = await this.#restartPreviewProcess();
        } while (lastResult && this.#filesWrittenSinceRedeploy);

        return lastResult;
      } finally {
        if (!this.#waitingForPreview) {
          this.#setPreviewBusy(false);
        }
      }
    });
  }

  async mkdir(dirPath: string, _options?: { recursive?: boolean }): Promise<void> {
    if (this.#hydrateSkipWrites) {
      return;
    }

    await this.ensureSession();
    const normalized = dirPath.replace(/\\/g, '/').replace(/^\/home\/project\//, '').replace(/^\//, '');

    if (!normalized || normalized === '.') {
      return;
    }

    const result = await this.exec(`mkdir -p ${JSON.stringify(normalized)}`);

    if (result.exitCode !== 0) {
      throw new Error(result.output || `Failed to mkdir ${normalized}`);
    }
  }

  async readFile(filePath: string, _encoding: 'utf8' = 'utf8'): Promise<string> {
    await this.ensureSession();
    // MVP: read via exec cat
    const normalized = filePath.replace(/\\/g, '/').replace(/^\/home\/project\//, '').replace(/^\//, '');
    const result = await this.exec(`cat ${JSON.stringify(normalized)}`);

    if (result.exitCode !== 0) {
      throw new Error(result.output || `Failed to read ${normalized}`);
    }

    return result.output;
  }

  async exec(command: string): Promise<ExecResult> {
    if (this.#hydrateSkipWrites) {
      return { exitCode: 0, output: '' };
    }

    await this.ensureSession();

    const res = await fetch(`${this.#daemonUrl}/sessions/${this.#sessionId}/exec`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err as { error?: string }).error || 'Docker exec failed');
    }

    const data = (await res.json()) as ExecResult;
    return { exitCode: data.exitCode, output: data.output || '' };
  }

  async start(command: string): Promise<PreviewInfoEvent | void> {
    await this.ensureSession();

    if (this.#hydrateSkipWrites && this.#lastPreviewUrl) {
      return {
        port: this.#lastPreviewPort || 5173,
        ready: true,
        baseUrl: this.#lastPreviewUrl,
      };
    }

    if (this.#streamLocked) {
      this.#pendingStartCommand = command;
      this.#filesWrittenSinceRedeploy = true;
      dockerStartStatus.set(
        formatStartStatus({
          stage: 'container',
          startedAt: dockerStartStatus.get().startedAt || Date.now(),
        }),
      );
      // Do not mark busy here — flushPreview restarts after the stream.
      // Leaving busy=true with no watch is what stuck "Starting your app…".
      return;
    }

    if (this.#lastPreviewUrl) {
      if (this.#reloadTimer) {
        clearTimeout(this.#reloadTimer);
        this.#reloadTimer = undefined;
      }

      const preview = await this.#redeployPreview();

      if (preview) {
        return preview;
      }
    }

    return this.#startProcess(command);
  }

  async #startProcess(command: string): Promise<PreviewInfoEvent | void> {
    return this.#withPreviewLock(async () => {
      if (this.#streamLocked) {
        this.#pendingStartCommand = command;
        return;
      }

      this.#setPreviewBusy(true);
      this.#triedResumeAttach = false;
      dockerStartStatus.set(formatStartStatus({ stage: 'install', startedAt: Date.now() }));

      try {
        const res = await fetch(`${this.#daemonUrl}/sessions/${this.#sessionId}/start`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ command, resume: false }),
        });

        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          output?: string;
          resumed?: boolean;
          pending?: boolean;
          preview?: { port: number; hostPort: number; url: string; ready: boolean } | null;
        };

        if (!res.ok) {
          this.#waitingForPreview = false;
          throw new Error(data.error || data.output || 'Docker start failed');
        }

        this.#filesWrittenSinceRedeploy = false;
        this.#pendingStartCommand = undefined;

        if (data.preview?.url && data.preview.ready) {
          this.#markPreviewLive(toPreviewEvent(data.preview));
          return toPreviewEvent(data.preview);
        }

        this.#markPreviewPending();
        return undefined;
      } finally {
        if (!this.#waitingForPreview) {
          this.#setPreviewBusy(false);
        }
      }
    });
  }

  onPreview(callback: PreviewListener): () => void {
    this.#previewListeners.add(callback);
    this.#startPreviewPolling();

    return () => {
      this.#previewListeners.delete(callback);

      if (this.#previewListeners.size === 0) {
        this.#stopPreviewPolling();
      }
    };
  }

  #emitPreview(preview: PreviewInfoEvent) {
    const next: PreviewInfoEvent = preview.ready
      ? { ...preview, baseUrl: canonicalPreviewUrl(preview.baseUrl) }
      : preview;

    if (next.ready) {
      this.#lastPreviewUrl = next.baseUrl;
      this.#lastPreviewPort = next.port;
    }

    for (const listener of this.#previewListeners) {
      listener(next);
    }
  }

  #stopPreviewWatch() {
    this.#previewWatchId += 1;
    this.#previewWatchRunning = false;
  }

  #beginPreviewWatch() {
    this.#waitingForPreview = true;
    this.#setPreviewBusy(true);
    this.#stopPreviewPolling();

    if (this.#previewWatchRunning) {
      return;
    }

    const watchId = ++this.#previewWatchId;
    this.#previewWatchRunning = true;
    void this.#runPreviewWatch(watchId).finally(() => {
      if (watchId === this.#previewWatchId) {
        this.#previewWatchRunning = false;
      }
    });
  }

  async #runPreviewWatch(watchId: number) {
    const startedAt = Date.now();

    while (watchId === this.#previewWatchId) {
      if (!this.#sessionId) {
        return;
      }

      await this.#pullStartStatus();

      const stage = dockerStartStatus.get().stage;
      const installing = stage === 'install' || stage === 'container';
      const waited = Date.now() - startedAt;

      // Same path as a chat page reload: once packages are in, POST /resume
      // force-probes Vite or soft-starts it. GET /preview alone never did this.
      if ((stage === 'server' || stage === 'ready') && !this.#triedResumeAttach && this.#sessionKey) {
        this.#triedResumeAttach = true;
        const result = await this.resume(this.#sessionKey, { quiet: true });

        if (result.preview?.ready) {
          return;
        }
      }

      if (!installing || waited >= 20_000) {
        const live = await this.#attachIfPreviewReady();

        if (live) {
          return;
        }
      }

      const elapsed = Date.now() - startedAt;
      const giveUpMs = installing ? PREVIEW_INSTALL_GIVE_UP_MS : PREVIEW_GIVE_UP_MS;

      if (elapsed >= giveUpMs) {
        if (watchId === this.#previewWatchId) {
          this.#waitingForPreview = false;
          this.#setPreviewBusy(false);
          dockerStartStatus.set(
            formatStartStatus({
              stage: 'error',
              error: 'Preview did not become ready. Click Retry.',
              startedAt,
            }),
          );
        }

        return;
      }

      await new Promise((resolve) => setTimeout(resolve, PREVIEW_WATCH_MS));
    }
  }

  async #attachIfPreviewReady(): Promise<boolean> {
    if (!this.#sessionId) {
      return false;
    }

    try {
      const res = await fetch(`${this.#daemonUrl}/sessions/${this.#sessionId}/preview`, {
        cache: 'no-store',
      });

      if (!res.ok) {
        return false;
      }

      const data = (await res.json()) as {
        preview?: { port: number; hostPort?: number; url: string; ready: boolean } | null;
      };

      if (data.preview?.ready && data.preview.url) {
        const event = toPreviewEvent(data.preview);

        if (this.#waitingForPreview) {
          this.#markPreviewLive(event);
        } else {
          this.#emitPreview(event);
        }

        return true;
      }
    } catch {
      // keep waiting through transient daemon/Docker blips
    }

    return false;
  }

  #startPreviewPolling() {
    if (this.#previewPoll || !this.#sessionId || this.#waitingForPreview || !this.#lastPreviewUrl) {
      return;
    }

    this.#previewPoll = setInterval(() => {
      void this.#pollPreview();
    }, PREVIEW_HEALTH_MS);
  }

  #stopPreviewPolling() {
    if (this.#previewPoll) {
      clearInterval(this.#previewPoll);
      this.#previewPoll = undefined;
    }
  }

  async #pollPreview() {
    if (!this.#sessionId || this.#previewListeners.size === 0) {
      return;
    }

    if (this.#streamLocked || this.#waitingForPreview) {
      return;
    }

    await this.#attachIfPreviewReady();
  }
}

export const DOCKER_RUNTIME_NOT_CONFIGURED =
  'Docker runtime is not configured yet. Start the local runtime daemon (`pnpm runtime:daemon`) and ensure Docker Desktop is running.';
