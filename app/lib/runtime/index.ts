import type { WebContainer } from '@webcontainer/api';
import { getDeploymentTarget } from './deployment-target';
import { DockerRuntime } from './docker-runtime';
import type { AppRuntime, DeploymentTarget } from './types';
import { WebContainerRuntime } from './webcontainer-runtime';

export type { AppRuntime, DeploymentTarget, ExecResult, PreviewInfoEvent } from './types';
export { DEFAULT_DEPLOYMENT_TARGET, DEFAULT_RUNTIME_DAEMON_URL } from './types';
export {
  deploymentTargetStore,
  dockerRuntimeAvailableStore,
  getDeploymentTarget,
  setDeploymentTarget,
  isDockerRuntimeAvailable,
  setDockerRuntimeAvailable,
  migrateDeploymentTargetToDocker,
} from './deployment-target';
export {
  DOCKER_RUNTIME_NOT_CONFIGURED,
  DockerRuntime,
  dockerPreviewBusy,
  dockerPreviewReloadToken,
  dockerStartStatus,
  verifyPreviewReachable,
} from './docker-runtime';
export type { ResumeResult } from './docker-runtime';
export type { DockerStartStatus, DockerStartStage } from './start-status';
export { isLiveDockerStartStage } from './start-status';
export { WebContainerRuntime } from './webcontainer-runtime';

let webcontainerRuntime: WebContainerRuntime | undefined;
let dockerRuntime: DockerRuntime | undefined;

function getWebContainerRuntime(): WebContainerRuntime {
  if (!webcontainerRuntime) {
    const existing = import.meta.hot?.data.webcontainerRuntime as WebContainerRuntime | undefined;
    webcontainerRuntime = existing ?? new WebContainerRuntime();

    if (import.meta.hot) {
      import.meta.hot.data.webcontainerRuntime = webcontainerRuntime;
    }
  }

  return webcontainerRuntime;
}

function getDockerRuntimeInstance(): DockerRuntime {
  if (!dockerRuntime) {
    const existing = import.meta.hot?.data.dockerRuntime as DockerRuntime | undefined;
    dockerRuntime = existing ?? new DockerRuntime();

    if (import.meta.hot) {
      import.meta.hot.data.dockerRuntime = dockerRuntime;
    }
  }

  return dockerRuntime;
}

export function getSelectedDeploymentTarget(): DeploymentTarget {
  return getDeploymentTarget();
}

/**
 * Execution backend. BuildLive is Docker-only; WebContainer is no longer a fallback.
 */
export function getEffectiveExecutionTarget(): DeploymentTarget {
  return 'docker';
}

/** AppRuntime — always Docker. */
export function getRuntime(): AppRuntime {
  return getDockerRuntimeInstance();
}

/** AppRuntime used for live execution — always Docker. */
export function getExecutionRuntime(): AppRuntime {
  return getDockerRuntimeInstance();
}

export function getDockerRuntime(): DockerRuntime {
  return getDockerRuntimeInstance();
}

/** WebContainer disabled — callers should use DockerRuntime / workbench FilesStore. */
export function getWebContainerPromise(): Promise<WebContainer> {
  const err = new Error('WebContainer is disabled in BuildLive. Use the Docker runtime.');
  const rejected = Promise.reject(err) as Promise<WebContainer>;
  rejected.catch(() => undefined);

  return rejected;
}

/**
 * Probe the local runtime daemon. Safe to call from the browser.
 */
export async function refreshDockerRuntimeAvailability(): Promise<boolean> {
  if (typeof window === 'undefined') {
    return false;
  }

  return getDockerRuntimeInstance().checkHealth();
}
