import { useStore } from '@nanostores/react';
import { memo, useEffect, useState } from 'react';
import type { ActionState } from '~/lib/runtime/action-runner';
import type { ProgressAnnotation } from '~/types/context';
import { workbenchStore } from '~/lib/stores/workbench';
import { previewHealthStore } from '~/lib/stores/preview-health';
import { dockerPreviewBusy, dockerRuntimeAvailableStore, dockerStartStatus, isLiveDockerStartStage } from '~/lib/runtime';
import { classNames } from '~/utils/classNames';
import { SHOW_DOCKER_START_STATUS } from '~/utils/constants';
import { dedupeProgressItems, isDockerCoveredAction, labelForAction, type ProgressItem } from '~/lib/consumer/progressLabels';
import {
  BUILD_WAIT_TIPS,
  SHOW_BUILD_ENGAGEMENT,
  formatElapsed,
  summarizeUserPrompt,
} from '~/lib/consumer/buildEngagement';

function collectActions(): ProgressItem[] {
  const artifacts = workbenchStore.artifacts.get();
  const items: ProgressItem[] = [];

  for (const artifact of Object.values(artifacts)) {
    const actions = Object.values(artifact.runner.actions.get()) as ActionState[];

    for (const action of actions) {
      if (action.type === 'supabase' && action.operation === 'query') {
        continue;
      }

      if (SHOW_DOCKER_START_STATUS && isDockerCoveredAction(action)) {
        continue;
      }

      const keyPart = 'filePath' in action && action.filePath ? action.filePath : action.content?.slice(0, 40) || '';

      items.push({
        id: `${artifact.id}:${action.type}:${keyPart}`,
        label: labelForAction(action),
        status: action.status,
      });
    }
  }

  return dedupeProgressItems(items);
}

function useBuildProgressItems(): ProgressItem[] {
  const artifacts = useStore(workbenchStore.artifacts);
  const [items, setItems] = useState<ProgressItem[]>([]);

  useEffect(() => {
    const refresh = () => setItems(collectActions());
    refresh();

    const unsubs = Object.values(artifacts).map((artifact) => artifact.runner.actions.subscribe(refresh));

    return () => {
      unsubs.forEach((unsub) => unsub());
    };
  }, [artifacts]);

  return items;
}

function useElapsedSeconds(active: boolean): number {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!active) {
      setSeconds(0);
      return undefined;
    }

    setSeconds(0);
    const started = Date.now();
    const id = window.setInterval(() => {
      setSeconds(Math.floor((Date.now() - started) / 1000));
    }, 1000);

    return () => window.clearInterval(id);
  }, [active]);

  return seconds;
}

function useRotatingTip(active: boolean, intervalMs = 8000): string {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!active) {
      return undefined;
    }

    const id = window.setInterval(() => {
      setIndex((i) => (i + 1) % BUILD_WAIT_TIPS.length);
    }, intervalMs);

    return () => window.clearInterval(id);
  }, [active, intervalMs]);

  return BUILD_WAIT_TIPS[index % BUILD_WAIT_TIPS.length];
}

function buildHeadline({
  error,
  waitingForRuntime,
  showDockerStatus,
  dockerTitle,
  hasPreview,
  activeLabel,
  isStreaming,
  isRestore,
  latestAnnotation,
}: {
  error?: string;
  waitingForRuntime: boolean;
  showDockerStatus: boolean;
  dockerTitle: string;
  hasPreview: boolean;
  activeLabel?: string;
  isStreaming: boolean;
  isRestore: boolean;
  latestAnnotation?: string;
}): string {
  if (error) {
    return 'Could not load your app';
  }

  if (waitingForRuntime) {
    return 'Getting your app ready…';
  }

  if (showDockerStatus) {
    return dockerTitle || 'Getting your app ready…';
  }

  if (isRestore) {
    return 'Loading your app';
  }

  if (hasPreview && !activeLabel && !isStreaming) {
    return 'Your app is ready';
  }

  if (activeLabel) {
    return activeLabel;
  }

  return latestAnnotation || (isStreaming ? 'Generating your app…' : 'Building your app…');
}

