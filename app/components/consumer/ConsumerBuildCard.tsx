import { useStore } from '@nanostores/react';
import { memo, useEffect, useState } from 'react';
import type { ActionState } from '~/lib/runtime/action-runner';
import { workbenchStore } from '~/lib/stores/workbench';

interface ConsumerBuildCardProps {
  artifactId: string;
}

/**
 * Quiet chat marker for artifacts. Detailed progress lives only in the right panel.
 */
export const ConsumerBuildCard = memo(({ artifactId }: ConsumerBuildCardProps) => {
  const artifacts = useStore(workbenchStore.artifacts);
  const artifact = artifacts[artifactId];
  const [actions, setActions] = useState<ActionState[]>([]);

  useEffect(() => {
    if (!artifact) {
      setActions([]);
      return;
    }

    const sync = () => {
      const next = Object.values(artifact.runner.actions.get()).filter((action) => {
        return action.type !== 'supabase' || action.operation === 'migration';
      }) as ActionState[];
      setActions(next);
    };

    sync();

    return artifact.runner.actions.subscribe(sync);
  }, [artifact]);

  if (!artifact) {
    return null;
  }

  const unfinished = actions.some((a) => a.status === 'running' || a.status === 'pending');
  const failed = actions.some((a) => a.status === 'failed');
  const label = failed ? 'Build needs attention' : unfinished ? 'Building in preview…' : 'Update applied';

  return (
    <div className="my-2 flex items-center gap-2 text-xs text-bolt-elements-textTertiary">
      {failed ? (
        <div className="i-ph:warning-circle w-4 h-4 text-red-500" />
      ) : unfinished ? (
        <div className="i-svg-spinners:90-ring-with-bg w-4 h-4 text-accent-500" />
      ) : (
        <div className="i-ph:check-circle w-4 h-4 text-green-500" />
      )}
      <span>{label}</span>
    </div>
  );
});
