'use client';

import { useState, useEffect } from 'react';

interface FocusTask {
  id: number;
  title: string;
  priorityScore: number;
  priorityReason: string | null;
  monetaryValue: number | null;
  revenuePotential: number | null;
  dueDate: string | null;
  recurrenceRule: string | null;
  subtaskProgress: string | null;
}

interface FocusPanelProps {
  onToggleDone: (taskId: number) => void;
  refreshKey?: number;
}

export default function FocusPanel({ onToggleDone, refreshKey = 0 }: FocusPanelProps) {
  const [focusTasks, setFocusTasks] = useState<FocusTask[]>([]);
  const [summary, setSummary] = useState('');
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/focus')
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (!cancelled && data) {
          setFocusTasks(data.tasks);
          setSummary(data.summary);
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [refreshKey]);

  const greeting = (() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  })();

  if (loading) {
    return (
      <div className="bg-gradient-to-br from-blue-600 to-blue-700 rounded-2xl p-5 text-white">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
          <span className="text-sm opacity-80">Loading your briefing...</span>
        </div>
      </div>
    );
  }

  if (focusTasks.length === 0) return null;

  return (
    <div className="bg-gradient-to-br from-blue-600 to-blue-700 rounded-2xl p-5 text-white shadow-sm">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between"
      >
        <h2 className="text-sm font-semibold opacity-80">{greeting}</h2>
        <svg
          className={`w-4 h-4 opacity-60 transition-transform ${collapsed ? '' : 'rotate-180'}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {!collapsed && (
        <>
          <p className="text-sm font-medium mt-2 leading-relaxed">{summary}</p>

          <div className="mt-4 space-y-2">
            {focusTasks.map((task, i) => (
              <div key={task.id} className="flex items-start gap-3 bg-white/10 rounded-xl px-3 py-2.5">
                <button
                  onClick={(e) => { e.stopPropagation(); onToggleDone(task.id); }}
                  className="mt-0.5 w-5 h-5 rounded-full border-2 border-white/50 flex-shrink-0 hover:border-white transition-colors"
                  aria-label={`Complete "${task.title}"`}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium leading-snug">
                    <span className="opacity-50 mr-1.5">{i + 1}.</span>
                    {task.title}
                  </p>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    {task.dueDate && (() => {
                      const diffDays = Math.round((new Date(task.dueDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
                      if (diffDays < 0) return <span className="text-xs bg-red-500/30 px-1.5 py-0.5 rounded-full">Overdue</span>;
                      if (diffDays === 0) return <span className="text-xs bg-orange-400/30 px-1.5 py-0.5 rounded-full">Due today</span>;
                      if (diffDays <= 3) return <span className="text-xs bg-white/20 px-1.5 py-0.5 rounded-full">Due in {diffDays}d</span>;
                      return null;
                    })()}
                    {task.subtaskProgress && (
                      <span className="text-xs bg-white/20 px-1.5 py-0.5 rounded-full">{task.subtaskProgress}</span>
                    )}
                    {task.recurrenceRule && (
                      <span className="text-xs bg-purple-400/30 px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
                        <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                        Recurring
                      </span>
                    )}
                    {(task.monetaryValue ?? 0) > 0 && (
                      <span className="text-xs opacity-70">${task.monetaryValue!.toLocaleString()}</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
