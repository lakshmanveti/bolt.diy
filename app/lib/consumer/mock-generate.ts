import { atom } from 'nanostores';
import type { ProgressAnnotation } from '~/types/context';
import type { ProgressItem } from '~/lib/consumer/progressLabels';
import { formatStartStatus, IDLE_START_STATUS, type DockerStartStatus } from '~/lib/runtime/start-status';
import { streamingState } from '~/lib/stores/streaming';

const PENDING_NAV_KEY = 'bl.dev-mock-build';

export type MockBuildState = {
  active: boolean;
  isStreaming: boolean;
  promptSummary: string;
  annotations: ProgressAnnotation[];
  items: ProgressItem[];
  dockerStatus: DockerStartStatus;
  previewBusy: boolean;
  hasPreview: boolean;
};

export const IDLE_MOCK_BUILD: MockBuildState = {
  active: false,
  isStreaming: false,
  promptSummary: '',
  annotations: [],
  items: [],
  dockerStatus: IDLE_START_STATUS,
  previewBusy: false,
  hasPreview: false,
};

export const mockBuildStore = atom<MockBuildState>(IDLE_MOCK_BUILD);

const FILE_STEPS: Array<{ id: string; label: string }> = [
  { id: 'pkg', label: 'Configuring the project' },
  { id: 'home', label: 'Building the home page' },
  { id: 'nav', label: 'Building navigation' },
  { id: 'login', label: 'Building the login experience' },
  { id: 'dash', label: 'Building the dashboard' },
];

type TimelineStep = {
  at: number;
  patch: Partial<MockBuildState>;
};

function fileItems(runningIndex: number): ProgressItem[] {
  return FILE_STEPS.map((step, index) => {
    let status: ProgressItem['status'] = 'pending';

    if (index < runningIndex) {
      status = 'complete';
    } else if (index === runningIndex) {
      status = 'running';
    }

    return {
      id: `mock:${step.id}`,
      label: step.label,
      status,
    };
  });
}

function annotation(order: number, message: string, status: ProgressAnnotation['status'] = 'in-progress'): ProgressAnnotation {
  return { type: 'progress', label: 'mock', status, order, message };
}

/** Scripted first-generate UI. Times are ms from start. */
export function mockGenerateTimeline(startedAt = Date.now()): TimelineStep[] {
  const dockerStarted = startedAt;

  return [
    {
      at: 0,
      patch: {
        active: true,
        isStreaming: true,
        hasPreview: false,
        previewBusy: false,
        promptSummary: 'A task manager with login and a dashboard',
        annotations: [annotation(1, 'Generating your app…')],
        items: fileItems(0),
        dockerStatus: IDLE_START_STATUS,
      },
    },
    { at: 900, patch: { items: fileItems(1), annotations: [annotation(2, 'Writing project files')] } },
    { at: 1800, patch: { items: fileItems(2) } },
    { at: 2700, patch: { items: fileItems(3) } },
    { at: 3600, patch: { items: fileItems(4) } },
    {
      at: 4800,
      patch: {
        isStreaming: false,
        items: FILE_STEPS.map((step) => ({ id: `mock:${step.id}`, label: step.label, status: 'complete' as const })),
        annotations: [annotation(3, 'Files ready', 'complete')],
      },
    },
    {
      at: 5200,
      patch: {
        items: [],
        previewBusy: true,
        dockerStatus: formatStartStatus({ stage: 'container', startedAt: dockerStarted }),
      },
    },
    {
      at: 7200,
      patch: {
        dockerStatus: formatStartStatus({
          stage: 'install',
          packageName: 'react',
          packagesAdded: 18,
          startedAt: dockerStarted,
        }),
      },
    },
    {
      at: 10000,
      patch: {
        dockerStatus: formatStartStatus({ stage: 'server', packagesAdded: 42, startedAt: dockerStarted }),
      },
    },
    {
      at: 13000,
      patch: {
        previewBusy: false,
        hasPreview: true,
        dockerStatus: formatStartStatus({ stage: 'ready', startedAt: dockerStarted }),
      },
    },
  ];
}

let runId = 0;
const timers = new Set<number>();

function clearTimers() {
  for (const id of timers) {
    window.clearTimeout(id);
  }

  timers.clear();
}

export function isMockBuildActive(): boolean {
  return Boolean(import.meta.env.DEV) && mockBuildStore.get().active;
}

export function stopMockGenerate(): void {
  runId += 1;
  clearTimers();
  mockBuildStore.set(IDLE_MOCK_BUILD);
}

export function startMockGenerate(): boolean {
  if (!import.meta.env.DEV) {
    return false;
  }

  if (streamingState.get()) {
    return false;
  }

  stopMockGenerate();

  const thisRun = runId;
  const steps = mockGenerateTimeline();
  mockBuildStore.set({ ...IDLE_MOCK_BUILD, ...steps[0]?.patch, active: true });

  for (const step of steps.slice(1)) {
    const id = window.setTimeout(() => {
      timers.delete(id);

      if (thisRun !== runId) {
        return;
      }

      mockBuildStore.set({ ...mockBuildStore.get(), ...step.patch, active: true });
    }, step.at);

    timers.add(id);
  }

  return true;
}

export function queueMockGenerateAfterNavigation(): void {
  if (!import.meta.env.DEV) {
    return;
  }

  try {
    sessionStorage.setItem(PENDING_NAV_KEY, '1');
  } catch {
    // private mode
  }
}

export function consumeQueuedMockGenerate(): boolean {
  if (!import.meta.env.DEV) {
    return false;
  }

  try {
    if (sessionStorage.getItem(PENDING_NAV_KEY) === '1') {
      sessionStorage.removeItem(PENDING_NAV_KEY);
      return true;
    }
  } catch {
    return false;
  }

  return false;
}
