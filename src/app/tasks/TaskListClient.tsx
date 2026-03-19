'use client';

import { useState } from 'react';
import { signOut } from 'next-auth/react';
import Link from 'next/link';

interface Task {
  id: number;
  title: string;
  description: string | null;
  status: string;
  priorityScore: number;
  priorityReason: string | null;
  monetaryValue: number | null;
  revenuePotential: number | null;
  urgency: number | null;
  strategicValue: number | null;
  confidence: number | null;
  sourceType: string;
}

export default function TaskListClient({ initialTasks }: { initialTasks: Task[] }) {
  const [tasks, setTasks] = useState(initialTasks);
  const [loading, setLoading] = useState<number | null>(null);

  async function toggleDone(task: Task) {
    const newStatus = task.status === 'done' ? 'todo' : 'done';
    const prevTasks = tasks;
    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: newStatus } : t));
    const res = await fetch(`/api/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    });
    if (!res.ok) {
      setTasks(prevTasks);
    }
  }

  async function deleteTask(id: number) {
    if (!confirm('Delete this task?')) return;
    setLoading(id);
    const prevTasks = tasks;
    setTasks(prev => prev.filter(t => t.id !== id));
    const res = await fetch(`/api/tasks/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      setTasks(prevTasks);
    }
    setLoading(null);
  }

  const pending = tasks.filter(t => t.status === 'todo');
  const done = tasks.filter(t => t.status === 'done');

  function priorityColor(score: number) {
    if (score >= 60) return 'text-red-600 bg-red-50';
    if (score >= 30) return 'text-orange-600 bg-orange-50';
    return 'text-gray-500 bg-gray-100';
  }

  function renderTask(task: Task) {
    return (
      <div
        key={task.id}
        className={`bg-white rounded-xl border border-gray-100 shadow-sm p-4 space-y-2 ${task.status === 'done' ? 'opacity-60' : ''}`}
      >
        <div className="flex items-start gap-3">
          {/* Checkbox */}
          <button
            onClick={() => toggleDone(task)}
            aria-label={`Mark "${task.title}" as ${task.status === 'done' ? 'not done' : 'done'}`}
            className={`mt-0.5 w-5 h-5 rounded-full border-2 flex-shrink-0 flex items-center justify-center transition-colors ${
              task.status === 'done'
                ? 'bg-green-500 border-green-500'
                : 'border-gray-300 hover:border-blue-400'
            }`}
          >
            {task.status === 'done' && (
              <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            )}
          </button>

          {/* Task content */}
          <div className="flex-1 min-w-0">
            <p className={`text-sm font-medium leading-snug ${task.status === 'done' ? 'line-through text-gray-400' : 'text-gray-900'}`}>
              {task.title}
            </p>

            {/* Priority badge and monetary */}
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${priorityColor(task.priorityScore)}`}>
                Score: {Math.round(task.priorityScore)}
              </span>

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
    );
  }

  return (
    <main className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-100 sticky top-0 z-10">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center justify-between">
          <h1 className="font-bold text-gray-900">My Tasks</h1>
          <div className="flex items-center gap-2">
            <Link
              href="/upload"
              className="text-sm text-blue-600 font-medium px-3 py-1.5 rounded-lg hover:bg-blue-50 transition-colors"
            >
              + Import
            </Link>
            <button
              onClick={() => signOut({ callbackUrl: '/auth/signin' })}
              className="text-sm text-gray-500 px-3 py-1.5 rounded-lg hover:bg-gray-100 transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-4 py-4 space-y-4">
        {/* Add task button */}
        <Link
          href="/tasks/new"
          className="block w-full bg-blue-600 text-white text-sm font-medium rounded-xl py-3 text-center hover:bg-blue-700 transition-colors"
        >
          + Add task
        </Link>

        {/* Task list */}
        {pending.length === 0 && done.length === 0 && (
          <div className="text-center py-16 text-gray-400">
            <p className="text-4xl mb-3">📋</p>
            <p className="text-sm">No tasks yet.</p>
            <p className="text-xs mt-1">Add a task or import from an image.</p>
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
    </main>
  );
}
