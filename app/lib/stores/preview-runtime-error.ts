import { atom } from 'nanostores';

export type PreviewRuntimeError = {
  message: string;
  filename?: string;
  lineno?: number;
};

export const previewRuntimeErrorStore = atom<PreviewRuntimeError | null>(null);

export type PreviewErrorReportAction = 'ignore' | 'queue' | 'show';

/**
 * A Supabase (or any) follow-up can compile-fail while the turn is still
 * streaming or the preview process is restarting. Hold that report and show
 * the fix/dismiss confirmation once the preview is idle — do not drop it.
 */
export function classifyPreviewErrorReport(options: {
  message: string;
  streaming: boolean;
  previewBusy: boolean;
  dismissedMessage?: string | null;
}): PreviewErrorReportAction {
  const message = options.message.trim();

  if (!message || message === options.dismissedMessage) {
    return 'ignore';
  }

  if (options.streaming || options.previewBusy) {
    return 'queue';
  }

  return 'show';
}

export function setPreviewRuntimeError(error: PreviewRuntimeError) {
  const message = error.message.trim();

  if (!message) {
    return;
  }

  previewRuntimeErrorStore.set({
    message: message.slice(0, 1500),
    filename: error.filename,
    lineno: error.lineno,
  });
}

export function clearPreviewRuntimeError() {
  previewRuntimeErrorStore.set(null);
}

export function formatPreviewErrorFollowup(error: PreviewRuntimeError): string {
  let loc = error.filename || '';

  if (loc && typeof error.lineno === 'number' && error.lineno > 0) {
    loc += `:${error.lineno}`;
  }

  const body = loc ? `${error.message}\n${loc}` : error.message;

  return [
    'The live preview failed with this browser error. Keep the current UI and fix it. Do not rebuild from scratch.',
    '',
    '```',
    body,
    '```',
  ].join('\n');
}
