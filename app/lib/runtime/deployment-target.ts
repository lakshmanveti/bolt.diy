import { atom } from 'nanostores';
import { DEFAULT_DEPLOYMENT_TARGET, type DeploymentTarget } from './types';

const STORAGE_KEY = 'buildlive_deployment_target';

/**
 * BuildLive always uses Docker. Legacy localStorage values are ignored/cleared.
 */
export const deploymentTargetStore = atom<DeploymentTarget>(DEFAULT_DEPLOYMENT_TARGET);

/** Live health of the local runtime daemon + Docker. */
export const dockerRuntimeAvailableStore = atom(false);

export function getDeploymentTarget(): DeploymentTarget {
  return 'docker';
}

/** @deprecated Runtime is fixed to Docker — kept for call-site compatibility. */
export function setDeploymentTarget(_target: DeploymentTarget) {
  deploymentTargetStore.set('docker');

  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(STORAGE_KEY, 'docker');
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

/** Clear any leftover WebContainer preference from older builds. */
export function migrateDeploymentTargetToDocker() {
  if (typeof localStorage === 'undefined') {
    return;
  }

  try {
    localStorage.setItem(STORAGE_KEY, 'docker');
  } catch {
    // ignore
  }

  deploymentTargetStore.set('docker');
}
