'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import VoiceCaptureFAB from '@/components/VoiceCaptureFAB';
import FocusPanel from '@/components/FocusPanel';
import SearchFilterBar, { type FilterType } from '@/components/SearchFilterBar';
import BottomNav from '@/components/BottomNav';
import TaskCard from '@/components/TaskCard';
import EmptyState from '@/components/EmptyState';
import { useToast } from '@/components/ui/ToastProvider';
import { useDebounce } from '@/hooks/useDebounce';
import type { Task } from '@/types/task';

export default function TaskListClient({ initialTasks }: { initialTasks: Task[] }) {
  const [tasks, setTasks] = useState(initialTasks);
  const [loading, setLoading] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<FilterType>('all');
  const [expandedParents, setExpandedParents] = useState<Set<number>>(new Set());
  const [quickAddTitle, setQuickAddTitle] = useState('');
  const [quickAddLoading, setQuickAddLoading] = useState(false);
  const [focusRefreshKey, setFocusRefreshKey] = useState(0);
  const [recentlyDone, setRecentlyDone] = useState<Set<number>>(new Set());
  const { showToast } = useToast();
  const debouncedSearch = useDebounce(searchQuery, 200);

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

  async function cycleStatus(task: Task) {
    const newStatus = nextStatus(task.status);
    const prevTasks = tasks;
    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: newStatus } : t));

    if (newStatus === 'done') {
      setRecentlyDone(prev => new Set(prev).add(task.id));
      setTimeout(() => setRecentlyDone(prev => {
        const next = new Set(prev);
        next.delete(task.id);
        return next;
      }), 600);
    }

    const res = await fetch(`/api/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    });
    if (!res.ok) {
      setTasks(prevTasks);
      showToast('Could not update task status', { type: 'error' });
    } else {
      const data = await res.json();
      if (data.nextInstance) {
        setTasks(prev => [data.nextInstance, ...prev]);
      }
      if (data.parentAutoCompleted && task.parentId) {
        setTasks(prev => prev.map(t => t.id === task.parentId ? { ...t, status: 'done' } : t));
      }
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
    setLoading(id);
    const deletedTask = tasks.find(t => t.id === id);
    const deletedChildren = tasks.filter(t => t.parentId === id);
    // Optimistic removal
    setTasks(prev => prev.filter(t => t.id !== id && t.parentId !== id));

    const res = await fetch(`/api/tasks/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      // Revert
      setTasks(prev => [...prev, ...(deletedTask ? [deletedTask] : []), ...deletedChildren]);
      showToast('Failed to delete task', { type: 'error' });
    } else {
      showToast('Task deleted', {
        action: {
          label: 'Undo',
          onClick: async () => {
            if (!deletedTask) return;
            const restoreRes = await fetch('/api/tasks', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                title: deletedTask.title,
                description: deletedTask.description,
                dueDate: deletedTask.dueDate,
                monetaryValue: deletedTask.monetaryValue,
                revenuePotential: deletedTask.revenuePotential,
                urgency: deletedTask.urgency,
                strategicValue: deletedTask.strategicValue,
                category: deletedTask.category,
                assignee: deletedTask.assignee,
                parentId: deletedTask.parentId,
              }),
            });
            if (restoreRes.ok) {
              const restored = await restoreRes.json();
              setTasks(prev => [restored, ...prev]);
              showToast('Task restored', { type: 'success' });
            }
          },
        },
      });
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
    } else {
      showToast('Failed to create task', { type: 'error' });
    }
    setQuickAddLoading(false);
  }

  async function handleSubtaskAdd(parentId: number, title: string) {
    const res = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, parentId }),
    });

    if (res.ok) {
      const newTask = await res.json();
      setTasks(prev => [...prev, newTask]);
    } else {
      showToast('Failed to add subtask', { type: 'error' });
    }
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

  const todayCount = topLevelTasks.filter(t => t.status !== 'done' && isDueToday(t.dueDate)).length;
  const overdueCount = topLevelTasks.filter(t => t.status !== 'done' && isOverdue(t.dueDate)).length;
  const highCount = topLevelTasks.filter(t => t.status !== 'done' && t.priorityScore >= 60).length;
  const recurringCount = topLevelTasks.filter(t => t.status !== 'done' && t.recurrenceRule != null).length;
  const doingCount = topLevelTasks.filter(t => t.status === 'doing').length;

  let filtered = topLevelTasks;

  if (activeFilter === 'today') filtered = filtered.filter(t => t.status !== 'done' && isDueToday(t.dueDate));
  else if (activeFilter === 'overdue') filtered = filtered.filter(t => t.status !== 'done' && isOverdue(t.dueDate));
  else if (activeFilter === 'high') filtered = filtered.filter(t => t.status !== 'done' && t.priorityScore >= 60);
  else if (activeFilter === 'recurring') filtered = filtered.filter(t => t.status !== 'done' && t.recurrenceRule != null);
  else if (activeFilter === 'doing') filtered = filtered.filter(t => t.status === 'doing');
  else if (activeFilter === 'done') filtered = filtered.filter(t => t.status === 'done');

  if (debouncedSearch.trim()) {
    const q = debouncedSearch.toLowerCase();
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

        {/* Always-visible quick-add */}
        <form onSubmit={handleQuickAdd} className="flex gap-2">
          <input
            type="text"
            value={quickAddTitle}
            onChange={e => setQuickAddTitle(e.target.value)}
            placeholder="What needs to happen?"
            className="flex-1 border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          />
          <button
            type="submit"
            disabled={quickAddLoading || !quickAddTitle.trim()}
            className="bg-blue-600 text-white px-4 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {quickAddLoading ? (
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : '+'}
          </button>
          <Link
            href="/upload"
            className="bg-gray-100 text-gray-600 rounded-lg px-3 flex items-center hover:bg-gray-200 transition-colors"
            title="Import from image"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </Link>
          <Link
            href="/tasks/new"
            className="bg-gray-100 text-gray-600 rounded-lg px-3 flex items-center hover:bg-gray-200 transition-colors"
            title="Add with details"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
          </Link>
        </form>

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
          <EmptyState
            variant={
              debouncedSearch || activeFilter !== 'all'
                ? 'no-results'
                : 'no-tasks'
            }
          />
        )}

        {inProgress.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-amber-600 uppercase tracking-wide mb-2">In Progress</p>
            <div className="space-y-2">
              {inProgress.map(task => (
                <TaskCard
                  key={task.id}
                  task={task}
                  children={childrenMap[task.id] ?? []}
                  isExpanded={expandedParents.has(task.id)}
                  onToggleExpand={() => toggleExpand(task.id)}
                  onCycleStatus={cycleStatus}
                  onDelete={deleteTask}
                  onAddSubtask={handleSubtaskAdd}
                  isDeleting={loading === task.id}
                  animatedDone={recentlyDone.has(task.id)}
                />
              ))}
            </div>
          </div>
        )}

        {pending.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">To Do</p>
            <div className="space-y-2">
              {pending.map(task => (
                <TaskCard
                  key={task.id}
                  task={task}
                  children={childrenMap[task.id] ?? []}
                  isExpanded={expandedParents.has(task.id)}
                  onToggleExpand={() => toggleExpand(task.id)}
                  onCycleStatus={cycleStatus}
                  onDelete={deleteTask}
                  onAddSubtask={handleSubtaskAdd}
                  isDeleting={loading === task.id}
                  animatedDone={recentlyDone.has(task.id)}
                />
              ))}
            </div>
          </div>
        )}

        {done.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Completed</p>
            <div className="space-y-2">
              {done.map(task => (
                <TaskCard
                  key={task.id}
                  task={task}
                  children={childrenMap[task.id] ?? []}
                  isExpanded={expandedParents.has(task.id)}
                  onToggleExpand={() => toggleExpand(task.id)}
                  onCycleStatus={cycleStatus}
                  onDelete={deleteTask}
                  onAddSubtask={handleSubtaskAdd}
                  isDeleting={loading === task.id}
                  animatedDone={recentlyDone.has(task.id)}
                />
              ))}
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
