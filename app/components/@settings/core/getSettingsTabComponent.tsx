import type { TabType } from './types';
import ProfileTab from '~/components/@settings/tabs/profile/ProfileTab';
import SettingsTab from '~/components/@settings/tabs/settings/SettingsTab';
import NotificationsTab from '~/components/@settings/tabs/notifications/NotificationsTab';
import FeaturesTab from '~/components/@settings/tabs/features/FeaturesTab';
import { DataTab } from '~/components/@settings/tabs/data/DataTab';
import { EventLogsTab } from '~/components/@settings/tabs/event-logs/EventLogsTab';
import GitHubTab from '~/components/@settings/tabs/github/GitHubTab';
import GitLabTab from '~/components/@settings/tabs/gitlab/GitLabTab';
import SupabaseTab from '~/components/@settings/tabs/supabase/SupabaseTab';
import VercelTab from '~/components/@settings/tabs/vercel/VercelTab';
import NetlifyTab from '~/components/@settings/tabs/netlify/NetlifyTab';
import ModelSettingsTab from '~/components/@settings/tabs/model/ModelSettingsTab';
import LocalProvidersTab from '~/components/@settings/tabs/providers/local/LocalProvidersTab';
import McpTab from '~/components/@settings/tabs/mcp/McpTab';
import SubscriptionTab from '~/components/@settings/tabs/subscription/SubscriptionTab';

export function getSettingsTabComponent(tabId: TabType) {
  switch (tabId) {
    case 'profile':
      return <ProfileTab />;
    case 'settings':
      return <SettingsTab />;
    case 'notifications':
      return <NotificationsTab />;
    case 'features':
      return <FeaturesTab />;
    case 'data':
      return <DataTab />;
    case 'cloud-providers':
      return <ModelSettingsTab />;
    case 'local-providers':
      return <LocalProvidersTab />;
    case 'github':
      return <GitHubTab />;
    case 'gitlab':
      return <GitLabTab />;
    case 'supabase':
      return <SupabaseTab />;
    case 'vercel':
      return <VercelTab />;
    case 'netlify':
      return <NetlifyTab />;
    case 'event-logs':
      return <EventLogsTab />;
    case 'mcp':
      return <McpTab />;
    case 'subscription':
      return <SubscriptionTab />;
    default:
      return null;
  }
}
