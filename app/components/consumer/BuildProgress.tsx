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
import { mockBuildStore, stopMockGenerate } from '~/lib/consumer/mock-generate';

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
  dockerStage,
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
  dockerStage: string;
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

  if (showDockerStatus && dockerStage !== 'ready' && dockerStage !== 'idle') {
    return dockerTitle || 'Getting your app ready…';
  }

  if (isRestore && !hasPreview) {
    return 'Loading your app';
  }

  if (showDockerStatus) {
    return 'Connecting the preview…';
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
  dockerTitle,
  isRestore,
}: {
  error?: string;
  waitingForRuntime: boolean;
  showDockerStatus: boolean;
  dockerDetail: string;
  dockerTitle: string;
  isRestore: boolean;
}): string | null {
  if (error) {
    return error;
  }

  if (waitingForRuntime) {
    return 'Hang on — this can take a minute the first time.';
  }

  if (showDockerStatus && dockerDetail && dockerDetail !== dockerTitle) {
    return dockerDetail;
  }

  if (isRestore) {
    return 'Reconnecting the live preview.';
  }

  return null;
}

function dockerStageItems(status: { stage: string; packageName?: string }): ProgressItem[] {
  if (status.stage === 'idle' || status.stage === 'ready') {
    return [];
  }

  const pipeline: Array<{ id: string; label: string; stages: string[] }> = [
    { id: 'container', label: 'Getting your app ready', stages: ['container', 'install', 'server', 'error'] },
    {
      id: 'install',
      label: status.packageName ? `Installing ${status.packageName}` : 'Installing packages',
      stages: ['install', 'server', 'error'],
    },
    { id: 'server', label: 'Starting the app', stages: ['server', 'error'] },
  ];

  const visible = pipeline.filter((step) => step.stages.includes(status.stage));
  const currentId = status.stage === 'error' ? visible[visible.length - 1]?.id : status.stage;

  return visible.map((step) => ({
    id: `docker:${step.id}`,
    label: step.label,
    status: status.stage === 'error' && step.id === currentId ? 'failed' : step.id === currentId ? 'running' : 'complete',
  }));
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
    const realItems = useBuildProgressItems();
    const previews = useStore(workbenchStore.previews);
    const previewHealth = useStore(previewHealthStore);
    const realStartStatus = useStore(dockerStartStatus);
    const realPreviewBusy = useStore(dockerPreviewBusy);
    const dockerAvailable = useStore(dockerRuntimeAvailableStore);
    const mock = useStore(mockBuildStore);
    const mockActive = Boolean(import.meta.env.DEV) && mock.active;
    const items = mockActive ? mock.items : realItems;
    const startStatus = mockActive ? mock.dockerStatus : realStartStatus;
    const previewBusy = mockActive ? mock.previewBusy : realPreviewBusy;
    const hasPreview = mockActive
      ? mock.hasPreview
      : previews.some((p) => p.ready && p.baseUrl) && previewHealth.status !== 'unreachable';
    const resolvedAnnotations = mockActive ? mock.annotations : annotations;
    const resolvedStreaming = mockActive ? mock.isStreaming : isStreaming;
    const resolvedPrompt = mockActive ? mock.promptSummary : promptSummary;
    const resolvedError = mockActive ? undefined : error;
    const [expanded, setExpanded] = useState(false);
    const isRestore = mockActive ? false : variant === 'restore';
    const waitingForRuntime = isRestore && !resolvedError && !dockerAvailable;

    const latestAnnotation = [...resolvedAnnotations].sort((a, b) => b.order - a.order)[0];
    const active = items.find((i) => i.status === 'running' || i.status === 'pending');
    const awaitingPreviewRuntime =
      resolvedStreaming ||
      items.length > 0 ||
      previewBusy ||
      isLiveDockerStartStage(startStatus.stage) ||
      isRestore;
    const showDockerStatus =
      SHOW_DOCKER_START_STATUS &&
      !hasPreview &&
      !resolvedError &&
      !waitingForRuntime &&
      awaitingPreviewRuntime &&
      (isLiveDockerStartStage(startStatus.stage) || previewBusy || isRestore || (items.length > 0 && !active));
    const dockerItems = showDockerStatus ? dockerStageItems(startStatus) : [];
    const accordionItems = (items.length > 1 ? items : dockerItems).slice().reverse();
    const showAccordion = accordionItems.length > 1;
    const doneCount = accordionItems.filter((i) => i.status === 'complete').length;
    const isWaiting =
      Boolean(resolvedError) ||
      waitingForRuntime ||
      !hasPreview ||
      Boolean(active) ||
      resolvedStreaming ||
      previewBusy ||
      isRestore;
    const buildReady =
      hasPreview && !active && !resolvedStreaming && !showDockerStatus && !isRestore && !resolvedError;

    const elapsed = useElapsedSeconds(isWaiting && SHOW_BUILD_ENGAGEMENT && !resolvedError);
    const tip = useRotatingTip(isWaiting && SHOW_BUILD_ENGAGEMENT && !resolvedError);
    const summary = SHOW_BUILD_ENGAGEMENT && resolvedPrompt ? summarizeUserPrompt(resolvedPrompt) : '';

    const headline = buildHeadline({
      error: resolvedError,
      waitingForRuntime,
      showDockerStatus,
      dockerTitle: startStatus.title,
      dockerStage: startStatus.stage,
      hasPreview,
      activeLabel: active?.label,
      isStreaming: resolvedStreaming,
      isRestore,
      latestAnnotation: latestAnnotation?.message,
    });

    const detail = buildDetail({
      error: resolvedError,
      waitingForRuntime,
      showDockerStatus,
      dockerDetail: startStatus.detail,
      dockerTitle: startStatus.title,
      isRestore,
    });

    const showEmpty =
      !isRestore &&
      items.length === 0 &&
      !latestAnnotation &&
      !resolvedStreaming &&
      !hasPreview &&
      !showDockerStatus;

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
        {mockActive ? (
          <div className="mb-4 flex items-center justify-center gap-2 text-[11px] text-bolt-elements-textTertiary">
            <span>Test generate — no LLM</span>
            <button
              type="button"
              className="rounded px-1.5 py-0.5 text-[11px] font-medium text-bolt-elements-textSecondary hover:bg-bolt-elements-background-depth-2"
              onClick={stopMockGenerate}
            >
              Stop
            </button>
          </div>
        ) : null}
        <div className="flex flex-col items-center text-center mb-6">
          {resolvedError ? (
            <div className="i-ph:warning-circle w-10 h-10 text-red-500 mb-4" />
          ) : buildReady ? (
            <div className="i-ph:check-circle w-10 h-10 text-green-500 mb-4" />
          ) : (
            <div className="i-svg-spinners:90-ring-with-bg w-10 h-10 text-accent-500 mb-4" />
          )}
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-bolt-elements-textTertiary mb-2">
            {resolvedError ? 'Needs attention' : buildReady ? 'Ready' : 'In progress'}
            {SHOW_BUILD_ENGAGEMENT && isWaiting && !resolvedError && elapsed > 0 ? ` · ${formatElapsed(elapsed)}` : ''}
          </p>
          <h2 className="text-2xl sm:text-3xl font-semibold text-bolt-elements-textPrimary tracking-tight leading-tight">
            {headline}
          </h2>
          {detail ? <p className="mt-2 text-sm text-bolt-elements-textSecondary">{detail}</p> : null}
          {summary && isWaiting && !resolvedError && (
            <p className="mt-3 text-sm text-bolt-elements-textSecondary max-w-md leading-relaxed">
              Building: <span className="text-bolt-elements-textPrimary">{summary}</span>
            </p>
          )}
        </div>

        {showAccordion && (
          <div className="rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 overflow-hidden text-left">
            <button
              type="button"
              className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-bolt-elements-item-backgroundActive transition-colors"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
            >
              <span className="text-sm font-medium text-bolt-elements-textSecondary flex-1">
                {expanded ? 'Hide steps' : 'Show all steps'}
              </span>
              <span className="text-xs text-bolt-elements-textTertiary">
                {doneCount}/{accordionItems.length}
              </span>
              {expanded ? (
                <div className="i-ph:caret-up-bold w-4 h-4 text-bolt-elements-textSecondary shrink-0" />
              ) : (
                <div className="i-ph:caret-down-bold w-4 h-4 text-bolt-elements-textSecondary shrink-0" />
              )}
            </button>

            {expanded && (
              <ul className="border-t border-bolt-elements-borderColor max-h-56 overflow-y-auto modern-scrollbar">
                {accordionItems.map((item) => (
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
          </div>
        )}

        {resolvedError && onRetry ? (
          <div className="mt-4">
            <button
              type="button"
              onClick={onRetry}
              className="rounded-md bg-accent-500 px-4 py-2 text-sm font-medium text-white hover:bg-accent-600"
            >
              Retry
            </button>
          </div>
        ) : null}

        {SHOW_BUILD_ENGAGEMENT && isWaiting && !resolvedError && (
          <div className="mt-5 space-y-3">
            <p
              key={tip}
              className="text-xs text-bolt-elements-textTertiary leading-relaxed text-center transition-opacity duration-300"
            >
              <span className="font-medium text-bolt-elements-textTertiary">Tip · </span>
              {tip}
            </p>

            <p className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 px-1 text-xs">
              <span className="font-medium text-sky-600 dark:text-sky-400">Watch preview appear</span>
              <span aria-hidden="true" className="text-bolt-elements-textTertiary/50">
                ·
              </span>
              <span className="font-medium text-violet-600 dark:text-violet-400">Tell chat what to change</span>
              <span aria-hidden="true" className="text-bolt-elements-textTertiary/50">
                ·
              </span>
              <span className="font-medium text-emerald-600 dark:text-emerald-400">Deploy when ready</span>
            </p>
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