function StatusIcon({ status }: { status: ActionState['status'] | 'in-progress' | 'complete' }) {
  if (status === 'complete') {
    return <div className="i-ph:check-circle w-5 h-5 text-green-500 shrink-0" />;
  }

  if (status === 'failed') {
    return <div className="i-ph:warning-circle w-5 h-5 text-red-500 shrink-0" />;
  }

  if (status === 'aborted') {
    return <div className="i-ph:minus-circle w-5 h-5 text-bolt-elements-textTertiary shrink-0" />;
  }

  if (status === 'running' || status === 'in-progress') {
    return <div className="i-svg-spinners:90-ring-with-bg w-5 h-5 text-accent-500 shrink-0" />;
  }

  return <div className="i-ph:circle-dashed w-5 h-5 text-bolt-elements-textTertiary shrink-0" />;
}

function buildDetail({
  error,
  waitingForRuntime,
  showDockerStatus,
  dockerDetail,
  isRestore,
  doneCount,
  itemCount,
}: {
  error?: string;
  waitingForRuntime: boolean;
  showDockerStatus: boolean;
  dockerDetail: string;
  isRestore: boolean;
  doneCount: number;
  itemCount: number;
}): string | null {
  if (error) {
    return error;
  }

  if (waitingForRuntime) {
    return 'Hang on — this can take a minute the first time.';
  }

  if (showDockerStatus && dockerDetail) {
    return dockerDetail;
  }

  if (isRestore) {
    return 'Reconnecting the live preview.';
  }

  if (itemCount > 0) {
    return `${doneCount} of ${itemCount} steps complete`;
  }

  return null;
}

function buildStatusLabel({
  error,
  showDockerStatus,
  isRestore,
  dockerTitle,
  currentLabel,
}: {
  error?: string;
  showDockerStatus: boolean;
  isRestore: boolean;
  dockerTitle: string;
  currentLabel?: string;
}): string | undefined {
  if (error) {
    return 'Could not load your app';
  }

  if (showDockerStatus || isRestore) {
    return dockerTitle || 'Getting your app ready…';
  }

  return currentLabel;
}

interface BuildProgressProps {
  className?: string;
  annotations?: ProgressAnnotation[];
  isStreaming?: boolean;
  /** Latest user prompt — shown as a short “building this” summary while waiting. */
  promptSummary?: string;
  /** Existing-chat hydrate uses the same panel as first generate. */
  variant?: 'generate' | 'restore';
  error?: string;
  onRetry?: () => void;
}

/**
 * Left-panel status while the app is generating.
 * Stages stay primary; optional engagement (summary / timer / tips) can be toggled off.
 */
