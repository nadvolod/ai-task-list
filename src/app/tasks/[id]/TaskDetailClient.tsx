'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import type { Task } from '@/types/task';
import { formatRecurrenceLabel } from '@/lib/recurrence';

const RECURRENCE_OPTIONS = [
  { value: '', label: 'None' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Every 2 weeks' },
  { value: 'monthly', label: 'Monthly' },
];

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function TaskDetailClient({ task: initialTask, autoEdit = false }: { task: Task; autoEdit?: boolean }) {
  const [task, setTask] = useState(initialTask);
  const [editing, setEditing] = useState(autoEdit);
  const [title, setTitle] = useState(initialTask.title);
  const [description, setDescription] = useState(initialTask.description ?? '');
  const [monetaryValue, setMonetaryValue] = useState(initialTask.monetaryValue?.toString() ?? '');
  const [revenuePotential, setRevenuePotential] = useState(initialTask.revenuePotential?.toString() ?? '');
  const [urgency, setUrgency] = useState(initialTask.urgency?.toString() ?? '');
  const [strategicValue, setStrategicValue] = useState(initialTask.strategicValue?.toString() ?? '');
  const [dueDate, setDueDate] = useState(initialTask.dueDate ? new Date(initialTask.dueDate).toISOString().split('T')[0] : '');
  const [category, setCategory] = useState(initialTask.category ?? '');
  const [assignee, setAssignee] = useState(initialTask.assignee ?? '');
  const [recurrenceRule, setRecurrenceRule] = useState(initialTask.recurrenceRule ?? '');
  const [recurrenceDays, setRecurrenceDays] = useState<Set<number>>(
    initialTask.recurrenceDays ? new Set(initialTask.recurrenceDays.split(',').map(Number)) : new Set()
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Subtasks state
  const [subtasks, setSubtasks] = useState<Task[]>([]);
  const [subtaskAddTitle, setSubtaskAddTitle] = useState('');
  const [subtaskAddLoading, setSubtaskAddLoading] = useState(false);

  // Voice recording state
  const [recording, setRecording] = useState(false);
  const [voiceLoading, setVoiceLoading] = useState(false);
  const [voiceResult, setVoiceResult] = useState<{ transcription: string } | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  // Fetch subtasks on mount (if this is a parent task)
  useEffect(() => {
    if (initialTask.parentId === null) {
      fetch(`/api/tasks`)
        .then(res => res.json())
        .then((allTasks: Task[]) => {
          setSubtasks(allTasks.filter((t: Task) => t.parentId === initialTask.id));
        })
        .catch(() => {});
    }
  }, [initialTask.id, initialTask.parentId]);

  function toggleRecurrenceDay(day: number) {
    setRecurrenceDays(prev => {
      const next = new Set(prev);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      return next;
    });
  }

  async function saveTask() {
    setSaving(true);
    setError('');

    const body: Record<string, unknown> = {
      title,
      description: description || undefined,
      monetaryValue: monetaryValue ? parseFloat(monetaryValue) : null,
      revenuePotential: revenuePotential ? parseFloat(revenuePotential) : null,
      urgency: urgency ? parseInt(urgency) : null,
      strategicValue: strategicValue ? parseInt(strategicValue) : null,
      dueDate: dueDate || null,
      category: category || null,
      assignee: assignee || null,
      recurrenceRule: recurrenceRule || null,
      recurrenceDays: recurrenceDays.size > 0 ? [...recurrenceDays].sort().join(',') : null,
    };

    const res = await fetch(`/api/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      setError('Failed to save.');
      setSaving(false);
      return;
    }

    const updated = await res.json();
    setTask(updated);
    setEditing(false);
    setSaving(false);
  }

  async function addSubtask(e: React.FormEvent) {
    e.preventDefault();
    if (!subtaskAddTitle.trim()) return;
    setSubtaskAddLoading(true);

    const res = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: subtaskAddTitle.trim(), parentId: task.id }),
    });

    if (res.ok) {
      const newTask = await res.json();
      setSubtasks(prev => [...prev, newTask]);
      setSubtaskAddTitle('');
    }
    setSubtaskAddLoading(false);
  }

  async function toggleSubtaskDone(subtask: Task) {
    const newStatus = subtask.status === 'done' ? 'todo' : 'done';
    setSubtasks(prev => prev.map(s => s.id === subtask.id ? { ...s, status: newStatus } : s));
    const res = await fetch(`/api/tasks/${subtask.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    });
    if (!res.ok) {
      setSubtasks(prev => prev.map(s => s.id === subtask.id ? subtask : s));
    }
  }

  async function deleteSubtask(id: number) {
    const subtaskToDelete = subtasks.find(s => s.id === id);
    setSubtasks(prev => prev.filter(s => s.id !== id));
    const res = await fetch(`/api/tasks/${id}`, { method: 'DELETE' });
    if (!res.ok && subtaskToDelete) {
      setSubtasks(prev => [...prev, subtaskToDelete]);
    }
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = e => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        await sendVoice(blob);
      };

      mediaRecorder.start();
      setRecording(true);
    } catch {
      setError('Microphone access denied. Please allow microphone access.');
    }
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop();
    setRecording(false);
    setVoiceLoading(true);
  }

  async function sendVoice(blob: Blob) {
    const formData = new FormData();
    formData.append('audio', blob, 'recording.webm');

    const res = await fetch(`/api/tasks/${task.id}/voice`, {
      method: 'POST',
      body: formData,
    });

    setVoiceLoading(false);

    if (!res.ok) {
      setError('Failed to process voice note.');
      return;
    }

    const data = await res.json();
    setTask(data.task);
    setVoiceResult({ transcription: data.transcription });
    setMonetaryValue(data.task.monetaryValue?.toString() ?? '');
    setRevenuePotential(data.task.revenuePotential?.toString() ?? '');
    setUrgency(data.task.urgency?.toString() ?? '');
    setStrategicValue(data.task.strategicValue?.toString() ?? '');
    setDueDate(data.task.dueDate ? new Date(data.task.dueDate).toISOString().split('T')[0] : '');
  }

  function priorityColor(score: number) {
    if (score >= 60) return 'text-red-600 bg-red-50 border-red-100';
    if (score >= 30) return 'text-orange-600 bg-orange-50 border-orange-100';
    return 'text-gray-500 bg-gray-50 border-gray-100';
  }

  const subtaskDone = subtasks.filter(s => s.status === 'done').length;

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-100 sticky top-0 z-10">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/tasks" aria-label="Back to tasks" className="text-gray-500 hover:text-gray-700">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <h1 className="font-bold text-gray-900 truncate max-w-[200px]">Task Detail</h1>
          </div>
          <button
            onClick={() => setEditing(!editing)}
            className="text-sm text-blue-600 font-medium px-3 py-1.5 rounded-lg hover:bg-blue-50 transition-colors"
          >
            {editing ? 'Cancel' : 'Edit'}
          </button>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-4 py-4 space-y-4">
        {error && <div className="bg-red-50 text-red-700 text-sm rounded-xl px-3 py-2">{error}</div>}

        {/* Parent task breadcrumb */}
        {task.parentId != null && (
          <Link href={`/tasks/${task.parentId}`} className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Parent task
          </Link>
        )}

        {/* Priority score card */}
        <div className={`rounded-xl border p-4 ${priorityColor(task.priorityScore)}`}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-semibold uppercase tracking-wide opacity-70">Priority Score</span>
            <span className="text-2xl font-bold">{Math.round(task.priorityScore)}</span>
          </div>
          {task.priorityReason && (
            <p className="text-xs opacity-80 leading-relaxed">{task.priorityReason}</p>
          )}
          {task.manualPriorityScore != null && (
            <p className="text-xs mt-1 font-medium opacity-90">Manually pinned{task.manualPriorityReason ? `: ${task.manualPriorityReason}` : ''}</p>
          )}
        </div>

        {/* Task form */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">Title</label>
            {editing ? (
              <input
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            ) : (
              <p className="text-sm font-medium text-gray-900">{task.title}</p>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">Notes</label>
            {editing ? (
              <textarea
                rows={3}
                value={description}
                onChange={e => setDescription(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                placeholder="Any context..."
              />
            ) : (
              <p className="text-sm text-gray-600 whitespace-pre-wrap">{task.description || '—'}</p>
            )}
          </div>

          {/* Category */}
          <div>
            <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">Category</label>
            {editing ? (
              <input
                type="text"
                value={category}
                onChange={e => setCategory(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g. Temporal, Personal, Marketing"
              />
            ) : (
              <p className="text-sm text-gray-700">{task.category || '—'}</p>
            )}
          </div>

          {/* Assignee */}
          <div>
            <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">Assignee</label>
            {editing ? (
              <input
                type="text"
                value={assignee}
                onChange={e => setAssignee(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Person responsible"
              />
            ) : (
              <p className="text-sm text-gray-700">{task.assignee || '—'}</p>
            )}
          </div>

          {/* Priority fields */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">Monetary value ($)</label>
              {editing ? (
                <input type="number" min={0} value={monetaryValue} onChange={e => setMonetaryValue(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="0" />
              ) : (
                <p className="text-sm text-gray-700">{task.monetaryValue != null ? `$${task.monetaryValue.toLocaleString()}` : '—'}</p>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">Revenue potential ($)</label>
              {editing ? (
                <input type="number" min={0} value={revenuePotential} onChange={e => setRevenuePotential(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="0" />
              ) : (
                <p className="text-sm text-gray-700">{task.revenuePotential != null ? `$${task.revenuePotential.toLocaleString()}` : '—'}</p>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">Urgency (1-10)</label>
              {editing ? (
                <input type="number" min={1} max={10} value={urgency} onChange={e => setUrgency(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="1-10" />
              ) : (
                <p className="text-sm text-gray-700">{task.urgency ?? '—'}</p>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">Strategic value (1-10)</label>
              {editing ? (
                <input type="number" min={1} max={10} value={strategicValue} onChange={e => setStrategicValue(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="1-10" />
              ) : (
                <p className="text-sm text-gray-700">{task.strategicValue ?? '—'}</p>
              )}
            </div>
          </div>

          {/* Due date */}
          <div>
            <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">Due date</label>
            {editing ? (
              <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            ) : (
              <p className="text-sm text-gray-700">
                {task.dueDate ? new Date(task.dueDate).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
              </p>
            )}
          </div>

          {/* Recurrence */}
          <div>
            <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">Recurrence</label>
            {editing ? (
              <div className="space-y-2">
                <select
                  value={recurrenceRule}
                  onChange={e => setRecurrenceRule(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {RECURRENCE_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
                {(recurrenceRule === 'weekly' || recurrenceRule === 'biweekly') && (
                  <div className="flex gap-1.5 flex-wrap">
                    {DAY_NAMES.map((name, i) => (
                      <button
                        key={name}
                        type="button"
                        onClick={() => toggleRecurrenceDay(i + 1)}
                        className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                          recurrenceDays.has(i + 1) ? 'bg-purple-100 border-purple-300 text-purple-700' : 'bg-gray-50 border-gray-200 text-gray-500'
                        }`}
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-gray-700">
                {task.recurrenceRule
                  ? formatRecurrenceLabel(task.recurrenceRule, task.recurrenceDays)
                  : '—'}
              </p>
            )}
          </div>

          {editing && (
            <button
              onClick={saveTask}
              disabled={saving || !title.trim()}
              className="w-full bg-blue-600 text-white font-medium rounded-lg py-2.5 text-sm hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {saving ? 'Saving...' : 'Save changes'}
            </button>
          )}
        </div>

        {/* Subtasks section (only for parent tasks) */}
        {task.parentId === null && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-900">Subtasks</h2>
              {subtasks.length > 0 && (
                <span className="text-xs text-gray-400">{subtaskDone}/{subtasks.length} done</span>
              )}
            </div>

            {subtasks.length > 0 && (
              <div className="space-y-1">
                {subtasks.map(sub => (
                  <div key={sub.id} className={`flex items-center gap-2 py-1.5 ${sub.status === 'done' ? 'opacity-50' : ''}`}>
                    <button
                      onClick={() => toggleSubtaskDone(sub)}
                      className={`w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center transition-colors ${
                        sub.status === 'done' ? 'bg-green-500 border-green-500' : 'border-gray-300 hover:border-blue-400'
                      }`}
                    >
                      {sub.status === 'done' && (
                        <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </button>
                    <Link href={`/tasks/${sub.id}`} className={`flex-1 text-sm ${sub.status === 'done' ? 'line-through text-gray-400' : 'text-gray-700 hover:text-blue-600'}`}>
                      {sub.title}
                    </Link>
                    <button onClick={() => deleteSubtask(sub.id)} className="p-1 text-gray-300 hover:text-red-500">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}

            <form onSubmit={addSubtask} className="flex gap-2">
              <input
                type="text"
                value={subtaskAddTitle}
                onChange={e => setSubtaskAddTitle(e.target.value)}
                placeholder="Add a subtask..."
                className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <button
                type="submit"
                disabled={subtaskAddLoading || !subtaskAddTitle.trim()}
                className="text-sm text-blue-600 font-medium px-3 disabled:opacity-50"
              >
                {subtaskAddLoading ? '...' : 'Add'}
              </button>
            </form>
          </div>
        )}

        {/* Voice note section */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-3">
          <h2 className="text-sm font-semibold text-gray-900">Voice Note</h2>
          <p className="text-xs text-gray-400">
            Record a voice note to add context. The AI will extract priority metadata and update the score.
          </p>

          {voiceResult && (
            <div className="bg-blue-50 rounded-lg p-3">
              <p className="text-xs font-medium text-blue-800 mb-1">Transcription:</p>
              <p className="text-xs text-blue-700 italic">&quot;{voiceResult.transcription}&quot;</p>
            </div>
          )}

          {voiceLoading ? (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              Processing voice note...
            </div>
          ) : recording ? (
            <button
              onClick={stopRecording}
              className="w-full bg-red-600 text-white font-medium rounded-lg py-3 text-sm hover:bg-red-700 transition-colors flex items-center justify-center gap-2"
            >
              <span className="w-2 h-2 bg-white rounded-full animate-pulse" />
              Stop recording
            </button>
          ) : (
            <button
              onClick={startRecording}
              className="w-full bg-gray-900 text-white font-medium rounded-lg py-3 text-sm hover:bg-gray-800 transition-colors flex items-center justify-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
              Record voice note
            </button>
          )}
        </div>

        {/* Metadata */}
        <div className="text-xs text-gray-400 text-center pb-4">
          Source: {task.sourceType}
          {task.confidence != null && ` · ${Math.round(task.confidence * 100)}% confidence`}
        </div>
      </div>
    </main>
  );
}
