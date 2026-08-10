import { useEffect, useRef } from 'react';
import type { ITerminal } from '~/types/terminal';
import { workbenchStore } from '~/lib/stores/workbench';

/**
 * Initializes the Bolt shell without rendering the IDE terminal UI.
 * Shell/start actions require an attached terminal; without this, consumer mode
 * never runs `npm install` / `npm run dev` and the preview stays empty.
 */
export function HeadlessBoltTerminal() {
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) {
      return;
    }

    // Already initialized by studio workbench (or a previous mount)
    if (workbenchStore.boltTerminal.process) {
      return;
    }

    startedRef.current = true;

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
