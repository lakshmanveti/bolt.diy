import { describe, expect, it } from 'vitest';
import { mockGenerateTimeline } from './mock-generate';

describe('mockGenerateTimeline', () => {
  it('starts with streaming file steps and ends on a ready preview', () => {
    const steps = mockGenerateTimeline(1_000);

    expect(steps[0]?.patch.isStreaming).toBe(true);
    expect(steps[0]?.patch.items?.length).toBeGreaterThan(1);
    expect(steps[0]?.patch.hasPreview).toBe(false);

    const last = steps[steps.length - 1];
    expect(last?.patch.hasPreview).toBe(true);
    expect(last?.patch.previewBusy).toBe(false);
    expect(last?.patch.dockerStatus?.stage).toBe('ready');
  });

  it('includes a docker-only accordion phase after files complete', () => {
    const steps = mockGenerateTimeline();
    const dockerPhase = steps.find((step) => step.patch.dockerStatus?.stage === 'container');

    expect(dockerPhase?.patch.items).toEqual([]);
    expect(dockerPhase?.patch.previewBusy).toBe(true);
  });
});
