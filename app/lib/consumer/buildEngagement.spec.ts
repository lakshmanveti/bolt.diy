import { describe, expect, it } from 'vitest';
import { latestVisibleUserPrompt, summarizeUserPrompt } from './buildEngagement';

describe('latestVisibleUserPrompt', () => {
  it('uses the app request and skips the hidden template-instructions turn', () => {
    const prompt = latestVisibleUserPrompt([
      {
        role: 'user',
        content: '[Model: gpt]\n\n[Provider: OpenAI]\n\nbuild purchase order management app',
      },
      { role: 'assistant', content: 'initializing your project' },
      {
        role: 'user',
        annotations: ['hidden'],
        content:
          '[Model: gpt]\n\n[Provider: OpenAI]\n\nTEMPLATE INSTRUCTIONS: For all designs I ask you to make, have them be beautiful, not cookie cutter.',
      },
    ]);

    expect(summarizeUserPrompt(prompt || '')).toBe('build purchase order management app');
  });

  it('skips template scaffolding even when the hidden annotation was not stored', () => {
    const prompt = latestVisibleUserPrompt([
      { role: 'user', content: 'build purchase order management app' },
      {
        role: 'user',
        content: 'TEMPLATE INSTRUCTIONS:\nMake webpages that are fully featured\n\ntemplate import is done',
      },
    ]);

    expect(prompt).toBe('build purchase order management app');
  });
});
