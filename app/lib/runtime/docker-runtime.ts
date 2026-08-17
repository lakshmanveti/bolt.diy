import { atom } from 'nanostores';
import {
  DEFAULT_RUNTIME_DAEMON_URL,
  type AppRuntime,
  type ExecResult,
  type PreviewInfoEvent,
} from './types';
import { isDockerRuntimeAvailable, setDockerRuntimeAvailable } from './deployment-target';

/** Bumps when Docker files change so the iframe reloads once — without mutating the stored preview URL. */
export const dockerPreviewReloadToken = atom(0);

/** True while a follow-up restart is killing/booting the preview process. */
export const dockerPreviewBusy = atom(false);

const RELOAD_QUERY = '_bl';
const SKIP_RELOAD_FILES = /(?:^|\/)(?:\.buildlive-|buildlive-inspector\.js$|vite\.config\.)/;

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

    await this.ensureSession(this.#sessionKey);
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
      this.#lastPreviewUrl = undefined;
      this.#lastPreviewPort = undefined;
      this.#stopPreviewPolling();
    } else if (sessionKey) {
      this.#sessionKey = sessionKey;
    }

    if (this.#sessionId) {
      return;
    }

    const chatId = this.#sessionKey || `session-${Date.now()}`;
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
    this.#startPreviewPolling();

    if (data.preview?.ready && data.preview.url) {
      this.#emitPreview(toPreviewEvent(data.preview));
    }
  }

  /**
   * Reopen an existing chat: attach warm preview or soft-start without a full cold install.
   */
  async resume(chatId: string): Promise<ResumeResult> {
    await this.ensureSession(chatId);

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
      this.#emitPreview(preview);
    }

    return {
      resumed: Boolean(data.resumed),
      softStarted: Boolean(data.softStarted),
      hasNodeModules: Boolean(data.hasNodeModules),
      hasFiles: Boolean(data.hasFiles),
      preview,
    };
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
    this.#schedulePreviewRedeploy(0);
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

    if (this.#reloadTimer) {
      clearTimeout(this.#reloadTimer);
      this.#reloadTimer = undefined;
    }

    await this.#withPreviewLock(async () => undefined);

    if (this.#pendingStartCommand && !this.#lastPreviewUrl) {
      const command = this.#pendingStartCommand;
      this.#pendingStartCommand = undefined;
      await this.#startProcess(command);
      return;
    }

    if (this.#filesWrittenSinceRedeploy || !this.#lastPreviewUrl) {
      const preview = await this.#redeployPreview();

      if (preview) {
        this.#pendingStartCommand = undefined;
        return;
      }

      if (this.#pendingStartCommand) {
        const command = this.#pendingStartCommand;
        this.#pendingStartCommand = undefined;
        await this.#startProcess(command);
        return;
      }
    }

    if (this.#lastPreviewUrl) {
      const reachable = await verifyPreviewReachable(this.#lastPreviewUrl);

      if (!reachable) {
        await this.#redeployPreview();
        return;
      }

      this.#bumpReloadToken();
    }
  }

  /**
   * Restart the preview process in Docker (user retry or auto-recovery).
   * Emits a new preview event when the daemon reports ready.
   */
  async recoverPreview(): Promise<PreviewInfoEvent | null> {
    if (this.#streamLocked) {
      if (this.#lastPreviewUrl) {
        return {
          port: this.#lastPreviewPort || 5173,
          ready: true,
          baseUrl: this.#lastPreviewUrl,
        };
      }

      return null;
    }
    await this.ensureSession();

    if (!this.#sessionId) {
      return null;
    }

    return this.#withPreviewLock(async () => {
      if (this.#lastPreviewUrl && (await verifyPreviewReachable(this.#lastPreviewUrl))) {
        return {
          port: this.#lastPreviewPort || 5173,
          ready: true,
          baseUrl: this.#lastPreviewUrl,
        };
      }

      dockerPreviewBusy.set(true);

      try {
        return await this.#restartPreviewProcess();
      } finally {
        dockerPreviewBusy.set(false);
      }
    });
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

      if (!res.ok || !data.preview?.ready || !data.preview.url) {
        console.warn('[DockerRuntime] preview restart failed:', data.error);
        return null;
      }

      // Allow re-emit even if host port/URL are unchanged
      this.#lastPreviewUrl = undefined;
      const event = toPreviewEvent(data.preview);
      this.#emitPreview(event);
      this.#bumpReloadToken();
      this.#filesWrittenSinceRedeploy = false;

      return event;
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
      dockerPreviewBusy.set(true);

      try {
        let lastResult: PreviewInfoEvent | null = null;

        do {
          lastResult = await this.#restartPreviewProcess();
        } while (lastResult && this.#filesWrittenSinceRedeploy);

        return lastResult;
      } finally {
        dockerPreviewBusy.set(false);
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

      dockerPreviewBusy.set(true);

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
          preview?: { port: number; hostPort: number; url: string; ready: boolean } | null;
        };

        if (!res.ok) {
          throw new Error(data.error || data.output || 'Docker start failed');
        }

        if (data.preview?.url && data.preview.ready) {
          this.#lastPreviewUrl = undefined;
          const event = toPreviewEvent(data.preview);
          this.#emitPreview(event);
          this.#bumpReloadToken();
          this.#filesWrittenSinceRedeploy = false;
          this.#pendingStartCommand = undefined;

          return event;
        }

        throw new Error(data.output || 'Preview server did not become ready');
      } finally {
        dockerPreviewBusy.set(false);
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

    if (next.ready && next.baseUrl === this.#lastPreviewUrl && next.port === this.#lastPreviewPort) {
      return;
    }

    if (next.ready) {
      const becameReady = !this.#lastPreviewUrl;
      this.#lastPreviewUrl = next.baseUrl;
      this.#lastPreviewPort = next.port;

      if (becameReady && this.#previewPoll) {
        this.#stopPreviewPolling();
        this.#startPreviewPolling();
      }
    }

    for (const listener of this.#previewListeners) {
      listener(next);
    }
  }

  #startPreviewPolling() {
    if (this.#previewPoll || !this.#sessionId) {
      return;
    }

    this.#previewPoll = setInterval(
      () => {
        void this.#pollPreview();
      },
      this.#lastPreviewUrl ? 10000 : 2000,
    );
  }

  #stopPreviewPolling() {
    if (this.#previewPoll) {
      clearInterval(this.#previewPoll);
      this.#previewPoll = undefined;
    }
  }

  async #pollPreview() {
    if (!this.#sessionId || this.#previewListeners.size === 0 || this.#streamLocked) {
      return;
    }

    try {
      const res = await fetch(`${this.#daemonUrl}/sessions/${this.#sessionId}/preview`);
      if (!res.ok) {
        return;
      }

      const data = (await res.json()) as {
        preview?: { port: number; hostPort: number; url: string; ready: boolean } | null;
      };

      if (data.preview?.ready && data.preview.url) {
        const nextUrl = canonicalPreviewUrl(data.preview.url);

        if (nextUrl !== this.#lastPreviewUrl) {
          this.#emitPreview(toPreviewEvent(data.preview));
        }
      }
    } catch {
      // ignore transient poll errors
    }
  }
}

export const DOCKER_RUNTIME_NOT_CONFIGURED =
  'Docker runtime is not configured yet. Start the local runtime daemon (`pnpm runtime:daemon`) and ensure Docker Desktop is running.';
