import { describe, expect, it } from 'vitest';
import { classifyPreviewErrorReport } from './preview-runtime-error';

describe('classifyPreviewErrorReport', () => {
  const message = 'Transform failed: Unterminated string literal';

  it('shows a settled preview error so the fix or dismiss confirmation can replace the preview', () => {
    expect(
      classifyPreviewErrorReport({
        message,
        streaming: false,
        previewBusy: false,
      }),
    ).toBe('show');
  });

  it('queues an error reported while a follow-up preview restart is still busy', () => {
    expect(
      classifyPreviewErrorReport({
        message,
        streaming: false,
        previewBusy: true,
      }),
    ).toBe('queue');
  });

  it('queues an error reported while the follow-up is still streaming', () => {
    expect(
      classifyPreviewErrorReport({
        message,
        streaming: true,
        previewBusy: false,
      }),
    ).toBe('queue');
  });

  it('ignores an error the user already dismissed', () => {
    expect(
      classifyPreviewErrorReport({
        message,
        streaming: false,
        previewBusy: false,
        dismissedMessage: message,
      }),
    ).toBe('ignore');
  });

  it('ignores an empty report', () => {
    expect(
      classifyPreviewErrorReport({
        message: '   ',
        streaming: false,
        previewBusy: false,
      }),
    ).toBe('ignore');
  });
});
