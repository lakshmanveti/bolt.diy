import { useStore } from '@nanostores/react';
import {
  deploymentTargetStore,
  dockerRuntimeAvailableStore,
  getEffectiveExecutionTarget,
  setDeploymentTarget,
} from '~/lib/runtime';

export type { DeploymentTarget } from '~/lib/runtime';

export function useDeploymentTarget() {
  const deploymentTarget = useStore(deploymentTargetStore);
  const dockerAvailable = useStore(dockerRuntimeAvailableStore);
  const effectiveTarget = getEffectiveExecutionTarget();
  /** True when Docker daemon is offline (BuildLive has no WebContainer fallback). */
  const usingFallback = !dockerAvailable;

  return {
    deploymentTarget,
    setDeploymentTarget,
    dockerAvailable,
    effectiveTarget,
    usingFallback,
  } as const;
}
