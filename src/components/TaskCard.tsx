'use client';

import { useState, useRef } from 'react';
import Link from 'next/link';
import type { Task } from '@/types/task';
import { formatRecurrenceLabel } from '@/lib/recurrence';
import StatusIcon from '@/components/ui/StatusIcon';
import Badge from '@/components/ui/Badge';
import { useSwipe } from '@/hooks/useSwipe';

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

function priorityVariant(score: number): 'danger' | 'warning' | 'muted' {
  if (score >= 60) return 'danger';
  if (score >= 30) return 'warning';
  return 'muted';
}

interface TaskCardProps {
  task: Task;
  children: Task[];
  isExpanded: boolean;
  onToggleExpand: () => void;
  onCycleStatus: (task: Task) => void;
  onDelete: (id: number) => void;
  onAddSubtask: (parentId: number, title: string) => Promise<void>;
  isDeleting?: boolean;
  animatedDone?: boolean;
}

export default function TaskCard({
  task,
  children: subtasks,
  isExpanded,
  onToggleExpand,
  onCycleStatus,
  onDelete,
  onAddSubtask,
  isDeleting = false,
  animatedDone = false,
}: TaskCardProps) {
  const [subtaskAddTitle, setSubtaskAddTitle] = useState('');
  const [subtaskAddLoading, setSubtaskAddLoading] = useState(false);
  const [showingAdd, setShowingAdd] = useState(false);
  const [badgesExpanded, setBadgesExpanded] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel } = useSwipe(
    cardRef,
    {
      onSwipeRight: () => onCycleStatus(task),
      onSwipeLeft: () => onDelete(task.id),
    },
  );

  const hasChildren = subtasks.length > 0;
  const childDone = subtasks.filter(c => c.status === 'done').length;

  async function handleSubtaskAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!subtaskAddTitle.trim()) return;
    setSubtaskAddLoading(true);
    await onAddSubtask(task.id, subtaskAddTitle.trim());
    setSubtaskAddTitle('');
    setShowingAdd(false);
    setSubtaskAddLoading(false);
  }

  const now = new Date();

  function dueDateBadge(dueDate: string | null) {
    if (!dueDate) return null;
    const due = new Date(dueDate);
    const diffDays = Math.round((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays < 0) return <Badge variant="danger">Overdue</Badge>;
    if (diffDays === 0) return <Badge variant="warning">Due today</Badge>;
    if (diffDays === 1) return <Badge variant="warning">Tomorrow</Badge>;
    if (diffDays <= 7) {
      const dayName = due.toLocaleDateString('en-US', { weekday: 'short' });
      return <Badge variant="muted">Due {dayName}</Badge>;
    }
    return <Badge variant="muted" bold={false}>{due.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</Badge>;
  }

  // Build badges array for progressive disclosure
  const badges: React.ReactNode[] = [];

  badges.push(
    <Badge key="score" variant={priorityVariant(task.priorityScore)}>
      Score: {Math.round(task.priorityScore)}
    </Badge>
  );

  if (task.status === 'doing') {
    badges.push(<Badge key="doing" variant="amber">In Progress</Badge>);
  }

  if (hasChildren) {
    badges.push(<Badge key="subtasks" variant="indigo">{childDone}/{subtasks.length}</Badge>);
  }

  if (task.monetaryValue != null && task.monetaryValue > 0) {
    badges.push(<Badge key="money" variant="success">${task.monetaryValue.toLocaleString()}</Badge>);
  }

  if (task.revenuePotential != null && task.revenuePotential > 0) {
    badges.push(<Badge key="revenue" variant="blue">+${task.revenuePotential.toLocaleString()} potential</Badge>);
  }

  const dueBadge = dueDateBadge(task.dueDate);
  if (dueBadge) badges.push(<span key="due">{dueBadge}</span>);

  if (task.recurrenceRule) {
    badges.push(
      <Badge key="recurrence" variant="purple" icon={
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
      }>
        {formatRecurrenceLabel(task.recurrenceRule, task.recurrenceDays)}
      </Badge>
    );
  }

  if (task.category) {
    badges.push(<Badge key="category" variant="cyan">{task.category}</Badge>);
  }

  if (task.assignee) {
    badges.push(<Badge key="assignee" variant="teal">{task.assignee}</Badge>);
  }

  if (task.manualPriorityScore != null) {
    badges.push(<Badge key="pinned" variant="amber">Pinned</Badge>);
  }

  if (task.confidence != null && task.confidence < 0.7) {
    badges.push(<Badge key="confidence" variant="yellow" bold={false}>low confidence</Badge>);
  }

  const MAX_VISIBLE_BADGES = 3;
  const visibleBadges = badgesExpanded ? badges : badges.slice(0, MAX_VISIBLE_BADGES);
  const hiddenCount = badges.length - MAX_VISIBLE_BADGES;

  return (
    <div
      ref={cardRef}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchCancel}
      className={`bg-white rounded-xl border border-gray-100 shadow-sm transition-opacity duration-200 ${task.status === 'done' ? 'opacity-60' : ''}`}
    >
      <div className="p-4 space-y-2">
        <div className="flex items-start gap-3">
          {/* Chevron + Checkbox */}
          <div className="flex items-start gap-1">
            {task.parentId === null && (
              <button
                type="button"
                onClick={onToggleExpand}
                aria-expanded={isExpanded}
                aria-label={isExpanded ? 'Collapse subtasks' : 'Expand subtasks'}
                className="mt-0.5 min-w-[44px] min-h-[44px] -m-3 flex-shrink-0 flex items-center justify-center text-gray-400 hover:text-gray-600 transition-colors"
              >
                <svg className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </button>
            )}
            <button
              type="button"
              onClick={() => onCycleStatus(task)}
              aria-label={`Mark "${task.title}" as ${statusLabel(nextStatus(task.status))}`}
              className="mt-0.5 min-w-[44px] min-h-[44px] -m-3 flex-shrink-0 flex items-center justify-center transition-colors hover:opacity-80"
            >
              <StatusIcon status={task.status} animated={animatedDone} />
            </button>
          </div>

          {/* Task content */}
          <div className="flex-1 min-w-0">
            <p className={`text-sm font-medium leading-snug ${task.status === 'done' ? 'line-through text-gray-400' : 'text-gray-900'}`}>
              {task.title}
            </p>

            {/* Badges row */}
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              {visibleBadges}
              {!badgesExpanded && hiddenCount > 0 && (
                <button
                  onClick={() => setBadgesExpanded(true)}
                  className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full hover:bg-gray-200 transition-colors"
                >
                  +{hiddenCount}
                </button>
              )}
              {badgesExpanded && hiddenCount > 0 && (
                <button
                  onClick={() => setBadgesExpanded(false)}
                  className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full hover:bg-gray-200 transition-colors"
                >
                  Less
                </button>
              )}
            </div>

            {/* Priority reason */}
            {task.priorityReason && (
              <p className="text-xs text-gray-500 mt-1 leading-relaxed">{task.priorityReason}</p>
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
              onClick={() => onDelete(task.id)}
              disabled={isDeleting}
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

      {/* Subtasks (expanded) */}
      {isExpanded && (
        <div className="border-t border-gray-50 ml-6 mr-2 pb-2">
          {subtasks.map(sub => (
            <div
              key={sub.id}
              className={`flex items-start gap-3 py-2 px-3 ${sub.status === 'done' ? 'opacity-50' : ''}`}
            >
              <button
                onClick={() => onCycleStatus(sub)}
                aria-label={`Mark "${sub.title}" as ${statusLabel(nextStatus(sub.status))}`}
                className="mt-0.5 flex-shrink-0 transition-colors hover:opacity-80"
              >
                <StatusIcon status={sub.status} size="sm" />
              </button>
              <p className={`flex-1 text-xs leading-snug ${sub.status === 'done' ? 'line-through text-gray-400' : 'text-gray-700'}`}>
                {sub.title}
              </p>
              <button
                onClick={() => onDelete(sub.id)}
                className="p-1 rounded text-gray-300 hover:text-red-500 transition-colors"
                aria-label={`Delete subtask: ${sub.title}`}
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
          {/* Inline add subtask */}
          {showingAdd ? (
            <form onSubmit={handleSubtaskAdd} className="flex gap-2 px-3 py-2">
              <input
                type="text"
                value={subtaskAddTitle}
                onChange={e => setSubtaskAddTitle(e.target.value)}
                placeholder="Add a subtask..."
                aria-label="Add a subtask"
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
                onClick={() => { setShowingAdd(false); setSubtaskAddTitle(''); }}
                className="text-xs text-gray-400"
              >
                Cancel
              </button>
            </form>
          ) : (
            <button
              onClick={() => { setShowingAdd(true); setSubtaskAddTitle(''); }}
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
