import { viteReactFiles } from '../shared/vite-react';

const APP_TSX = `import { FormEvent, useEffect, useMemo, useState } from "react";
import { Check, Plus, Trash2, ListTodo } from "lucide-react";

type Task = {
  id: string;
  title: string;
  done: boolean;
  createdAt: number;
};

type Filter = "all" | "active" | "done";

const STORAGE_KEY = "task-manager.tasks";

function loadTasks(): Task[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [
        { id: "1", title: "Plan the week", done: false, createdAt: Date.now() - 3000 },
        { id: "2", title: "Review open items", done: false, createdAt: Date.now() - 2000 },
        { id: "3", title: "Ship the first version", done: true, createdAt: Date.now() - 1000 },
      ];
    }
    const parsed = JSON.parse(raw) as Task[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export default function App() {
  const [tasks, setTasks] = useState<Task[]>(loadTasks);
  const [draft, setDraft] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
  }, [tasks]);

  const visible = useMemo(() => {
    if (filter === "active") {
      return tasks.filter((task) => !task.done);
    }
    if (filter === "done") {
      return tasks.filter((task) => task.done);
    }
    return tasks;
  }, [tasks, filter]);

  const remaining = tasks.filter((task) => !task.done).length;

  function addTask(event: FormEvent) {
    event.preventDefault();
    const title = draft.trim();
    if (!title) {
      return;
    }
    setTasks((current) => [
      { id: crypto.randomUUID(), title, done: false, createdAt: Date.now() },
      ...current,
    ]);
    setDraft("");
  }

  function toggleTask(id: string) {
    setTasks((current) =>
      current.map((task) => (task.id === id ? { ...task, done: !task.done } : task)),
    );
  }

  function removeTask(id: string) {
    setTasks((current) => current.filter((task) => task.id !== id));
  }

  function startEdit(task: Task) {
    setEditingId(task.id);
    setEditingTitle(task.title);
  }

  function saveEdit() {
    const title = editingTitle.trim();
    if (!editingId) {
      return;
    }
    if (!title) {
      removeTask(editingId);
    } else {
      setTasks((current) =>
        current.map((task) => (task.id === editingId ? { ...task, title } : task)),
      );
    }
    setEditingId(null);
    setEditingTitle("");
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-xl px-4 py-10">
        <header className="mb-8 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-sm">
            <ListTodo size={22} />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Task manager</h1>
            <p className="text-sm text-slate-500">{remaining} open · {tasks.length} total</p>
          </div>
        </header>

        <form onSubmit={addTask} className="mb-6 flex gap-2">
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Add a task…"
            className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none ring-indigo-500/30 placeholder:text-slate-400 focus:ring-4"
          />
          <button
            type="submit"
            className="inline-flex items-center gap-1 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-medium text-white shadow-sm hover:bg-indigo-500"
          >
            <Plus size={16} />
            Add
          </button>
        </form>

        <div className="mb-4 flex gap-2">
          {(["all", "active", "done"] as Filter[]).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              className={\`rounded-full px-3 py-1 text-xs font-medium capitalize \${
                filter === value ? "bg-slate-900 text-white" : "bg-white text-slate-600 border border-slate-200"
              }\`}
            >
              {value}
            </button>
          ))}
        </div>

        <ul className="space-y-2">
          {visible.length === 0 && (
            <li className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-400">
              No tasks here yet.
            </li>
          )}
          {visible.map((task) => (
            <li
              key={task.id}
              className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm"
            >
              <button
                type="button"
                onClick={() => toggleTask(task.id)}
                className={\`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border \${
                  task.done ? "border-emerald-500 bg-emerald-500 text-white" : "border-slate-300 text-transparent"
                }\`}
                aria-label={task.done ? "Mark incomplete" : "Mark complete"}
              >
                <Check size={14} />
              </button>
              {editingId === task.id ? (
                <input
                  autoFocus
                  value={editingTitle}
                  onChange={(event) => setEditingTitle(event.target.value)}
                  onBlur={saveEdit}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      saveEdit();
                    }
                    if (event.key === "Escape") {
                      setEditingId(null);
                    }
                  }}
                  className="flex-1 rounded-lg border border-slate-200 px-2 py-1 text-sm outline-none"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => startEdit(task)}
                  className={\`flex-1 text-left text-sm \${task.done ? "text-slate-400 line-through" : "text-slate-800"}\`}
                >
                  {task.title}
                </button>
              )}
              <button
                type="button"
                onClick={() => removeTask(task.id)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-rose-500"
                aria-label="Delete task"
              >
                <Trash2 size={16} />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
`;

export const TASK_MANAGER_FILES: Record<string, string> = {
  ...viteReactFiles('Task manager', 'task-manager'),
  'src/App.tsx': APP_TSX,
};
