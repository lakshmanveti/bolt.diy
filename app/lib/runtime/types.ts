/**
 * Runtime abstraction for executing generated apps.
 * M1: WebContainer. M2: setting/router. M3: Docker daemon + DockerRuntime.
 */

export type DeploymentTarget = 'webcontainer' | 'docker';

/** BuildLive runs generated apps in Docker only. */
export const DEFAULT_DEPLOYMENT_TARGET: DeploymentTarget = 'docker';

export const DEFAULT_RUNTIME_DAEMON_URL = 'http://127.0.0.1:7788';

export interface ExecResult {
  exitCode: number;
  output: string;
}

export interface PreviewInfoEvent {
  port: number;
  ready: boolean;
  baseUrl: string;
}

/**
 * Backend that runs the user's project (files, shell, preview).
 * ActionRunner / workbench talk to this — not to WebContainer APIs directly (over time).
 */
export interface AppRuntime {
  readonly target: DeploymentTarget;

  /** Resolve when the runtime is ready to accept files/commands. */
  ready(): Promise<void>;

  writeFile(filePath: string, content: string | Uint8Array): Promise<void>;

  mkdir(dirPath: string, options?: { recursive?: boolean }): Promise<void>;

  readFile(filePath: string, encoding?: 'utf8'): Promise<string>;

  /**
   * One-shot command. WebContainer maps this to shell/jsh;
   * Docker maps it to `docker exec` via the local daemon.
   */
  exec(command: string): Promise<ExecResult>;

  /**
   * Long-running start (e.g. `npm run dev`). Docker discovers a localhost preview URL.
   */
  start?(command: string): Promise<PreviewInfoEvent | void>;

  /** Bind session to a chat/project key (Docker). */
  ensureSession?(sessionKey?: string): Promise<void>;

  /** Subscribe to preview URL / port readiness. Returns unsubscribe. */
  onPreview(callback: (preview: PreviewInfoEvent) => void): () => void;
}
