import type { ActionState } from '~/lib/runtime/action-runner';

const FILE_HINTS: Array<{ match: RegExp; label: string }> = [
  { match: /login|signin|sign-in|auth/i, label: 'Building the login experience' },
  { match: /signup|register|sign-up/i, label: 'Building the sign-up flow' },
  { match: /dashboard/i, label: 'Building the dashboard' },
  { match: /nav|header|sidebar/i, label: 'Building navigation' },
  { match: /footer/i, label: 'Building the footer' },
  { match: /home|landing|hero/i, label: 'Building the home page' },
  { match: /cart|checkout|payment|stripe/i, label: 'Building checkout' },
  { match: /product|shop|store/i, label: 'Building the product experience' },
  { match: /profile|account|settings/i, label: 'Building account settings' },
  { match: /form/i, label: 'Building a form' },
  { match: /button|modal|dialog|toast/i, label: 'Adding UI components' },
  { match: /api|route|server/i, label: 'Setting up app logic' },
  { match: /style|css|theme|tailwind/i, label: 'Styling the app' },
  { match: /package\.json|lock/i, label: 'Configuring the project' },
  { match: /index\.html|vite\.config|tsconfig/i, label: 'Setting up the project' },
  { match: /App\.(tsx|jsx|vue|svelte)/i, label: 'Building the main app' },
  { match: /main\.(tsx|jsx|ts|js)/i, label: 'Setting up the app entry' },
];

function fileStem(filePath: string): string {
  const parts = filePath.replace(/\\/g, '/').split('/');
  const name = parts[parts.length - 1] || filePath;
  return name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
}

export function labelForFilePath(filePath: string): string {
  for (const hint of FILE_HINTS) {
    if (hint.match.test(filePath)) {
      return hint.label;
    }
  }

  const stem = fileStem(filePath);

  if (stem) {
    return `Adding ${stem}`;
  }

  return 'Adding a new piece of the app';
}

export function labelForShell(content: string): string {
  const cmd = content.trim().toLowerCase();

  if (/npm\s+i(nstall)?|pnpm\s+i(nstall)?|yarn\s+(add|install)|bun\s+i(nstall)?/.test(cmd)) {
    return 'Installing packages';
  }

  if (/npm\s+run\s+dev|pnpm\s+dev|yarn\s+dev|bun\s+dev|vite|next\s+dev/.test(cmd)) {
    return 'Starting your app';
  }

  if (/npm\s+run\s+build|pnpm\s+build|yarn\s+build|bun\s+run\s+build/.test(cmd)) {
    return 'Building your app';
  }

  if (/git\s+/.test(cmd)) {
    return 'Updating project files';
  }

  return 'Running a setup step';
}

export function labelForAction(action: ActionState): string {
  switch (action.type) {
    case 'file':
      return labelForFilePath(action.filePath || '');
    case 'shell':
      return labelForShell(action.content || '');
    case 'start':
      return 'Starting your app';
    case 'build':
      return 'Building your app';
    case 'supabase':
      return action.operation === 'migration' ? 'Setting up the database' : 'Updating the database';
    default:
      return 'Working on your app';
  }
}

export function statusLabel(status: ActionState['status']): string {
  switch (status) {
    case 'pending':
      return 'Waiting';
    case 'running':
      return 'In progress';
    case 'complete':
      return 'Done';
    case 'aborted':
      return 'Stopped';
    case 'failed':
      return 'Needs attention';
    default:
      return '';
  }
}

export interface ProgressItem {
  id: string;
  label: string;
  status: ActionState['status'];
}

export function dedupeProgressItems(items: ProgressItem[]): ProgressItem[] {
  const seen = new Map<string, ProgressItem>();

  for (const item of items) {
    const existing = seen.get(item.label);

    if (!existing) {
      seen.set(item.label, item);
      continue;
    }

    // Prefer active / failed over complete when labels collide
    const rank = (s: ActionState['status']) =>
      s === 'running' ? 4 : s === 'pending' ? 3 : s === 'failed' ? 2 : s === 'complete' ? 1 : 0;

    if (rank(item.status) >= rank(existing.status)) {
      seen.set(item.label, item);
    }
  }

  return Array.from(seen.values());
}
