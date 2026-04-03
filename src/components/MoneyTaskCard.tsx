'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import Link from 'next/link';
import type { Task } from '@/types/task';
import StatusIcon from '@/components/ui/StatusIcon';
import Badge from '@/components/ui/Badge';

function revenueTypeLabel(type: string | null): string | null {
  if (type === 'mrr') return 'MRR';
  if (type === 'arr') return 'ARR';
  if (type === 'onetime') return 'One-time';
  return null;
}

function revenueTypeBadgeVariant(type: string | null): 'purple' | 'blue' | 'muted' {
  if (type === 'mrr') return 'purple';
  if (type === 'arr') return 'blue';
  return 'muted';
}

interface MoneyTaskCardProps {
  task: Task;
  onCycleStatus: (task: Task) => void;
}

export default function MoneyTaskCard({ task, onCycleStatus }: MoneyTaskCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
    zIndex: isDragging ? 50 : undefined,
  };

  const dollarAmount = task.monetaryValue ?? task.revenuePotential ?? 0;
  const typeLabel = revenueTypeLabel(task.revenueType);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`bg-white rounded-xl border border-gray-100 shadow-sm transition-opacity ${task.status === 'done' ? 'opacity-60' : ''}`}
    >
      <div className="flex items-center gap-3 p-4">
        {/* Drag handle */}
        <button
          {...attributes}
          {...listeners}
          className="flex-shrink-0 touch-none text-gray-300 hover:text-gray-500 cursor-grab active:cursor-grabbing"
          aria-label="Drag to reorder"
        >
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
            <circle cx="9" cy="6" r="1.5" />
            <circle cx="15" cy="6" r="1.5" />
            <circle cx="9" cy="12" r="1.5" />
            <circle cx="15" cy="12" r="1.5" />
            <circle cx="9" cy="18" r="1.5" />
            <circle cx="15" cy="18" r="1.5" />
          </svg>
        </button>

        {/* Status icon */}
        <button
          onClick={() => onCycleStatus(task)}
          className="flex-shrink-0 transition-colors hover:opacity-80"
          aria-label={`Cycle status of "${task.title}"`}
        >
          <StatusIcon status={task.status} />
        </button>

        {/* Content */}
        <Link href={`/tasks/${task.id}`} className="flex-1 min-w-0">
          <p className={`text-sm font-medium leading-snug truncate ${task.status === 'done' ? 'line-through text-gray-400' : 'text-gray-900'}`}>
            {task.shortCode && (
              <span className="text-xs font-mono font-semibold text-indigo-500 mr-1.5">{task.shortCode}</span>
            )}
            {task.title}
          </p>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-lg font-bold text-green-600">
              ${dollarAmount.toLocaleString()}
            </span>
            {typeLabel && (
              <Badge variant={revenueTypeBadgeVariant(task.revenueType)}>
                {typeLabel}
              </Badge>
            )}
            {task.revenuePotential != null && task.revenuePotential > 0 && task.monetaryValue != null && task.monetaryValue > 0 && (
              <span className="text-xs text-blue-500 font-medium">
                +${task.revenuePotential.toLocaleString()}
              </span>
            )}
          </div>
        </Link>

        {/* Edit link */}
        <Link
          href={`/tasks/${task.id}`}
          className="flex-shrink-0 p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
          aria-label={`Edit task: ${task.title}`}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </Link>
      </div>
    </div>
  );
}
