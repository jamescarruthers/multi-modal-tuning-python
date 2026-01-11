/**
 * Tab Switcher Component
 *
 * Provides tab navigation between different modes of the application.
 */

export type AppMode = 'optimizer' | 'rangeFinder' | 'tuner';

interface TabSwitcherProps {
  activeTab: AppMode;
  onTabChange: (tab: AppMode) => void;
  disabled?: boolean;
}

export function TabSwitcher({ activeTab, onTabChange, disabled = false }: TabSwitcherProps) {
  return (
    <div className="tab-switcher">
      <button
        className={`tab-btn ${activeTab === 'optimizer' ? 'active' : ''}`}
        onClick={() => onTabChange('optimizer')}
        disabled={disabled}
      >
        Bar Optimizer
      </button>
      <button
        className={`tab-btn ${activeTab === 'rangeFinder' ? 'active' : ''}`}
        onClick={() => onTabChange('rangeFinder')}
        disabled={disabled}
      >
        Bar Length Finder
      </button>
      <button
        className={`tab-btn ${activeTab === 'tuner' ? 'active' : ''}`}
        onClick={() => onTabChange('tuner')}
        disabled={disabled}
      >
        Tuner
      </button>
    </div>
  );
}
