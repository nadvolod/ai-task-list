'use client';

export type FilterType = 'all' | 'today' | 'overdue' | 'high' | 'doing' | 'recurring' | 'done';

interface SearchFilterBarProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  activeFilter: FilterType;
  onFilterChange: (filter: FilterType) => void;
  counts: { today: number; overdue: number; high: number; recurring?: number; doing?: number };
}

const filters: { key: FilterType; label: string; countKey?: 'today' | 'overdue' | 'high' | 'doing' | 'recurring' }[] = [
  { key: 'all', label: 'All' },
  { key: 'today', label: 'Due Today', countKey: 'today' },
  { key: 'overdue', label: 'Overdue', countKey: 'overdue' },
  { key: 'high', label: 'High Priority', countKey: 'high' },
  { key: 'doing', label: 'In Progress', countKey: 'doing' },
  { key: 'recurring', label: 'Recurring', countKey: 'recurring' },
  { key: 'done', label: 'Done' },
];

export default function SearchFilterBar({
  searchQuery, onSearchChange, activeFilter, onFilterChange, counts,
}: SearchFilterBarProps) {
  return (
    <div className="space-y-2">
      {/* Search input */}
      <div className="relative">
        <label htmlFor="search-tasks" className="sr-only">Search tasks</label>
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          id="search-tasks"
          type="text"
          value={searchQuery}
          onChange={e => onSearchChange(e.target.value)}
          placeholder="Search tasks..."
          className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
        />
        {searchQuery && (
          <button
            onClick={() => onSearchChange('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-1"
            aria-label="Clear search"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Filter chips */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-hide" role="tablist" aria-label="Filter tasks">
        {filters.map(f => {
          const count = f.countKey ? counts[f.countKey] : 0;
          const isActive = activeFilter === f.key;
          return (
            <button
              key={f.key}
              onClick={() => onFilterChange(f.key)}
              role="tab"
              aria-selected={isActive}
              className={`flex-shrink-0 text-xs font-medium px-3 py-1.5 rounded-full transition-colors ${
                isActive
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {f.label}
              {f.countKey && (count ?? 0) > 0 && (
                <span className={`ml-1 ${isActive ? 'text-blue-200' : 'text-gray-400'}`}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
