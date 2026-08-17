import { TASK_MANAGER_FILES } from './task_manager/files';
import { TICKETING_FILES } from './ticketing/files';
import type { AppStarter, TemplateSummary } from './types';

export const APP_STARTERS: AppStarter[] = [
  {
    category: 'task_manager',
    title: 'Task manager',
    description: 'Todo list with add, edit, complete, and local state',
    readyMessage: "Here's a task manager. Tell me what to change.",
    keywords: [
      'task manager',
      'todo',
      'to-do',
      'to do',
      'tasks',
      'checklist',
      'work items',
      'daily tasks',
      'task list',
      'todo list',
      'to-do list',
    ],
    files: TASK_MANAGER_FILES,
    startCommand: 'npm install && npm run dev',
  },
  {
    category: 'ticketing',
    title: 'Ticketing',
    description: 'Support tickets with list, status, and a simple detail view',
    readyMessage: "Here's a ticketing app. Tell me what to change.",
    keywords: [
      'ticketing',
      'ticket',
      'tickets',
      'support desk',
      'helpdesk',
      'help desk',
      'issue tracker',
      'bug tracker',
      'support tickets',
    ],
    files: TICKETING_FILES,
    startCommand: 'npm install && npm run dev',
  },
];

export function seedSummaries(): TemplateSummary[] {
  return APP_STARTERS.map(({ category, title, description, keywords }) => ({
    category,
    title,
    description,
    keywords,
  }));
}

export function getSeedStarter(category: string): AppStarter | undefined {
  return APP_STARTERS.find((starter) => starter.category === category);
}

export function mergeCatalog(dbRows: TemplateSummary[]): TemplateSummary[] {
  const byCategory = new Map<string, TemplateSummary>();

  for (const seed of seedSummaries()) {
    byCategory.set(seed.category, seed);
  }

  for (const row of dbRows) {
    byCategory.set(row.category, row);
  }

  return [...byCategory.values()];
}
