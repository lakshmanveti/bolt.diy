import { useEffect } from 'react';
import { migrateDeploymentTargetToDocker, refreshDockerRuntimeAvailability } from '~/lib/runtime';

/**
 * Keeps dockerRuntimeAvailableStore in sync with the local runtime daemon.
 * Mount once near the app root (client-only).
 */
export function RuntimeHealthPoller() {
  useEffect(() => {
    migrateDeploymentTargetToDocker();

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

    const id = window.setInterval(() => void tick(), 10_000);

    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  return null;
}