export const BuildProgress = memo(
  ({
    className,
    annotations = [],
    isStreaming = false,
    promptSummary,
    variant = 'generate',
    error,
    onRetry,
  }: BuildProgressProps) => {
    const items = useBuildProgressItems();
    const previews = useStore(workbenchStore.previews);
    const previewHealth = useStore(previewHealthStore);
    const startStatus = useStore(dockerStartStatus);
    const previewBusy = useStore(dockerPreviewBusy);
    const dockerAvailable = useStore(dockerRuntimeAvailableStore);
    const hasPreview = previews.some((p) => p.ready && p.baseUrl) && previewHealth.status !== 'unreachable';
    const [expanded, setExpanded] = useState(false);
    const isRestore = variant === 'restore';
    const waitingForRuntime = isRestore && !error && !dockerAvailable;

    const latestAnnotation = [...annotations].sort((a, b) => b.order - a.order)[0];
    const active = items.find((i) => i.status === 'running' || i.status === 'pending');
    const currentItem = active || items[items.length - 1];
    const doneCount = items.filter((i) => i.status === 'complete').length;
    const awaitingPreviewRuntime =
      isStreaming ||
      items.length > 0 ||
      previewBusy ||
      isLiveDockerStartStage(startStatus.stage) ||
      isRestore;
    const showDockerStatus =
      SHOW_DOCKER_START_STATUS &&
      !hasPreview &&
      !error &&
      !waitingForRuntime &&
      awaitingPreviewRuntime &&
      (isLiveDockerStartStage(startStatus.stage) || previewBusy || isRestore || (items.length > 0 && !active));
    const isWaiting =
      Boolean(error) || waitingForRuntime || !hasPreview || Boolean(active) || isStreaming || previewBusy || isRestore;
    const buildReady = hasPreview && !active && !isStreaming && !showDockerStatus && !isRestore && !error;

    const elapsed = useElapsedSeconds(isWaiting && SHOW_BUILD_ENGAGEMENT && !error);
    const tip = useRotatingTip(isWaiting && SHOW_BUILD_ENGAGEMENT && !error);
    const summary = SHOW_BUILD_ENGAGEMENT && promptSummary ? summarizeUserPrompt(promptSummary) : '';

    const headline = buildHeadline({
      error,
      waitingForRuntime,
      showDockerStatus,
      dockerTitle: startStatus.title,
      hasPreview,
      activeLabel: active?.label,
      isStreaming,
      isRestore,
      latestAnnotation: latestAnnotation?.message,
    });

    const detail = buildDetail({
      error,
      waitingForRuntime,
      showDockerStatus,
      dockerDetail: startStatus.detail,
      isRestore,
      doneCount,
      itemCount: items.length,
    });
    const statusLabel = buildStatusLabel({
      error,
      showDockerStatus,
      isRestore,
      dockerTitle: startStatus.title,
      currentLabel: currentItem?.label,
    });
    const statusKind: ActionState['status'] | 'in-progress' | 'complete' =
      error || startStatus.stage === 'error'
        ? 'failed'
        : showDockerStatus || isRestore || !currentItem
          ? 'running'
          : currentItem.status;

    const showEmpty =
      !isRestore && items.length === 0 && !latestAnnotation && !isStreaming && !hasPreview && !showDockerStatus;

    if (showEmpty) {
      return (
        <div className={classNames('w-full max-w-lg text-center', className)}>
          <div className="i-svg-spinners:90-ring-with-bg w-10 h-10 text-accent-500 mx-auto mb-4" />
          <h2 className="text-2xl font-semibold text-bolt-elements-textPrimary tracking-tight">Getting started</h2>
          <p className="mt-2 text-sm text-bolt-elements-textSecondary">
            Preparing your workspace. Live updates will appear here.
          </p>
          {SHOW_BUILD_ENGAGEMENT && (
            <p className="mt-4 text-xs text-bolt-elements-textTertiary">First builds often take a few minutes.</p>
          )}
        </div>
      );
    }

    return (
      <div className={classNames('w-full max-w-lg', className)}>
        <div className="flex flex-col items-center text-center mb-6">
          {error ? (
            <div className="i-ph:warning-circle w-10 h-10 text-red-500 mb-4" />
          ) : buildReady ? (
            <div className="i-ph:check-circle w-10 h-10 text-green-500 mb-4" />
          ) : (
            <div className="i-svg-spinners:90-ring-with-bg w-10 h-10 text-accent-500 mb-4" />
          )}
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-bolt-elements-textTertiary mb-2">
            {error ? 'Needs attention' : buildReady ? 'Ready' : 'In progress'}
            {SHOW_BUILD_ENGAGEMENT && isWaiting && !error && elapsed > 0 ? ` · ${formatElapsed(elapsed)}` : ''}
          </p>
          <h2 className="text-2xl sm:text-3xl font-semibold text-bolt-elements-textPrimary tracking-tight leading-tight">
            {headline}
          </h2>
          {detail ? <p className="mt-2 text-sm text-bolt-elements-textSecondary">{detail}</p> : null}
          {summary && isWaiting && !error && (
            <p className="mt-3 text-sm text-bolt-elements-textSecondary max-w-md leading-relaxed">
              Building: <span className="text-bolt-elements-textPrimary">{summary}</span>
            </p>
          )}
        </div>

        {(statusLabel || error) && (
          <div className="rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 overflow-hidden text-left">
            <div className="flex items-center gap-3 px-4 py-3.5">
              <StatusIcon status={statusKind} />
              <span className="text-sm font-semibold text-bolt-elements-textPrimary flex-1 min-w-0 truncate">
                {statusLabel || headline}
              </span>
              {!isRestore && items.length > 1 && (
                <button
                  type="button"
                  className="shrink-0 flex items-center justify-center w-8 h-8 rounded-md text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary hover:bg-bolt-elements-item-backgroundActive transition-colors"
                  onClick={() => setExpanded((v) => !v)}
                  aria-expanded={expanded}
                  aria-label={expanded ? 'Hide all steps' : 'Show all steps'}
                  title={expanded ? 'Hide all steps' : 'Show all steps'}
                >
                  {expanded ? (
                    <div className="i-ph:caret-up-bold w-4 h-4" />
                  ) : (
                    <div className="i-ph:caret-down-bold w-4 h-4" />
                  )}
                </button>
              )}
            </div>

            {expanded && items.length > 1 && (
              <ul className="border-t border-bolt-elements-borderColor max-h-56 overflow-y-auto modern-scrollbar">
                {items.map((item) => (
                  <li
                    key={item.id}
                    className={classNames(
                      'flex items-center gap-3 px-4 py-2.5 border-t border-bolt-elements-borderColor first:border-t-0',
                      item.status === 'running' && 'bg-accent-500/5',
                    )}
                  >
                    <StatusIcon status={item.status} />
                    <span
                      className={classNames(
                        'text-sm',
                        item.status === 'running'
                          ? 'font-semibold text-bolt-elements-textPrimary'
                          : item.status === 'complete'
                            ? 'text-bolt-elements-textSecondary'
                            : 'text-bolt-elements-textTertiary',
                      )}
                    >
                      {item.label}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {error && onRetry ? (
              <div className="border-t border-bolt-elements-borderColor px-4 py-3">
                <button
                  type="button"
                  onClick={onRetry}
                  className="rounded-md bg-accent-500 px-4 py-2 text-sm font-medium text-white hover:bg-accent-600"
                >
                  Retry
                </button>
              </div>
            ) : null}
          </div>
        )}

        {SHOW_BUILD_ENGAGEMENT && isWaiting && !error && (
          <div className="mt-5 space-y-4">
            <div className="rounded-xl border border-bolt-elements-borderColor/80 bg-bolt-elements-background-depth-2/60 px-4 py-3 text-left">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-bolt-elements-textTertiary mb-1.5">
                Tip
              </p>
              <p key={tip} className="text-sm text-bolt-elements-textSecondary leading-relaxed transition-opacity duration-300">
                {tip}
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-2 px-1">
              <span className="inline-flex items-center rounded-full border border-sky-500/30 bg-sky-500/10 px-2.5 py-1 text-[11px] font-medium tracking-wide text-sky-300">
                Watch preview appear
              </span>
              <span className="inline-flex items-center rounded-full border border-violet-500/30 bg-violet-500/10 px-2.5 py-1 text-[11px] font-medium tracking-wide text-violet-300">
                Tell chat what to change
              </span>
              <span className="inline-flex items-center rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium tracking-wide text-emerald-300">
                Deploy when ready
              </span>
            </div>
          </div>
        )}

        {!hasPreview && !SHOW_BUILD_ENGAGEMENT && (
          <p className="mt-6 text-center text-sm text-bolt-elements-textSecondary">
            Live preview will appear here when your app starts.
          </p>
        )}
      </div>
    );
  },
);
