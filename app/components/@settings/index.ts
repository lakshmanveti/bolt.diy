// Core exports
export { SettingsTabModal } from './core/SettingsTabModal';
export { getSettingsTabComponent } from './core/getSettingsTabComponent';
export { useVisibleUserTabs } from './core/useVisibleUserTabs';
export type { TabType, TabVisibilityConfig } from './core/types';

// Constants
export { TAB_LABELS, TAB_DESCRIPTIONS, DEFAULT_TAB_CONFIG, PRIMARY_INTEGRATION_TABS } from './core/constants';

// Shared components
export { TabTile } from './shared/components/TabTile';

// Utils
export { getVisibleTabs, reorderTabs, resetToDefaultConfig } from './utils/tab-helpers';
