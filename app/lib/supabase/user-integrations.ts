import Cookies from 'js-cookie';
import { getPreferenceSection, patchUserPreferences, type UserPreferenceDocument } from '~/lib/supabase/user-preferences';
import { getSupabaseClient, requireAuthUser } from '~/lib/supabase/client';
import { githubConnection, updateGitHubConnection } from '~/lib/stores/github';
import { githubConnectionAtom } from '~/lib/stores/githubConnection';
import { gitlabConnectionAtom, replaceGitLabConnection } from '~/lib/stores/gitlabConnection';
import { netlifyConnection, updateNetlifyConnection } from '~/lib/stores/netlify';
import { vercelConnection, updateVercelConnection } from '~/lib/stores/vercel';
import { supabaseConnection, updateSupabaseConnection } from '~/lib/stores/supabase';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('UserIntegrations');

export const INTEGRATIONS_PREFERENCE_KEY = 'integrations';

type StoredGithub = {
  token: string;
  tokenType: 'classic' | 'fine-grained';
  user: Record<string, unknown> | null;
};

type StoredGitlab = {
  token: string;
  tokenType: 'personal-access-token';
  gitlabUrl?: string;
  user: Record<string, unknown> | null;
};

type StoredNetlify = {
  token: string;
  user: Record<string, unknown> | null;
};

type StoredVercel = {
  token: string;
  user: Record<string, unknown> | null;
};

type StoredSupabase = {
  token: string;
  user: Record<string, unknown> | null;
  selectedProjectId?: string;
  credentials?: { anonKey?: string; supabaseUrl?: string };
  project?: Record<string, unknown>;
};

export type StoredIntegrations = {
  github?: StoredGithub | null;
  gitlab?: StoredGitlab | null;
  netlify?: StoredNetlify | null;
  vercel?: StoredVercel | null;
  supabase?: StoredSupabase | null;
};

