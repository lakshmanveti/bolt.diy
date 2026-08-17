import { describe, expect, it } from 'vitest';
import { matchCatalog, meaningfulExtras, snapCategoryToCatalog } from './match-catalog';
import type { TemplateSummary } from './types';

const hello: TemplateSummary = {
  category: 'hello_world',
  title: 'Hello world',
  description: 'generate a hello world app',
  keywords: ['hello world', 'hello world app'],
};

const catalog: TemplateSummary[] = [
  hello,
  {
    category: 'task_manager',
    title: 'Task manager',
    description: 'todos',
    keywords: ['todo', 'task manager'],
  },
];

describe('matchCatalog', () => {
  it('reuses hello_world for similar wording', () => {
    const match = matchCatalog('generate a hello world application', catalog);

    expect(match?.item.category).toBe('hello_world');
  });

  it('does not match an unrelated prompt', () => {
    expect(matchCatalog('purchase order management system', catalog)).toBeNull();
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
