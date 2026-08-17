import { viteReactFiles } from '../shared/vite-react';

const APP_TSX = `import { FormEvent, useEffect, useMemo, useState } from "react";
import { Inbox, Plus } from "lucide-react";

type Status = "open" | "in_progress" | "resolved";

type Ticket = {
  id: string;
  title: string;
  description: string;
  status: Status;
  createdAt: number;
};

const STORAGE_KEY = "ticketing.tickets";

const STATUS_LABEL: Record<Status, string> = {
  open: "Open",
  in_progress: "In progress",
  resolved: "Resolved",
};

const STATUS_CLASS: Record<Status, string> = {
  open: "bg-sky-50 text-sky-700 border-sky-200",
  in_progress: "bg-amber-50 text-amber-700 border-amber-200",
  resolved: "bg-emerald-50 text-emerald-700 border-emerald-200",
};

function loadTickets(): Ticket[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [
        {
          id: "t1",
          title: "Cannot reset password",
          description: "User reports the reset email never arrives.",
          status: "open",
          createdAt: Date.now() - 4000,
        },
        {
          id: "t2",
          title: "Slow dashboard load",
          description: "Dashboard takes ~8s on first paint for larger accounts.",
          status: "in_progress",
          createdAt: Date.now() - 2000,
        },
        {
          id: "t3",
          title: "Export CSV encoding",
          description: "Exported names with accents show as question marks.",
          status: "resolved",
          createdAt: Date.now() - 1000,
        },
      ];
    }
    const parsed = JSON.parse(raw) as Ticket[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export default function App() {
  const [tickets, setTickets] = useState<Ticket[]>(loadTickets);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tickets));
  }, [tickets]);

  const selected = useMemo(
    () => tickets.find((ticket) => ticket.id === selectedId) ?? tickets[0] ?? null,
    [tickets, selectedId],
  );

  function createTicket(event: FormEvent) {
    event.preventDefault();
    const nextTitle = title.trim();
    if (!nextTitle) {
      return;
    }
    const ticket: Ticket = {
      id: crypto.randomUUID(),
      title: nextTitle,
      description: description.trim(),
      status: "open",
      createdAt: Date.now(),
    };
    setTickets((current) => [ticket, ...current]);
    setSelectedId(ticket.id);
    setTitle("");
    setDescription("");
    setComposing(false);
  }

  function setStatus(id: string, status: Status) {
    setTickets((current) => current.map((ticket) => (ticket.id === id ? { ...ticket, status } : ticket)));
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto grid min-h-screen max-w-5xl grid-cols-1 md:grid-cols-[320px_1fr]">
        <aside className="border-r border-slate-200 bg-white p-4">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-900 text-white">
                <Inbox size={18} />
              </div>
              <div>
                <h1 className="text-sm font-semibold">Tickets</h1>
                <p className="text-xs text-slate-500">{tickets.length} total</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setComposing(true)}
              className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-indigo-500"
            >
              <Plus size={14} />
              New
            </button>
          </div>
          <ul className="space-y-2">
            {tickets.map((ticket) => (
              <li key={ticket.id}>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedId(ticket.id);
                    setComposing(false);
                  }}
                  className={\`w-full rounded-xl border px-3 py-3 text-left \${
                    selected?.id === ticket.id && !composing
                      ? "border-indigo-200 bg-indigo-50"
                      : "border-slate-200 bg-white hover:bg-slate-50"
                  }\`}
                >
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">{ticket.title}</span>
                    <span className={\`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium \${STATUS_CLASS[ticket.status]}\`}>
                      {STATUS_LABEL[ticket.status]}
                    </span>
                  </div>
                  <p className="truncate text-xs text-slate-500">{ticket.description || "No description"}</p>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <main className="p-6">
          {composing ? (
            <form onSubmit={createTicket} className="max-w-lg space-y-4">
              <h2 className="text-xl font-semibold">New ticket</h2>
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Title"
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:ring-4 focus:ring-indigo-500/20"
              />
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="What happened?"
                rows={5}
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:ring-4 focus:ring-indigo-500/20"
              />
              <div className="flex gap-2">
                <button type="submit" className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white">
                  Create ticket
                </button>
                <button
                  type="button"
                  onClick={() => setComposing(false)}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm"
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : selected ? (
            <div className="max-w-lg">
              <p className={\`mb-3 inline-flex rounded-full border px-2.5 py-1 text-xs font-medium \${STATUS_CLASS[selected.status]}\`}>
                {STATUS_LABEL[selected.status]}
              </p>
              <h2 className="mb-2 text-2xl font-semibold tracking-tight">{selected.title}</h2>
              <p className="mb-6 whitespace-pre-wrap text-sm leading-6 text-slate-600">
                {selected.description || "No description provided."}
              </p>
              <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-slate-500">
                Status
              </label>
              <select
                value={selected.status}
                onChange={(event) => setStatus(selected.id, event.target.value as Status)}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                <option value="open">Open</option>
                <option value="in_progress">In progress</option>
                <option value="resolved">Resolved</option>
              </select>
            </div>
          ) : (
            <p className="text-sm text-slate-500">Create a ticket to get started.</p>
          )}
        </main>
      </div>
    </div>
  );
}
`;

export const TICKETING_FILES: Record<string, string> = {
  ...viteReactFiles('Ticketing', 'ticketing'),
  'src/App.tsx': APP_TSX,
};
