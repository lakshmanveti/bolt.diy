import { describe, expect, it } from 'vitest';
import { matchCatalog, meaningfulExtras, snapCategoryToCatalog } from './match-catalog';
import { seedSummaries } from './manifest';
import type { TemplateSummary } from './types';

const hello: TemplateSummary = {
  category: 'hello_world',
  title: 'Hello world',
  description: 'generate a hello world app',
  keywords: ['hello world', 'hello world app'],
};

const budget: TemplateSummary = {
  category: 'monthly_budget_planner',
  title: 'Monthly Budget Planner',
  description: 'Track monthly expenses, income, and remaining budget',
  keywords: ['budget', 'expense tracker', 'monthly budget', 'planner', 'app', 'tracker'],
};

const catalog: TemplateSummary[] = [
  hello,
  {
    category: 'task_manager',
    title: 'Task manager',
    description: 'todos',
    keywords: ['todo', 'task manager'],
  },
  budget,
];

describe('matchCatalog', () => {
  it('reuses hello_world for similar wording', () => {
    const match = matchCatalog('generate a hello world application', catalog);

    expect(match?.item.category).toBe('hello_world');
  });

  it('does not match an unrelated prompt', () => {
    expect(matchCatalog('purchase order management system', catalog)).toBeNull();
  });

  it('does not reuse a budget planner for a book reading tracker', () => {
    expect(matchCatalog('build a Book Reading Tracker application', catalog)).toBeNull();
  });

  it('still reuses task_manager for a todo request', () => {
    const match = matchCatalog('build a todo list for daily tasks', [...seedSummaries(), hello, budget]);

    expect(match?.item.category).toBe('task_manager');
  });

  it('snaps hello_world_application onto hello_world', () => {
    expect(snapCategoryToCatalog('hello_world_application', catalog)?.category).toBe('hello_world');
  });
});

describe('meaningfulExtras', () => {
  it('drops restated hello-world extras', () => {
    expect(
      meaningfulExtras(['hello world', 'application'], 'generate a hello world application', 'Hello world', 'hello_world'),
    ).toEqual([]);
  });
});
