'use client';

import { useState, useRef } from 'react';
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
  dueDate: string | null;
}

export default function TaskDetailClient({ task: initialTask }: { task: Task }) {
  const [task, setTask] = useState(initialTask);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(initialTask.title);
  const [description, setDescription] = useState(initialTask.description ?? '');
  const [monetaryValue, setMonetaryValue] = useState(initialTask.monetaryValue?.toString() ?? '');
  const [revenuePotential, setRevenuePotential] = useState(initialTask.revenuePotential?.toString() ?? '');
  const [urgency, setUrgency] = useState(initialTask.urgency?.toString() ?? '');
  const [strategicValue, setStrategicValue] = useState(initialTask.strategicValue?.toString() ?? '');
  const [dueDate, setDueDate] = useState(initialTask.dueDate ? new Date(initialTask.dueDate).toISOString().split('T')[0] : '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Voice recording state
  const [recording, setRecording] = useState(false);
  const [voiceLoading, setVoiceLoading] = useState(false);
  const [voiceResult, setVoiceResult] = useState<{ transcription: string } | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

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
    // Update form fields with new values
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

        {/* Priority score card */}
        <div className={`rounded-xl border p-4 ${priorityColor(task.priorityScore)}`}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-semibold uppercase tracking-wide opacity-70">Priority Score</span>
            <span className="text-2xl font-bold">{Math.round(task.priorityScore)}</span>
          </div>
          {task.priorityReason && (
            <p className="text-xs opacity-80 leading-relaxed">{task.priorityReason}</p>
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
                placeholder="Any context…"
              />
            ) : (
              <p className="text-sm text-gray-600 whitespace-pre-wrap">{task.description || '—'}</p>
            )}
          </div>

          {/* Priority fields */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">
                Monetary value ($)
              </label>
              {editing ? (
                <input
                  type="number"
                  min={0}
                  value={monetaryValue}
                  onChange={e => setMonetaryValue(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="0"
                />
              ) : (
                <p className="text-sm text-gray-700">{task.monetaryValue != null ? `$${task.monetaryValue.toLocaleString()}` : '—'}</p>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">
                Revenue potential ($)
              </label>
              {editing ? (
                <input
                  type="number"
                  min={0}
                  value={revenuePotential}
                  onChange={e => setRevenuePotential(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="0"
                />
              ) : (
                <p className="text-sm text-gray-700">{task.revenuePotential != null ? `$${task.revenuePotential.toLocaleString()}` : '—'}</p>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">
                Urgency (1-10)
              </label>
              {editing ? (
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={urgency}
                  onChange={e => setUrgency(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="1-10"
                />
              ) : (
                <p className="text-sm text-gray-700">{task.urgency ?? '—'}</p>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">
                Strategic value (1-10)
              </label>
              {editing ? (
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={strategicValue}
                  onChange={e => setStrategicValue(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="1-10"
                />
              ) : (
                <p className="text-sm text-gray-700">{task.strategicValue ?? '—'}</p>
              )}
            </div>
          </div>

          {/* Due date */}
          <div>
            <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">Due date</label>
            {editing ? (
              <input
                type="date"
                value={dueDate}
                onChange={e => setDueDate(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            ) : (
              <p className="text-sm text-gray-700">
                {task.dueDate ? new Date(task.dueDate).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
              </p>
            )}
          </div>

          {editing && (
            <button
              onClick={saveTask}
              disabled={saving || !title.trim()}
              className="w-full bg-blue-600 text-white font-medium rounded-lg py-2.5 text-sm hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          )}
        </div>

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
              Processing voice note…
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
