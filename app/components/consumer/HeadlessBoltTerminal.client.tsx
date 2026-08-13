import { useEffect, useRef } from 'react';
import type { ITerminal } from '~/types/terminal';
import { workbenchStore } from '~/lib/stores/workbench';

/**
 * Previously spawned WebContainer jsh for consumer shell/start actions.
 * Docker ActionRunner uses the runtime daemon directly — no headless terminal needed.
 */
export function HeadlessBoltTerminal() {
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) {
      return;
    }

    startedRef.current = true;

    // Keep a no-op terminal attached so any legacy callers don't throw
    if (workbenchStore.boltTerminal.process) {
      return;
    }

    const listeners = new Set<(data: string) => void>();

    const terminal: ITerminal = {
      cols: 80,
      rows: 24,
      reset: () => undefined,
      write: () => undefined,
      onData: (cb) => {
        listeners.add(cb);
      },
      input: (data) => {
        listeners.forEach((cb) => cb(data));
      },
    };

    void workbenchStore.attachBoltTerminal(terminal);
  }, []);

  return null;
}
