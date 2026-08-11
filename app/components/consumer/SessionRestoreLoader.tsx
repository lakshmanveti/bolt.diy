import { useEffect, useState } from 'react';
import { SESSION_RESTORE_MESSAGES } from '~/lib/consumer/buildEngagement';

/**
 * Shown while an existing chat id is hydrating so we don't flash the empty home composer.
 * Matches ConsumerShell: preview left, conversation right.
 */
export function SessionRestoreLoader() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => {
      setIndex((i) => (i + 1) % SESSION_RESTORE_MESSAGES.length);
    }, 3500);

    return () => window.clearInterval(id);
  }, []);

  const message = SESSION_RESTORE_MESSAGES[index % SESSION_RESTORE_MESSAGES.length];

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-bolt-elements-background-depth-1 lg:flex-row">
      <div className="flex h-[45vh] min-w-0 flex-1 items-center justify-center border-b border-bolt-elements-borderColor px-6 lg:h-full lg:border-b-0 lg:border-r">
        <div className="flex max-w-md flex-col items-center gap-4 text-center">
          <span className="i-svg-spinners:90-ring-with-bg text-3xl text-accent-500" />
          <div>
            <p className="text-base font-medium text-bolt-elements-textPrimary">Loading your app</p>
            <p
              key={index}
              className="mt-2 text-sm leading-relaxed text-bolt-elements-textSecondary transition-opacity"
            >
              {message}
            </p>
          </div>
        </div>
      </div>

      <div className="flex w-full shrink-0 flex-col bg-bolt-elements-background-depth-2 lg:w-[380px] xl:w-[420px]">
        <div className="border-b border-bolt-elements-borderColor px-5 py-4">
          <div className="h-4 w-32 animate-pulse rounded bg-bolt-elements-background-depth-3" />
        </div>
        <div className="flex flex-1 flex-col gap-3 px-5 py-4">
          <div className="h-16 animate-pulse rounded-lg bg-bolt-elements-background-depth-3" />
          <div className="h-24 animate-pulse rounded-lg bg-bolt-elements-background-depth-3" />
          <div className="h-16 animate-pulse rounded-lg bg-bolt-elements-background-depth-3" />
        </div>
      </div>
    </div>
  );
}
