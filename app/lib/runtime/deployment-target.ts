import { atom } from 'nanostores';
import { DEFAULT_DEPLOYMENT_TARGET, type DeploymentTarget } from './types';

const STORAGE_KEY = 'buildlive_deployment_target';

function readStoredTarget(): DeploymentTarget {
  if (typeof localStorage === 'undefined') {
    return DEFAULT_DEPLOYMENT_TARGET;
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);

    if (raw === 'webcontainer' || raw === 'docker') {
      return raw;
    }
  } catch {
    // ignore
  }

  return DEFAULT_DEPLOYMENT_TARGET;
}

/**
 * Active preview/execution backend preference.
 * Default is webcontainer.
 */
export const deploymentTargetStore = atom<DeploymentTarget>(
  typeof window === 'undefined' ? DEFAULT_DEPLOYMENT_TARGET : readStoredTarget(),
);

/** Live health of the local runtime daemon + Docker. */
export const dockerRuntimeAvailableStore = atom(false);

export function getDeploymentTarget(): DeploymentTarget {
  return deploymentTargetStore.get();
}

export function setDeploymentTarget(target: DeploymentTarget) {
  deploymentTargetStore.set(target);

  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(STORAGE_KEY, target);
    } catch {
      // ignore
    }
  }
}

export function isDockerRuntimeAvailable(): boolean {
  return dockerRuntimeAvailableStore.get();
}

export function setDockerRuntimeAvailable(available: boolean) {
  dockerRuntimeAvailableStore.set(available);
}
