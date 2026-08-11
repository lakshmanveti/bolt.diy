import { useEffect } from 'react';
import { useStore } from '@nanostores/react';
import {
  deploymentTargetStore,
  refreshDockerRuntimeAvailability,
} from '~/lib/runtime';

/**
 * Keeps dockerRuntimeAvailableStore in sync with the local runtime daemon.
 * Mount once near the app root (client-only).
 */
export function RuntimeHealthPoller() {
  const deploymentTarget = useStore(deploymentTargetStore);

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;

    const tick = async () => {
      if (cancelled || inFlight) {
        return;
      }

      inFlight = true;

      try {
        await refreshDockerRuntimeAvailability();
      } finally {
        inFlight = false;
      }
    };

    void tick();

    // Slow poll — status uses hysteresis + daemon-side docker cache
    const intervalMs = deploymentTarget === 'docker' ? 10_000 : 30_000;
    const id = window.setInterval(() => void tick(), intervalMs);

    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [deploymentTarget]);

  return null;
}
