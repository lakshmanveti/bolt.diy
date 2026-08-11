import type { WebContainer } from '@webcontainer/api';
import { getDeploymentTarget, isDockerRuntimeAvailable } from './deployment-target';
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
} from './deployment-target';
export { DOCKER_RUNTIME_NOT_CONFIGURED, DockerRuntime, dockerPreviewReloadToken } from './docker-runtime';
export type { ResumeResult } from './docker-runtime';
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
 * Backend that should actually run builds right now.
 * Falls back to WebContainer when Docker is selected but the daemon is down.
 */
export function getEffectiveExecutionTarget(): DeploymentTarget {
  const selected = getDeploymentTarget();

  if (selected === 'docker' && !isDockerRuntimeAvailable()) {
    return 'webcontainer';
  }

  return selected;
}

/** AppRuntime for the *selected* setting (Docker stub/client even if daemon down). */
export function getRuntime(): AppRuntime {
  if (getDeploymentTarget() === 'docker') {
    return getDockerRuntimeInstance();
  }

  return getWebContainerRuntime();
}

/** AppRuntime used for live execution (honors daemon availability). */
export function getExecutionRuntime(): AppRuntime {
  if (getEffectiveExecutionTarget() === 'docker') {
    return getDockerRuntimeInstance();
  }

  return getWebContainerRuntime();
}

export function getDockerRuntime(): DockerRuntime {
  return getDockerRuntimeInstance();
}

/** WebContainer promise for legacy stores (M1 bridge). */
export function getWebContainerPromise(): Promise<WebContainer> {
  return getWebContainerRuntime().getWebContainer();
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
