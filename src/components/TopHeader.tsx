import type { NavSection } from '../lib/types';

interface TopHeaderProps {
  activeSection: NavSection;
  onSelectSection: (section: NavSection) => void;
  onSyncFeed: () => void;
  isSyncing: boolean;
}

const NAV_ITEMS: { id: NavSection; label: string }[] = [
  { id: 'overview', label: 'Market Terminal' },
  { id: 'arbitrage', label: 'Dubai vs. India' },
  { id: 'model', label: 'Model & Macro' },
  { id: 'alerts', label: 'Alerts & GitHub' },
];

export function TopHeader({
  activeSection,
  onSelectSection,
  onSyncFeed,
  isSyncing,
}: TopHeaderProps) {
  return (
    <header className="border-b border-white/[0.08] bg-[#090c10]/95 backdrop-blur-md md:sticky md:top-0 z-30">
      <div className="max-w-[1380px] mx-auto px-4 sm:px-6 h-14 sm:h-16 flex items-center justify-between gap-4 sm:gap-8">
        <a
          href="#overview"
          onClick={(e) => {
            e.preventDefault();
            onSelectSection('overview');
          }}
          className="font-display text-lg font-bold tracking-tight text-[#f1f4f8] whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-[#e5b842] rounded"
        >
          Aureus Bullion
        </a>

        <nav aria-label="Primary navigation" className="hidden md:flex items-center gap-7">
          {NAV_ITEMS.map((item) => {
            const active = activeSection === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectSection(item.id)}
                className={`text-sm font-medium whitespace-nowrap shrink-0 pb-1 border-b-2 transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-[#e5b842] ${
                  active
                    ? 'text-[#f3d06b] border-[#e5b842]'
                    : 'text-[#94a3b8] border-transparent hover:text-[#f1f4f8]'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={onSyncFeed}
            disabled={isSyncing}
            className="px-4 py-2 text-xs font-semibold rounded-lg bg-[#e5b842] text-[#090c10] hover:bg-[#f3d06b] disabled:opacity-60 transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f3d06b]"
          >
            {isSyncing ? 'Syncing...' : 'Sync Live Feed'}
          </button>
        </div>
      </div>

      {/* Mobile compact navigation row */}
      <nav
        aria-label="Mobile section navigation"
        className="flex md:hidden items-center justify-between gap-2 px-4 pb-2 border-t border-white/[0.04]"
      >
        {NAV_ITEMS.map((item) => {
          const active = activeSection === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectSection(item.id)}
              className={`text-[11px] font-medium whitespace-nowrap shrink-0 py-1.5 border-b-2 transition-colors ${
                active
                  ? 'text-[#f3d06b] border-[#e5b842]'
                  : 'text-[#94a3b8] border-transparent'
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </nav>
    </header>
  );
}
