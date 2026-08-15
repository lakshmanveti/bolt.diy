import { useEffect, useState } from 'react';
import { useStore } from '@nanostores/react';
import { toast } from 'react-toastify';
import { workbenchStore } from '~/lib/stores/workbench';
import { chatId } from '~/lib/persistence/useChatHistory';
import type { DeployAlert } from '~/types/actions';
import { classNames } from '~/utils/classNames';
import { APP_NAME } from '~/utils/brand';
import { ConsumerDeployButton } from './ConsumerDeployButton';
import { Tooltip } from '~/components/ui/Tooltip';

function storageKey(suffix: string, id: string | undefined) {
  return `bl.${suffix}:${id || 'default'}`;
}

function wasSeen(key: string): boolean {
  try {
    return sessionStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function markSeen(key: string) {
  try {
    sessionStorage.setItem(key, '1');
  } catch {
    // ignore
  }
}

export async function copyPreviewLink(url: string) {
  try {
    await navigator.clipboard.writeText(url);
    toast.success('Preview link copied. It works on this computer — deploy to share it with anyone.');
  } catch {
    toast.error('Could not copy the preview link');
  }
}

export async function sharePreviewLink(url: string) {
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({
        title: `${APP_NAME} preview`,
        text: 'Live preview of my app',
        url,
      });
      return;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return;
      }
    }
  }

  await copyPreviewLink(url);
}

function deployStatusLine(alert: DeployAlert | undefined) {
  if (!alert) {
    return { text: 'Deploy to share it with anyone' };
  }

  if (alert.type === 'success' && alert.url) {
    return { text: 'Live on the web', href: alert.url };
  }

  if (alert.stage === 'building') {
    return { text: 'Building for deploy…' };
  }

  if (alert.stage === 'deploying') {
    const target = alert.source ? alert.source[0]!.toUpperCase() + alert.source.slice(1) : 'the web';
    return { text: `Deploying to ${target}…` };
  }

  if (alert.type === 'error') {
    return { text: alert.title || 'Deploy failed — try again' };
  }

  return { text: alert.description || 'Deploy to share it with anyone' };
}

export function useLivePreviewUi(previewUrl: string) {
  const currentChatId = useStore(chatId);
  const [showMoment, setShowMoment] = useState(false);
  const [showBar, setShowBar] = useState(true);

  useEffect(() => {
    if (!previewUrl) {
      return undefined;
    }

    const momentKey = storageKey('live-moment', currentChatId);
    const barKey = storageKey('live-bar-dismissed', currentChatId);

    setShowBar(!wasSeen(barKey));

    if (wasSeen(momentKey)) {
      setShowMoment(false);
      return undefined;
    }

    markSeen(momentKey);
    setShowMoment(true);

    const timeout = window.setTimeout(() => setShowMoment(false), 5200);

    return () => window.clearTimeout(timeout);
  }, [currentChatId, previewUrl]);

  const dismissMoment = () => setShowMoment(false);

  const dismissBar = () => {
    markSeen(storageKey('live-bar-dismissed', currentChatId));
    setShowBar(false);
    setShowMoment(false);
  };

  return { showMoment, showBar: showBar && !showMoment, dismissMoment, dismissBar };
}

const actionBtnClass =
  'inline-flex items-center gap-1.5 rounded-md border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 px-3 py-1.5 text-sm text-bolt-elements-textPrimary hover:bg-bolt-elements-item-backgroundActive';

export function LivePreviewOverlay({
  previewUrl,
  onDismiss,
}: {
  previewUrl: string;
  onDismiss: () => void;
}) {
  const canNativeShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  return (
    <div className="pointer-events-none absolute inset-0 z-30 flex items-start justify-center p-4 pt-8">
      <div
        className={classNames(
          'pointer-events-auto w-full max-w-md rounded-xl border border-bolt-elements-borderColor',
          'bg-bolt-elements-background-depth-1 p-4 shadow-xl',
          'animate-in fade-in-0 zoom-in-95',
        )}
      >
        <div className="flex items-start gap-3">
          <span className="i-ph:check-circle mt-0.5 h-6 w-6 shrink-0 text-accent-500" />
          <div className="min-w-0 flex-1">
            <p className="text-base font-semibold text-bolt-elements-textPrimary">Your app is live</p>
            <p className="mt-1 text-sm text-bolt-elements-textSecondary">
              Preview is running here. Copy the link for this computer, or deploy so anyone can open it.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Tooltip content="Copy a link that works on this computer" delayDuration={200}>
                <button
                  type="button"
                  onClick={() => void copyPreviewLink(previewUrl)}
                  className={actionBtnClass}
                >
                  <span className="i-ph:copy h-4 w-4" />
                  Copy link
                </button>
              </Tooltip>
              {canNativeShare && (
                <Tooltip content="Share this preview" delayDuration={200}>
                  <button
                    type="button"
                    onClick={() => void sharePreviewLink(previewUrl)}
                    className={actionBtnClass}
                  >
                    <span className="i-ph:share-network h-4 w-4" />
                    Share
                  </button>
                </Tooltip>
              )}
              <ConsumerDeployButton variant="labeled" />
              <button
                type="button"
                onClick={onDismiss}
                className="rounded-md bg-transparent px-3 py-1.5 text-sm text-bolt-elements-textSecondary hover:bg-bolt-elements-item-backgroundActive hover:text-bolt-elements-textPrimary"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function LivePreviewBar({
  previewUrl,
  onDismiss,
}: {
  previewUrl: string;
  onDismiss: () => void;
}) {
  const deployAlert = useStore(workbenchStore.deployAlert);
  const status = deployStatusLine(deployAlert);

  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 px-3 py-2">
      <Tooltip content="Preview is running" delayDuration={200}>
        <span className="i-ph:check-circle h-4 w-4 shrink-0 text-accent-500" />
      </Tooltip>
      <p className="min-w-0 flex-1 truncate text-sm text-bolt-elements-textPrimary">
        <span className="font-medium">Your app is live.</span>{' '}
        {status.href ? (
          <a href={status.href} target="_blank" rel="noopener noreferrer" className="text-accent-500 hover:underline">
            {status.text}
          </a>
        ) : (
          <span className="text-bolt-elements-textSecondary">{status.text}</span>
        )}
      </p>
      <Tooltip content="Copy a link that works on this computer" delayDuration={200}>
        <button
          type="button"
          onClick={() => void copyPreviewLink(previewUrl)}
          className="inline-flex items-center gap-1 rounded-md border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 px-2 py-1 text-xs text-bolt-elements-textPrimary hover:bg-bolt-elements-item-backgroundActive"
        >
          <span className="i-ph:copy h-3.5 w-3.5" />
          Copy
        </button>
      </Tooltip>
      <ConsumerDeployButton variant="labeled" />
      <Tooltip content="Hide this bar" delayDuration={200}>
        <button
          type="button"
          onClick={onDismiss}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-bolt-elements-textSecondary hover:bg-bolt-elements-item-backgroundActive"
          aria-label="Hide"
        >
          <span className="i-ph:x h-3.5 w-3.5" />
        </button>
      </Tooltip>
    </div>
  );
}
