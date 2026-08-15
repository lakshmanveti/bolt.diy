import { atom } from 'nanostores';
import type { VercelConnection } from '~/types/vercel';
import { logStore } from './logs';
import { toast } from 'react-toastify';

const storedConnection = typeof window !== 'undefined' ? localStorage.getItem('vercel_connection') : null;
let initialConnection: VercelConnection;

if (storedConnection) {
  try {
    initialConnection = JSON.parse(storedConnection);
  } catch (error) {
    console.error('Error parsing saved Vercel connection:', error);
    initialConnection = {
      user: null,
      token: '',
      stats: undefined,
    };
  }
} else {
  initialConnection = {
    user: null,
    token: '',
    stats: undefined,
  };
}

export const vercelConnection = atom<VercelConnection>(initialConnection);
export const isConnecting = atom<boolean>(false);
export const isFetchingStats = atom<boolean>(false);

export const updateVercelConnection = (updates: Partial<VercelConnection>) => {
  const currentState = vercelConnection.get();
  const newState = { ...currentState, ...updates };
  vercelConnection.set(newState);

  // Persist to localStorage
  if (typeof window !== 'undefined') {
    localStorage.setItem('vercel_connection', JSON.stringify(newState));
  }

  void import('~/lib/supabase/user-integrations').then(({ schedulePersistIntegrations }) => {
    schedulePersistIntegrations();
  });
};

export async function autoConnectVercel() {
  return { success: false, error: 'Connect with a personal Vercel token' };
}

export function initializeVercelConnection() {
  // Users connect with a personal token. Do not call Vercel with env tokens.
}

export const fetchVercelStatsViaAPI = fetchVercelStats;

export async function fetchVercelStats(token: string) {
  try {
    isFetchingStats.set(true);

    const projectsResponse = await fetch('https://api.vercel.com/v9/projects', {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!projectsResponse.ok) {
      throw new Error(`Failed to fetch projects: ${projectsResponse.status}`);
    }

    const projectsData = (await projectsResponse.json()) as any;
    const projects = projectsData.projects || [];

    // Fetch latest deployment for each project
    const projectsWithDeployments = await Promise.all(
      projects.map(async (project: any) => {
        try {
          const deploymentsResponse = await fetch(
            `https://api.vercel.com/v6/deployments?projectId=${project.id}&limit=1`,
            {
              headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
              },
            },
          );

          if (deploymentsResponse.ok) {
            const deploymentsData = (await deploymentsResponse.json()) as any;
            return {
              ...project,
              latestDeployments: deploymentsData.deployments || [],
            };
          }

          return project;
        } catch (error) {
          console.error(`Error fetching deployments for project ${project.id}:`, error);
          return project;
        }
      }),
    );

    const currentState = vercelConnection.get();
    updateVercelConnection({
      ...currentState,
      stats: {
        projects: projectsWithDeployments,
        totalProjects: projectsWithDeployments.length,
      },
    });
  } catch (error) {
    console.error('Vercel API Error:', error);
    logStore.logError('Failed to fetch Vercel stats', { error });
    toast.error('Failed to fetch Vercel statistics');
  } finally {
    isFetchingStats.set(false);
  }
}
