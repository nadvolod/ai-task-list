'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import VoiceCaptureFAB from '@/components/VoiceCaptureFAB';
import FocusPanel from '@/components/FocusPanel';
import SearchFilterBar, { type FilterType } from '@/components/SearchFilterBar';
import BottomNav from '@/components/BottomNav';
import type { Task } from '@/types/task';
import { formatRecurrenceLabel } from '@/lib/recurrence';

export default function TaskListClient({ initialTasks }: { initialTasks: Task[] }) {
  const [tasks, setTasks] = useState(initialTasks);
  const [loading, setLoading] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<FilterType>('all');
  const [expandedParents, setExpandedParents] = useState<Set<number>>(new Set());

  // Inline quick-add state
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddTitle, setQuickAddTitle] = useState('');
  const [quickAddLoading, setQuickAddLoading] = useState(false);
  const [focusRefreshKey, setFocusRefreshKey] = useState(0);

  // Subtask inline add state
  const [subtaskAddParentId, setSubtaskAddParentId] = useState<number | null>(null);
  const [subtaskAddTitle, setSubtaskAddTitle] = useState('');
  const [subtaskAddLoading, setSubtaskAddLoading] = useState(false);

  // Build parent→children map
  const { topLevelTasks, childrenMap } = useMemo(() => {
    const children: Record<number, Task[]> = {};
    const topLevel: Task[] = [];
    for (const t of tasks) {
      if (t.parentId != null) {
        if (!children[t.parentId]) children[t.parentId] = [];
        children[t.parentId].push(t);
      } else {
        topLevel.push(t);
      }
    }
    // Sort subtasks by subtaskOrder
    for (const key of Object.keys(children)) {
      children[Number(key)].sort((a, b) => (a.subtaskOrder ?? 0) - (b.subtaskOrder ?? 0));
    }
    return { topLevelTasks: topLevel, childrenMap: children };
  }, [tasks]);

  function toggleExpand(parentId: number) {
    setExpandedParents(prev => {
      const next = new Set(prev);
      if (next.has(parentId)) next.delete(parentId);
      else next.add(parentId);
      return next;
    });
  }

  function nextStatus(current: Task['status']): Task['status'] {
    if (current === 'todo') return 'doing';
    if (current === 'doing') return 'done';
    return 'todo';
  }

  function statusLabel(status: Task['status']): string {
    if (status === 'doing') return 'in progress';
    if (status === 'done') return 'done';
    return 'to do';
  }

  async function cycleStatus(task: Task) {
    const newStatus = nextStatus(task.status);
    const prevTasks = tasks;
    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: newStatus } : t));
    const res = await fetch(`/api/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    });
    if (!res.ok) {
      setTasks(prevTasks);
    } else {
      const data = await res.json();
      // Handle recurring task next instance
      if (data.nextInstance) {
        setTasks(prev => [data.nextInstance, ...prev]);
      }
      // Handle parent auto-completion cascade
      if (data.parentAutoCompleted && task.parentId) {
        setTasks(prev => prev.map(t => t.id === task.parentId ? { ...t, status: 'done' } : t));
      }
      // Handle parent completing all subtasks
      if (task.parentId === null && newStatus === 'done') {
        const children = childrenMap[task.id] ?? [];
        setTasks(prev => prev.map(t => children.some(c => c.id === t.id) ? { ...t, status: 'done' } : t));
      }
      setFocusRefreshKey(k => k + 1);
    }
  }

  function handleToggleDoneById(taskId: number) {
    const task = tasks.find(t => t.id === taskId);
    if (task) cycleStatus(task);
  }

  async function deleteTask(id: number) {
    if (!confirm('Delete this task?')) return;
    setLoading(id);
    const prevTasks = tasks;
    // Also remove children from state
    setTasks(prev => prev.filter(t => t.id !== id && t.parentId !== id));
    const res = await fetch(`/api/tasks/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      setTasks(prevTasks);
    }
    setLoading(null);
  }

  async function handleQuickAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!quickAddTitle.trim()) return;
    setQuickAddLoading(true);

    const res = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: quickAddTitle.trim() }),
    });

    if (res.ok) {
      const newTask = await res.json();
      setTasks(prev => [newTask, ...prev]);
      setQuickAddTitle('');
      setQuickAddOpen(false);
    }
    setQuickAddLoading(false);
  }

  async function handleSubtaskAdd(e: React.FormEvent, parentId: number) {
    e.preventDefault();
    if (!subtaskAddTitle.trim()) return;
    setSubtaskAddLoading(true);

    const res = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: subtaskAddTitle.trim(), parentId }),
    });

    if (res.ok) {
      const newTask = await res.json();
      setTasks(prev => [...prev, newTask]);
      setSubtaskAddTitle('');
      setSubtaskAddParentId(null);
    }
    setSubtaskAddLoading(false);
  }

  function handleVoiceTasksCreated(newTasks: Task[]) {
    setTasks(prev => [...newTasks, ...prev]);
  }

  function handleVoiceTaskUpdated(updated: Task) {
    setTasks(prev => prev.map(t => t.id === updated.id ? { ...updated, dueDate: updated.dueDate ?? null } : t));
  }

  function handleVoiceTaskDeleted(taskId: number) {
    setTasks(prev => prev.filter(t => t.id !== taskId));
  }

  function handleAllTasksDeleted() {
    setTasks([]);
  }

  async function handleRefreshRequested() {
    try {
      const res = await fetch('/api/tasks');
      if (res.ok) {
        const refreshed = await res.json();
        setTasks(refreshed);
      }
    } catch { /* silent */ }
  }

  // Filter and search logic
  const now = new Date();

  function isDueToday(d: string | null) {
    if (!d) return false;
    const due = new Date(d);
    return due.toDateString() === now.toDateString();
  }

  function isOverdue(d: string | null) {
    if (!d) return false;
    return new Date(d).getTime() < now.getTime() && !isDueToday(d);
  }

  // Counts based on top-level tasks only
  const todayCount = topLevelTasks.filter(t => t.status !== 'done' && isDueToday(t.dueDate)).length;
  const overdueCount = topLevelTasks.filter(t => t.status !== 'done' && isOverdue(t.dueDate)).length;
  const highCount = topLevelTasks.filter(t => t.status !== 'done' && t.priorityScore >= 60).length;
  const recurringCount = topLevelTasks.filter(t => t.status !== 'done' && t.recurrenceRule != null).length;
  const doingCount = topLevelTasks.filter(t => t.status === 'doing').length;

  let filtered = topLevelTasks;

  // Apply filter
  if (activeFilter === 'today') filtered = filtered.filter(t => t.status !== 'done' && isDueToday(t.dueDate));
  else if (activeFilter === 'overdue') filtered = filtered.filter(t => t.status !== 'done' && isOverdue(t.dueDate));
  else if (activeFilter === 'high') filtered = filtered.filter(t => t.status !== 'done' && t.priorityScore >= 60);
  else if (activeFilter === 'recurring') filtered = filtered.filter(t => t.status !== 'done' && t.recurrenceRule != null);
  else if (activeFilter === 'doing') filtered = filtered.filter(t => t.status === 'doing');
  else if (activeFilter === 'done') filtered = filtered.filter(t => t.status === 'done');

  // Apply search — also include parents whose subtasks match
  if (searchQuery.trim()) {
    const q = searchQuery.toLowerCase();
    filtered = filtered.filter(t => {
      const titleMatch = t.title.toLowerCase().includes(q) || (t.description && t.description.toLowerCase().includes(q));
      const childMatch = (childrenMap[t.id] ?? []).some(c =>
        c.title.toLowerCase().includes(q) || (c.description && c.description.toLowerCase().includes(q))
      );
      return titleMatch || childMatch;
    });
  }

  const inProgress = activeFilter === 'done' ? [] : filtered.filter(t => t.status === 'doing');
  const pending = activeFilter === 'done' ? [] : filtered.filter(t => t.status === 'todo');
  const done = activeFilter === 'done' ? filtered : (activeFilter === 'all' ? filtered.filter(t => t.status === 'done') : []);

  function priorityColor(score: number) {
    if (score >= 60) return 'text-red-600 bg-red-50';
    if (score >= 30) return 'text-orange-600 bg-orange-50';
    return 'text-gray-500 bg-gray-100';
  }

  function dueDateBadge(dueDate: string | null) {
    if (!dueDate) return null;
    const due = new Date(dueDate);
    const diffDays = Math.round((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays < 0) return <span className="text-xs text-red-700 bg-red-50 px-2 py-0.5 rounded-full font-medium">Overdue</span>;
    if (diffDays === 0) return <span className="text-xs text-orange-700 bg-orange-50 px-2 py-0.5 rounded-full font-medium">Due today</span>;
    if (diffDays === 1) return <span className="text-xs text-orange-600 bg-orange-50 px-2 py-0.5 rounded-full font-medium">Tomorrow</span>;
    if (diffDays <= 7) {
      const dayName = due.toLocaleDateString('en-US', { weekday: 'short' });
      return <span className="text-xs text-gray-600 bg-gray-100 px-2 py-0.5 rounded-full font-medium">Due {dayName}</span>;
    }
    return <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">{due.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>;
  }

  function statusIcon(status: Task['status'], size: 'sm' | 'md' = 'md') {
    const w = size === 'sm' ? 'w-4 h-4' : 'w-5 h-5';
    const iconW = size === 'sm' ? 'w-2.5 h-2.5' : 'w-3 h-3';
    if (status === 'done') {
      return (
        <div className={`${w} rounded-full bg-green-500 border-2 border-green-500 flex items-center justify-center`}>
          <svg className={`${iconW} text-white`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
      );
    }
    if (status === 'doing') {
      return (
        <div className={`${w} rounded-full bg-amber-500 border-2 border-amber-500 flex items-center justify-center`}>
          <svg className={`${iconW} text-white`} fill="currentColor" viewBox="0 0 24 24">
            <path d="M8 5v14l11-7z" />
          </svg>
        </div>
      );
    }
    return (
      <div className={`${w} rounded-full border-2 border-gray-300`} />
    );
  }

  function renderSubtask(task: Task) {
    return (
      <div
        key={task.id}
        className={`flex items-start gap-3 py-2 px-3 ${task.status === 'done' ? 'opacity-50' : ''}`}
      >
        <button
          onClick={() => cycleStatus(task)}
          aria-label={`Mark "${task.title}" as ${statusLabel(nextStatus(task.status))}`}
          className="mt-0.5 flex-shrink-0 transition-colors hover:opacity-80"
        >
          {statusIcon(task.status, 'sm')}
        </button>
        <p className={`flex-1 text-xs leading-snug ${task.status === 'done' ? 'line-through text-gray-400' : 'text-gray-700'}`}>
          {task.title}
        </p>
        <button
          onClick={() => deleteTask(task.id)}
          className="p-1 rounded text-gray-300 hover:text-red-500 transition-colors"
          aria-label={`Delete subtask: ${task.title}`}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    );
  }

  function renderTask(task: Task) {
    const children = childrenMap[task.id] ?? [];
    const hasChildren = children.length > 0;
    const isExpanded = expandedParents.has(task.id);
    const childDone = children.filter(c => c.status === 'done').length;

    return (
      <div key={task.id} className={`bg-white rounded-xl border border-gray-100 shadow-sm ${task.status === 'done' ? 'opacity-60' : ''}`}>
        <div className="p-4 space-y-2">
          <div className="flex items-start gap-3">
            {/* Chevron (if has children) + Checkbox (always) */}
            <div className="flex items-start gap-1">
              {task.parentId === null && (
                <button
                  type="button"
                  onClick={() => toggleExpand(task.id)}
                  aria-expanded={isExpanded}
                  aria-label={isExpanded ? 'Collapse subtasks' : 'Expand subtasks'}
                  className="mt-0.5 w-5 h-5 flex-shrink-0 flex items-center justify-center text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <svg className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              )}
              <button
                type="button"
                onClick={() => cycleStatus(task)}
                aria-label={`Mark "${task.title}" as ${statusLabel(nextStatus(task.status))}`}
                className="mt-0.5 flex-shrink-0 transition-colors hover:opacity-80"
              >
                {statusIcon(task.status)}
              </button>
            </div>

            {/* Task content */}
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-medium leading-snug ${task.status === 'done' ? 'line-through text-gray-400' : 'text-gray-900'}`}>
                {task.title}
              </p>

              {/* Badges row */}
              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${priorityColor(task.priorityScore)}`}>
                  Score: {Math.round(task.priorityScore)}
                </span>

                {/* In Progress badge */}
                {task.status === 'doing' && (
                  <span className="text-xs text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full font-medium">
                    In Progress
                  </span>
                )}

                {/* Subtask progress badge */}
                {hasChildren && (
                  <span className="text-xs text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-full font-medium">
                    {childDone}/{children.length}
                  </span>
                )}

                {task.monetaryValue != null && task.monetaryValue > 0 && (
                  <span className="text-xs text-green-700 bg-green-50 px-2 py-0.5 rounded-full font-medium">
                    ${task.monetaryValue.toLocaleString()}
                  </span>
                )}

                {task.revenuePotential != null && task.revenuePotential > 0 && (
                  <span className="text-xs text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full font-medium">
                    +${task.revenuePotential.toLocaleString()} potential
                  </span>
                )}

                {dueDateBadge(task.dueDate)}

                {/* Recurrence badge */}
                {task.recurrenceRule && (
                  <span className="text-xs text-purple-700 bg-purple-50 px-2 py-0.5 rounded-full font-medium flex items-center gap-1">
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    {formatRecurrenceLabel(task.recurrenceRule, task.recurrenceDays)}
                  </span>
                )}

                {/* Category badge */}
                {task.category && (
                  <span className="text-xs text-cyan-700 bg-cyan-50 px-2 py-0.5 rounded-full font-medium">
                    {task.category}
                  </span>
                )}

                {/* Assignee badge */}
                {task.assignee && (
                  <span className="text-xs text-teal-700 bg-teal-50 px-2 py-0.5 rounded-full font-medium">
                    {task.assignee}
                  </span>
                )}

                {/* Manual priority override indicator */}
                {task.manualPriorityScore != null && (
                  <span className="text-xs text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full font-medium">
                    Pinned
                  </span>
                )}

                {(task.confidence != null && task.confidence < 0.7) && (
                  <span className="text-xs text-yellow-700 bg-yellow-50 px-2 py-0.5 rounded-full">
                    low confidence
                  </span>
                )}
              </div>

              {/* Priority reason */}
              {task.priorityReason && (
                <p className="text-xs text-gray-400 mt-1 leading-relaxed">{task.priorityReason}</p>
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-1 flex-shrink-0">
              <Link
                href={`/tasks/${task.id}`}
                className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                aria-label={`Edit task: ${task.title}`}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </Link>
              <button
                onClick={() => deleteTask(task.id)}
                disabled={loading === task.id}
                className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-40"
                aria-label={`Delete task: ${task.title}`}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        {/* Subtasks (expanded) — also show for leaf tasks so they can add first subtask */}
        {isExpanded && (
          <div className="border-t border-gray-50 ml-6 mr-2 pb-2">
            {children.map(renderSubtask)}
            {/* Inline add subtask */}
            {subtaskAddParentId === task.id ? (
              <form onSubmit={e => handleSubtaskAdd(e, task.id)} className="flex gap-2 px-3 py-2">
                <input
                  type="text"
                  value={subtaskAddTitle}
                  onChange={e => setSubtaskAddTitle(e.target.value)}
                  placeholder="Add a subtask..."
                  autoFocus
                  className="flex-1 border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <button
                  type="submit"
                  disabled={subtaskAddLoading || !subtaskAddTitle.trim()}
                  className="text-xs text-blue-600 font-medium disabled:opacity-50"
                >
                  {subtaskAddLoading ? '...' : 'Add'}
                </button>
                <button
                  type="button"
                  onClick={() => { setSubtaskAddParentId(null); setSubtaskAddTitle(''); }}
                  className="text-xs text-gray-400"
                >
                  Cancel
                </button>
              </form>
            ) : (
              <button
                onClick={() => { setSubtaskAddParentId(task.id); setSubtaskAddTitle(''); }}
                className="text-xs text-gray-400 hover:text-blue-600 px-3 py-1.5 transition-colors"
              >
                + Add subtask
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 pb-24">
      {/* Header */}
      <header className="bg-white border-b border-gray-100 sticky top-0 z-10">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center justify-between">
          <h1 className="font-bold text-gray-900">My Tasks</h1>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-4 py-4 space-y-4">
        {/* Focus Panel */}
        <FocusPanel onToggleDone={handleToggleDoneById} refreshKey={focusRefreshKey} />

        {/* Inline quick-add */}
        {quickAddOpen ? (
          <form onSubmit={handleQuickAdd} className="flex gap-2">
            <input
              type="text"
              value={quickAddTitle}
              onChange={e => setQuickAddTitle(e.target.value)}
              placeholder="What needs to happen?"
              autoFocus
              className="flex-1 border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              type="submit"
              disabled={quickAddLoading || !quickAddTitle.trim()}
              className="bg-blue-600 text-white px-4 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {quickAddLoading ? '...' : 'Add'}
            </button>
            <button
              type="button"
              onClick={() => { setQuickAddOpen(false); setQuickAddTitle(''); }}
              className="text-gray-400 hover:text-gray-600 px-2"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </form>
        ) : (
          <div className="flex gap-2">
            <button
              onClick={() => setQuickAddOpen(true)}
              className="flex-1 bg-blue-600 text-white text-sm font-medium rounded-xl py-3 text-center hover:bg-blue-700 transition-colors"
            >
              + Add task
            </button>
            <Link
              href="/upload"
              className="bg-gray-100 text-gray-600 text-sm font-medium rounded-xl py-3 px-4 hover:bg-gray-200 transition-colors flex items-center"
              title="Import from image"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </Link>
            <Link
              href="/tasks/new"
              className="bg-gray-100 text-gray-600 text-sm font-medium rounded-xl py-3 px-4 hover:bg-gray-200 transition-colors flex items-center"
              title="Add with details"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
            </Link>
          </div>
        )}

        {/* Search and Filter */}
        <SearchFilterBar
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          activeFilter={activeFilter}
          onFilterChange={setActiveFilter}
          counts={{ today: todayCount, overdue: overdueCount, high: highCount, recurring: recurringCount, doing: doingCount }}
        />

        {/* Task list */}
        {inProgress.length === 0 && pending.length === 0 && done.length === 0 && (
          <div className="text-center py-16 text-gray-400">
            <p className="text-4xl mb-3">📋</p>
            <p className="text-sm">
              {searchQuery || activeFilter !== 'all' ? 'No tasks match your filter.' : 'No tasks yet.'}
            </p>
            <p className="text-xs mt-1">
              {searchQuery || activeFilter !== 'all' ? 'Try a different search or filter.' : 'Add a task or tap the mic to speak.'}
            </p>
          </div>
        )}

        {inProgress.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-amber-600 uppercase tracking-wide mb-2">In Progress</p>
            <div className="space-y-2">
              {inProgress.map(renderTask)}
            </div>
          </div>
        )}

        {pending.length > 0 && (
          <div className="space-y-2">
            {pending.map(renderTask)}
          </div>
        )}

        {done.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Completed</p>
            <div className="space-y-2">
              {done.map(renderTask)}
            </div>
          </div>
        )}
      </div>

      {/* Voice Command FAB */}
      <VoiceCaptureFAB
        onTasksCreated={handleVoiceTasksCreated}
        onTaskUpdated={handleVoiceTaskUpdated}
        onTaskDeleted={handleVoiceTaskDeleted}
        onAllTasksDeleted={handleAllTasksDeleted}
        onRefreshRequested={handleRefreshRequested}
      />

      {/* Bottom Navigation */}
      <BottomNav />
    </main>
  );
}