let hydrating = false;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let lastPersisted = '';
let persistBusy = false;
let persistQueued = false;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asUser(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function slimGithub(): StoredGithub | null {
  const primary = githubConnection.get();
  const fallback = githubConnectionAtom.get();
  const connection = primary.user || primary.token ? primary : fallback;

  if (!connection.token && !connection.user) {
    return null;
  }

  return {
    token: connection.token || '',
    tokenType: connection.tokenType === 'fine-grained' ? 'fine-grained' : 'classic',
    user: asUser(connection.user),
  };
}

function slimGitlab(): StoredGitlab | null {
  const connection = gitlabConnectionAtom.get();

  if (!connection.token && !connection.user) {
    return null;
  }

  return {
    token: connection.token || '',
    tokenType: 'personal-access-token',
    gitlabUrl: connection.gitlabUrl || 'https://gitlab.com',
    user: asUser(connection.user),
  };
}

function slimNetlify(): StoredNetlify | null {
  const connection = netlifyConnection.get();

  if (!connection.token && !connection.user) {
    return null;
  }

  return {
    token: connection.token || '',
    user: asUser(connection.user),
  };
}

function slimVercel(): StoredVercel | null {
  const connection = vercelConnection.get();

  if (!connection.token && !connection.user) {
    return null;
  }

  return {
    token: connection.token || '',
    user: asUser(connection.user),
  };
}

function slimSupabase(): StoredSupabase | null {
  const connection = supabaseConnection.get();

  if (!connection.token && !connection.user && !connection.selectedProjectId && !connection.credentials) {
    return null;
  }

  const project = connection.project
    ? {
        id: connection.project.id,
        name: connection.project.name,
        region: connection.project.region,
        organization_id: connection.project.organization_id,
        status: connection.project.status,
        created_at: connection.project.created_at,
      }
    : undefined;

  return {
    token: connection.token || '',
    user: asUser(connection.user),
    selectedProjectId: connection.selectedProjectId,
    credentials: connection.credentials,
    project,
  };
}

function collectIntegrations(): StoredIntegrations {
  return {
    github: slimGithub(),
    gitlab: slimGitlab(),
    netlify: slimNetlify(),
    vercel: slimVercel(),
    supabase: slimSupabase(),
  };
}

const INTEGRATION_KEYS = ['github', 'gitlab', 'netlify', 'vercel', 'supabase'] as const;

function hasStoredIntegrations(stored: StoredIntegrations | null): boolean {
  if (!stored) {
    return false;
  }

  return INTEGRATION_KEYS.some((key) => {
    const value = stored[key];
    return Boolean(value && (value.token || value.user));
  });
}

function collectIntegrationsPatch(): StoredIntegrations {
  const current: StoredIntegrations = {
    github: slimGithub(),
    gitlab: slimGitlab(),
    netlify: slimNetlify(),
    vercel: slimVercel(),
    supabase: slimSupabase(),
  };

  let last: StoredIntegrations = {};

  try {
    last = lastPersisted ? (JSON.parse(lastPersisted) as StoredIntegrations) : {};
  } catch {
    last = {};
  }

  const patch: StoredIntegrations = {};

  for (const key of INTEGRATION_KEYS) {
    if (current[key]) {
      patch[key] = current[key];
    } else if (last[key]) {
      patch[key] = null;
    }
  }

  return patch;
}

function applyGithub(stored: StoredGithub | null | undefined) {
  if (stored === undefined) {
    return;
  }

  const next = {
    token: stored?.token || '',
    tokenType: (stored?.tokenType === 'fine-grained' ? 'fine-grained' : 'classic') as 'classic' | 'fine-grained',
    user: (stored?.user as any) || null,
  };

  updateGitHubConnection(next);
  githubConnectionAtom.set(next);

  if (next.user && next.token) {
    Cookies.set('githubUsername', String(next.user.login || ''));
    Cookies.set('githubToken', next.token);
    Cookies.set('git:github.com', JSON.stringify({ username: next.token, password: 'x-oauth-basic' }));
  } else {
    Cookies.remove('githubUsername');
    Cookies.remove('githubToken');
    Cookies.remove('git:github.com');
  }
}

function applyGitlab(stored: StoredGitlab | null | undefined) {
  if (stored === undefined) {
    return;
  }

  const next = {
    token: stored?.token || '',
    tokenType: 'personal-access-token' as const,
    gitlabUrl: stored?.gitlabUrl || 'https://gitlab.com',
    user: (stored?.user as any) || null,
  };

  replaceGitLabConnection(next);

  if (next.user && next.token) {
    Cookies.set('gitlabUsername', String(next.user.username || ''));
    Cookies.set('gitlabToken', next.token);
    Cookies.set('gitlabUrl', next.gitlabUrl);
    Cookies.set('git:gitlab.com', JSON.stringify({ username: next.user.username, password: next.token }));
  }
}

function applyNetlify(stored: StoredNetlify | null | undefined) {
  if (stored === undefined) {
    return;
  }

  updateNetlifyConnection({
    token: stored?.token || '',
    user: (stored?.user as any) || null,
  });
}

function applyVercel(stored: StoredVercel | null | undefined) {
  if (stored === undefined) {
    return;
  }

  updateVercelConnection({
    token: stored?.token || '',
    user: (stored?.user as any) || null,
  });
}

function applySupabase(stored: StoredSupabase | null | undefined) {
  if (stored === undefined) {
    return;
  }

  updateSupabaseConnection({
    token: stored?.token || '',
    user: (stored?.user as any) || null,
    selectedProjectId: stored?.selectedProjectId,
    credentials: stored?.credentials,
    project: stored?.project as any,
    isConnected: Boolean(stored?.user && stored?.token),
  });
}

export function applyIntegrationsFromDocument(doc: UserPreferenceDocument | null | undefined) {
  if (typeof window === 'undefined') {
    return;
  }

  const stored = getPreferenceSection<StoredIntegrations>(doc, INTEGRATIONS_PREFERENCE_KEY);

  if (!hasStoredIntegrations(stored)) {
    schedulePersistIntegrations();
    return;
  }

  hydrating = true;

  try {
    applyGithub(stored!.github);
    applyGitlab(stored!.gitlab);
    applyNetlify(stored!.netlify);
    applyVercel(stored!.vercel);
    applySupabase(stored!.supabase);
    lastPersisted = JSON.stringify(collectIntegrations());
  } catch (error) {
    logger.warn('Failed to apply saved integrations', error);
  } finally {
    hydrating = false;
  }
}

async function persistIntegrations() {
  if (hydrating) {
    return;
  }

  if (persistBusy) {
    persistQueued = true;
    return;
  }

  const supabase = getSupabaseClient();
  const user = await requireAuthUser();

  if (!supabase || !user) {
    return;
  }

  const snapshot = collectIntegrations();
  const patch = collectIntegrationsPatch();
  const serialized = JSON.stringify(snapshot);

  if (serialized === lastPersisted || Object.keys(patch).length === 0) {
    lastPersisted = serialized;
    return;
  }

  persistBusy = true;

  try {
    await patchUserPreferences({ [INTEGRATIONS_PREFERENCE_KEY]: patch });
    lastPersisted = serialized;
  } catch (error) {
    logger.warn('Failed to save integrations', error);
  } finally {
    persistBusy = false;

    if (persistQueued) {
      persistQueued = false;
      void persistIntegrations();
    }
  }
}

export function schedulePersistIntegrations() {
  if (hydrating || typeof window === 'undefined') {
    return;
  }

  if (persistTimer) {
    clearTimeout(persistTimer);
  }

  persistTimer = setTimeout(() => {
    persistTimer = null;
    void persistIntegrations();
  }, 600);
}
