import { describe, expect, it } from 'vitest';
import { classifyAppIntentWithKeywords } from './classify-intent';
import { seedSummaries } from './manifest';
import type { TemplateSummary } from './types';

describe('classifyAppIntentWithKeywords', () => {
  it.each([
    'Task manager application',
    'Todo app for my team',
    'Something to track my daily tasks',
    'I want to manage work items',
  ])('maps %s to task_manager', (prompt) => {
    const result = classifyAppIntentWithKeywords(prompt);

    expect(result.category).toBe('task_manager');
    expect(result.confidence).toBeGreaterThanOrEqual(0.6);
    expect(result.extras).toEqual([]);
  });

  it.each(['support desk for bugs', 'a ticketing app', 'helpdesk tickets'])('maps %s to ticketing', (prompt) => {
    const result = classifyAppIntentWithKeywords(prompt);

    expect(result.category).toBe('ticketing');
    expect(result.confidence).toBeGreaterThanOrEqual(0.6);
  });

  it('returns unknown for unrelated prompts when catalog has no match', () => {
    const result = classifyAppIntentWithKeywords('a weather dashboard for sailors');

    expect(result.category).toBe('unknown');
  });

  it('matches a DB-grown category such as purchase orders', () => {
    const catalog: TemplateSummary[] = [
      ...seedSummaries(),
      {
        category: 'purchase_order',
        title: 'Purchase orders',
        description: 'PO / procurement management',
        keywords: ['purchase order', 'po manager', 'procurement', 'purchase orders'],
      },
    ];

    const result = classifyAppIntentWithKeywords('PO manager / purchase order management system', catalog);

    expect(result.category).toBe('purchase_order');
    expect(result.confidence).toBeGreaterThanOrEqual(0.6);
  });
});
