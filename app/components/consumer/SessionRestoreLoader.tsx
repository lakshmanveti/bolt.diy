import { useEffect } from 'react';
import { BuildProgress } from './BuildProgress';
import { BuildLiveLogo } from '~/components/ui/BuildLiveLogo';
import { refreshDockerRuntimeAvailability } from '~/lib/runtime';

/**
 * Shown while an existing chat id is hydrating so we don't flash the empty home composer.
 * Same left-panel status as first generate (BuildProgress), with a chat skeleton on the right.
 */
export function SessionRestoreLoader({
  error,
  onRetry,
}: {
  error?: string;
  onRetry?: () => void;
} = {}) {
  useEffect(() => {
    void refreshDockerRuntimeAvailability();

    const id = window.setInterval(() => {
      void refreshDockerRuntimeAvailability();
    }, 2000);

    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-bolt-elements-background-depth-1 lg:flex-row">
      <div className="flex h-[45vh] min-w-0 flex-1 flex-col border-b border-bolt-elements-borderColor lg:h-full lg:border-b-0 lg:border-r">
        <div className="flex items-center gap-2 border-b border-bolt-elements-borderColor px-3 py-2 shrink-0">
          <div className="flex min-w-0 flex-1 items-center">
            <BuildLiveLogo size="sm" />
          </div>
        </div>
        <div className="relative flex min-h-0 flex-1">
          <div className="pointer-events-none absolute left-3 top-3 z-10 rounded-lg border border-bolt-elements-borderColor/50 bg-bolt-elements-background-depth-1/80 px-2.5 py-1.5 shadow-sm backdrop-blur-sm">
            <span className="text-xs font-medium text-bolt-elements-textPrimary">Live Preview</span>
          </div>
          <div className="flex flex-1 items-center justify-center px-6 py-10">
            <BuildProgress variant="restore" error={error} onRetry={onRetry} />
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
