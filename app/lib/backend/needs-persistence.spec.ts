import { describe, expect, it } from 'vitest';
import type { FileMap } from '~/lib/stores/files';
import { projectHasSupabaseBackend, projectNeedsPersistence } from './needs-persistence';

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
});
