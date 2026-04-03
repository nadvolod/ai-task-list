'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import MoneyTaskCard from '@/components/MoneyTaskCard';
import BottomNav from '@/components/BottomNav';
import type { Task } from '@/types/task';

type Segment = 'active' | 'done-today' | 'all';

/** Effective dollar amount for a task (monetaryValue takes precedence) */
function dollarAmount(t: Task): number {
  return t.monetaryValue ?? t.revenuePotential ?? 0;
}

function nextStatus(current: Task['status']): Task['status'] {
  if (current === 'todo') return 'doing';
  if (current === 'doing') return 'done';
  if (current === 'waiting') return 'doing';
  return 'done';
}

export default function MoneyDashboardClient() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [segment, setSegment] = useState<Segment>('active');
  const [loading, setLoading] = useState(true);
  const [hasManualOrder, setHasManualOrder] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/money');
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      setTasks(data.tasks);
      setHasManualOrder(data.tasks.some((t: Task) => t.manualOrder != null));
    } catch (err) {
      console.error('Failed to fetch money data', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Compute stats client-side using the user's local timezone
  const stats = useMemo(() => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const completedToday = tasks.filter(
      t => t.status === 'done' && t.completedAt && new Date(t.completedAt) >= startOfToday,
    );

    return {
      movedToday: completedToday.reduce((sum, t) => sum + dollarAmount(t), 0),
      dealsClosedToday: completedToday.length,
      stillInPlay: tasks.filter(t => t.status !== 'done').reduce((sum, t) => sum + dollarAmount(t), 0),
    };
  }, [tasks]);

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const filteredTasks = tasks.filter(t => {
    if (segment === 'active') return t.status !== 'done';
    if (segment === 'done-today') {
      return t.status === 'done' && t.completedAt && new Date(t.completedAt) >= startOfToday;
    }
    return true; // 'all'
  });

  // Sort: manual order first (if any), then by dollar amount desc
  const sortedTasks = [...filteredTasks].sort((a, b) => {
    if (a.manualOrder != null && b.manualOrder != null) {
      return a.manualOrder - b.manualOrder;
    }
    if (a.manualOrder != null) return -1;
    if (b.manualOrder != null) return 1;
    return dollarAmount(b) - dollarAmount(a);
  });

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = sortedTasks.findIndex(t => t.id === active.id);
    const newIndex = sortedTasks.findIndex(t => t.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(sortedTasks, oldIndex, newIndex);
    const reorderedIds = new Set(reordered.map(t => t.id));

    // Build global order: splice reordered segment into existing order
    const globalOrder = tasks
      .sort((a, b) => (a.manualOrder ?? Infinity) - (b.manualOrder ?? Infinity));
    let reorderedIdx = 0;
    const fullOrdered = globalOrder.map(t => {
      if (!reorderedIds.has(t.id)) return t;
      return reordered[reorderedIdx++];
    });

    // Assign sequential manualOrder to all tasks
    const updatedTasks = fullOrdered.map((t, idx) => ({ ...t, manualOrder: idx }));
    setTasks(updatedTasks);
    setHasManualOrder(true);

    // Persist — use allSettled to handle partial failures
    const results = await Promise.allSettled(
      updatedTasks.map((t, idx) =>
        fetch(`/api/tasks/${t.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ manualOrder: idx }),
        }),
      ),
    );

    if (results.some(r => r.status === 'rejected')) {
      console.error('Some reorder updates failed, refetching');
      fetchData();
    }
  }

  async function handleCycleStatus(task: Task) {
    const newStatus = nextStatus(task.status);
    const previousTask = { ...task };

    // Optimistic update
    setTasks(prev =>
      prev.map(t =>
        t.id === task.id
          ? {
              ...t,
              status: newStatus,
              completedAt: newStatus === 'done' ? new Date().toISOString() : t.status === 'done' ? null : t.completedAt,
            }
          : t,
      ),
    );

    try {
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });

      if (!res.ok) throw new Error('Failed to update status');
      // Refetch to sync server state
      fetchData();
    } catch {
      // Revert optimistic update
      setTasks(prev =>
        prev.map(t =>
          t.id === task.id ? { ...t, status: previousTask.status, completedAt: previousTask.completedAt } : t,
        ),
      );
    }
  }

  async function handleResetOrder() {
    setHasManualOrder(false);
    const updatedTasks = tasks.map(t => ({ ...t, manualOrder: null }));
    setTasks(updatedTasks);

    await Promise.allSettled(
      tasks
        .filter(t => t.manualOrder != null)
        .map(t =>
          fetch(`/api/tasks/${t.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ manualOrder: null }),
          }),
        ),
    );
  }

  const segments: { key: Segment; label: string }[] = [
    { key: 'active', label: 'Active' },
    { key: 'done-today', label: 'Done Today' },
    { key: 'all', label: 'All' },
  ];

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      <div className="max-w-lg mx-auto px-4 pt-6 space-y-4">
        {/* Header */}
        <h1 className="text-lg font-bold text-gray-900">Money Dashboard</h1>

        {/* Hero Summary Card */}
        <div className="rounded-2xl bg-gradient-to-br from-green-500 to-emerald-600 p-5 text-white shadow-lg">
          <p className="text-sm font-medium text-green-100">How much $ did I move today?</p>
          <p className="text-3xl font-bold mt-1">
            {loading ? '...' : `$${stats.movedToday.toLocaleString()}`}
          </p>
          <div className="flex items-center gap-4 mt-3 text-sm text-green-100">
            <span>{stats.dealsClosedToday} deal{stats.dealsClosedToday !== 1 ? 's' : ''} closed</span>
            <span className="text-green-300">|</span>
            <span>${stats.stillInPlay.toLocaleString()} in play</span>
          </div>
        </div>

        {/* Segmented Control */}
        <div className="flex bg-gray-100 rounded-lg p-1">
          {segments.map(s => (
            <button
              key={s.key}
              onClick={() => setSegment(s.key)}
              className={`flex-1 text-sm font-medium py-2 rounded-md transition-colors ${
                segment === s.key
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>

        {/* Reset order button */}
        {hasManualOrder && (
          <div className="flex justify-end">
            <button
              onClick={handleResetOrder}
              className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
            >
              Reset order
            </button>
          </div>
        )}

        {/* Task List */}
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-20 bg-white rounded-xl border border-gray-100 animate-pulse" />
            ))}
          </div>
        ) : sortedTasks.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-400 text-sm">
              {segment === 'done-today'
                ? 'No money tasks completed today yet.'
                : segment === 'active'
                  ? 'No active money tasks. Nice work!'
                  : 'No tasks with monetary value.'}
            </p>
            <p className="text-gray-300 text-xs mt-1">
              Add $ amounts to your tasks to track revenue.
            </p>
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={sortedTasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-2">
                {sortedTasks.map(t => (
                  <MoneyTaskCard key={t.id} task={t} onCycleStatus={handleCycleStatus} />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </div>

      <BottomNav />
    </div>
  );
}
