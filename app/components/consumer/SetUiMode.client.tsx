import { useEffect } from 'react';
import { setConsumerUiMode, type ConsumerUiMode } from '~/lib/consumer/mode';

/**
 * Sets consumer vs studio shell mode for the current route.
 * Mount once per route tree; Chat.client reads the atom to pick a shell.
 */
export function SetUiMode({ mode }: { mode: ConsumerUiMode }) {
  useEffect(() => {
    setConsumerUiMode(mode);

    return () => {
      // Default back to consumer when leaving studio so `/` stays safe
      if (mode === 'studio') {
        setConsumerUiMode('consumer');
      }
    };
  }, [mode]);

  return null;
}
