import { beforeEach, describe, expect, it } from 'vitest';
import type { FileMap } from '~/lib/stores/files';
import {
  ADD_BACKEND_FOLLOWUP,
  isAddBackendRequest,
  isSupabaseMigrationPath,
  markAddBackendRequested,
  projectHasSupabaseBackend,
  projectHasSupabaseClient,
  projectHasSupabaseMigrations,
  projectNeedsPersistence,
  supabaseActionsAllowed,
} from './needs-persistence';

function files(entries: Record<string, string>): FileMap {
  return Object.fromEntries(
    Object.entries(entries).map(([path, content]) => [path, { type: 'file' as const, content, isBinary: false }]),
  );
}

describe('needs-persistence', () => {
  const memory = new Map<string, string>();

  beforeEach(() => {
    memory.clear();
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => memory.get(key) ?? null,
        setItem: (key: string, value: string) => {
          memory.set(key, value);
        },
        clear: () => memory.clear(),
      },
    });
  });

  it('skips hello-world and counter UIs', () => {
    const map = files({
      '/home/project/src/App.tsx': `
        export default function App() {
          const [count, setCount] = useState(0);
          return <h1>Hello world <button onClick={() => setCount(count + 1)}>{count}</button></h1>;
        }
      `,
    });

    expect(projectNeedsPersistence(map)).toBe(false);
  });

  it('detects a form that needs persistence', () => {
    const map = files({
      '/home/project/src/Contact.tsx': `
        export function Contact() {
          return (
            <form onSubmit={handleSubmit}>
              <input name="email" />
              <button type="submit">Send</button>
            </form>
          );
        }
      `,
    });

    expect(projectNeedsPersistence(map)).toBe(true);
  });

  it('detects CRUD-ish todo UI', () => {
    const map = files({
      '/home/project/src/Todos.tsx': `
        export function Todos() {
          const addTodo = () => {};
          const deleteTodo = () => {};
          return <ul>{todos.map((todo) => <li key={todo.id}>{todo.title}</li>)}</ul>;
        }
      `,
    });

    expect(projectNeedsPersistence(map)).toBe(true);
  });

  it('treats a client-only wire as incomplete until migrations exist', () => {
    const clientOnly = files({
      '/home/project/src/lib/supabase.ts': `import { createClient } from '@supabase/supabase-js';`,
      '/home/project/src/Contact.tsx': `<form onSubmit={handleSubmit}><input name="email" /></form>`,
    });

    expect(projectHasSupabaseClient(clientOnly)).toBe(true);
    expect(projectHasSupabaseMigrations(clientOnly)).toBe(false);
    expect(projectHasSupabaseBackend(clientOnly)).toBe(true);
    expect(projectNeedsPersistence(clientOnly)).toBe(true);
  });

  it('skips persistence when SQL migrations already exist', () => {
    const map = files({
      '/home/project/supabase/migrations/001_init.sql': 'create table contacts (id uuid primary key);',
      '/home/project/src/Contact.tsx': `<form onSubmit={handleSubmit}><input name="email" /></form>`,
    });

    expect(projectHasSupabaseMigrations(map)).toBe(true);
    expect(projectNeedsPersistence(map)).toBe(false);
  });

  it('treats the Add Backend follow-up as an explicit backend request', () => {
    expect(isAddBackendRequest(ADD_BACKEND_FOLLOWUP)).toBe(true);
    expect(isAddBackendRequest('add a backend with supabase')).toBe(true);
    expect(isAddBackendRequest('Integrate with backend with supabase')).toBe(true);
    expect(isAddBackendRequest('connect this app to supabase')).toBe(true);
    expect(isAddBackendRequest('Build a todo app')).toBe(false);
    expect(isAddBackendRequest('Create a contact form')).toBe(false);
    expect(isAddBackendRequest("don't add supabase")).toBe(false);
  });

  it('detects migration SQL paths', () => {
    expect(isSupabaseMigrationPath('/home/project/supabase/migrations/001_init.sql')).toBe(true);
    expect(isSupabaseMigrationPath('supabase/migrations/seed.sql')).toBe(true);
    expect(isSupabaseMigrationPath('/home/project/src/lib/supabase.ts')).toBe(false);
  });

  it('blocks supabase actions until the app is wired or Add Backend is requested', () => {
    const uiOnly = files({
      '/home/project/src/App.tsx': `export default function App() { return <h1>Hello</h1>; }`,
    });

    expect(supabaseActionsAllowed('chat-1', uiOnly)).toBe(false);

    markAddBackendRequested('chat-1');
    expect(supabaseActionsAllowed('chat-1', uiOnly)).toBe(true);

    expect(
      supabaseActionsAllowed(
        'chat-2',
        files({
          '/home/project/src/lib/supabase.ts': `import { createClient } from '@supabase/supabase-js';`,
        }),
      ),
    ).toBe(true);
  });
});
