import { describe, expect, it } from 'vitest';
import type { FileMap } from '~/lib/stores/files';
import {
  ADD_BACKEND_FOLLOWUP,
  isAddBackendRequest,
  projectHasSupabaseBackend,
  projectNeedsPersistence,
  supabaseActionsAllowed,
} from './needs-persistence';

function files(entries: Record<string, string>): FileMap {
  return Object.fromEntries(
    Object.entries(entries).map(([path, content]) => [path, { type: 'file' as const, content, isBinary: false }]),
  );
}

describe('needs-persistence', () => {
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

  it('skips apps already wired to Supabase', () => {
    const map = files({
      '/home/project/src/lib/supabase.ts': `import { createClient } from '@supabase/supabase-js';`,
      '/home/project/src/Contact.tsx': `<form onSubmit={handleSubmit}><input name="email" /></form>`,
    });

    expect(projectHasSupabaseBackend(map)).toBe(true);
    expect(projectNeedsPersistence(map)).toBe(false);
  });

  it('treats the Add Backend follow-up as an explicit backend request', () => {
    expect(isAddBackendRequest(ADD_BACKEND_FOLLOWUP)).toBe(true);
    expect(isAddBackendRequest('add a backend with supabase')).toBe(true);
    expect(isAddBackendRequest('Build a todo app')).toBe(false);
    expect(isAddBackendRequest('Create a contact form')).toBe(false);
  });

  it('blocks supabase actions until the app is wired or Add Backend completed', () => {
    const uiOnly = files({
      '/home/project/src/App.tsx': `export default function App() { return <h1>Hello</h1>; }`,
    });

    expect(supabaseActionsAllowed('chat-1', uiOnly)).toBe(false);
    expect(
      supabaseActionsAllowed(
        'chat-1',
        files({
          '/home/project/src/lib/supabase.ts': `import { createClient } from '@supabase/supabase-js';`,
        }),
      ),
    ).toBe(true);
  });
});
