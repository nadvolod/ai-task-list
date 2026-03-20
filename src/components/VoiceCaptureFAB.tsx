'use client';

import { useState, useRef, useEffect } from 'react';

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

interface VoiceCommandResponse {
  transcription: string;
  intent: string;
  action: string;
  spokenResponse: string;
  speechUrl?: string | null;
  tasksCreated?: Task[];
  taskUpdated?: Task;
  taskDeleted?: number;
  allTasksDeleted?: boolean;
  tasksList?: Task[];
  count?: number;
  summary?: string;
}

interface VoiceCaptureFABProps {
  onTasksCreated: (tasks: Task[]) => void;
  onTaskUpdated: (task: Task) => void;
  onTaskDeleted: (taskId: number) => void;
  onAllTasksDeleted: () => void;
  onRefreshRequested: () => void;
}

export default function VoiceCaptureFAB({ onTasksCreated, onTaskUpdated, onTaskDeleted, onAllTasksDeleted, onRefreshRequested }: VoiceCaptureFABProps) {
  const [state, setState] = useState<'idle' | 'recording' | 'processing' | 'speaking'>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastResponse, setLastResponse] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (state === 'recording') {
      const startTime = Date.now();
      timerRef.current = setInterval(() => setElapsed(Math.floor((Date.now() - startTime) / 1000)), 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [state]);

  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(null), 4000);
      return () => clearTimeout(t);
    }
  }, [toast]);

  useEffect(() => {
    if (error) {
      const t = setTimeout(() => setError(null), 5000);
      return () => clearTimeout(t);
    }
  }, [error]);

  useEffect(() => {
    if (lastResponse) {
      const t = setTimeout(() => setLastResponse(null), 8000);
      return () => clearTimeout(t);
    }
  }, [lastResponse]);

  async function startRecording() {
    try {
      setError(null);
      setLastResponse(null);
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
        await sendVoiceCommand(blob);
      };

      mediaRecorder.start();
      setState('recording');
    } catch {
      setError('Microphone access denied');
    }
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop();
    setState('processing');
  }

  async function sendVoiceCommand(blob: Blob) {
    const formData = new FormData();
    formData.append('audio', blob, 'recording.webm');
    formData.append('speak', 'true');

    try {
      const res = await fetch('/api/voice-command', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        setError('Failed to process voice command');
        setState('idle');
        return;
      }

      const data: VoiceCommandResponse = await res.json();
      handleCommandResponse(data);
    } catch {
      setError('Failed to process voice command');
      setState('idle');
    }
  }

  function handleCommandResponse(data: VoiceCommandResponse) {
    // Show the spoken response as text
    setLastResponse(data.spokenResponse);

    // Play audio response if available
    if (data.speechUrl) {
      setState('speaking');
      const audio = new Audio(data.speechUrl);
      audioRef.current = audio;
      audio.onended = () => setState('idle');
      audio.onerror = () => setState('idle');
      audio.play().catch(() => setState('idle'));
    } else {
      setState('idle');
    }

    // Handle mutations
    switch (data.action) {
      case 'created':
        if (data.tasksCreated?.length) {
          onTasksCreated(data.tasksCreated);
          setToast(`Created ${data.tasksCreated.length} task${data.tasksCreated.length !== 1 ? 's' : ''}`);
        }
        break;
      case 'completed':
      case 'reopened':
      case 'updated':
        if (data.taskUpdated) {
          onTaskUpdated(data.taskUpdated);
          setToast(data.action === 'completed' ? 'Task completed' : data.action === 'updated' ? 'Task updated' : 'Task reopened');
        }
        break;
      case 'deleted':
        if (data.taskDeleted) {
          onTaskDeleted(data.taskDeleted);
          setToast('Task deleted');
        }
        break;
      case 'deleted_all':
        if (data.allTasksDeleted) {
          onAllTasksDeleted();
          setToast('All tasks deleted');
        }
        break;
      case 'briefing':
      case 'query':
      case 'count':
        // For queries, the spoken response handles it. Optionally refresh.
        onRefreshRequested();
        break;
    }
  }

  function handleClick() {
    if (state === 'idle') startRecording();
    else if (state === 'recording') stopRecording();
    else if (state === 'speaking') {
      audioRef.current?.pause();
      setState('idle');
    }
  }

  const formatTime = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;

  return (
    <>
      {/* Spoken response text bubble */}
      {lastResponse && (
        <div
          className="fixed left-4 right-20 z-50 bg-white border border-gray-200 shadow-xl rounded-2xl p-4 animate-fade-in"
          style={{ bottom: '6rem' }}
        >
          <div className="flex items-start gap-2">
            {state === 'speaking' && (
              <div className="flex-shrink-0 mt-1">
                <div className="flex gap-0.5">
                  <span className="w-1 h-3 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1 h-4 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1 h-3 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            )}
            <p className="text-sm text-gray-700 leading-relaxed flex-1">{lastResponse}</p>
            <button
              onClick={() => setLastResponse(null)}
              className="text-gray-400 hover:text-gray-600 flex-shrink-0"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Toast notification */}
      {toast && !lastResponse && (
        <div className="fixed bottom-28 left-1/2 -translate-x-1/2 z-50 bg-gray-900 text-white text-sm font-medium px-4 py-2.5 rounded-full shadow-lg animate-fade-in">
          {toast}
        </div>
      )}

      {/* Error notification */}
      {error && (
        <div className="fixed bottom-28 left-1/2 -translate-x-1/2 z-50 bg-red-600 text-white text-sm font-medium px-4 py-2.5 rounded-full shadow-lg">
          {error}
        </div>
      )}

      {/* Recording time indicator */}
      {state === 'recording' && (
        <div className="fixed bottom-28 left-1/2 -translate-x-1/2 z-50 bg-red-600 text-white text-sm font-medium px-4 py-2 rounded-full shadow-lg flex items-center gap-2">
          <span className="w-2 h-2 bg-white rounded-full animate-pulse" />
          {formatTime(elapsed)}
        </div>
      )}

      {/* FAB button */}
      <button
        onClick={handleClick}
        disabled={state === 'processing'}
        aria-label={
          state === 'idle' ? 'Voice command' :
          state === 'recording' ? 'Stop recording' :
          state === 'speaking' ? 'Stop speaking' :
          'Processing...'
        }
        className={`fixed z-50 w-14 h-14 rounded-full shadow-lg flex items-center justify-center transition-all active:scale-95 ${
          state === 'recording'
            ? 'bg-red-600 hover:bg-red-700 animate-pulse'
            : state === 'processing'
            ? 'bg-gray-400 cursor-wait'
            : state === 'speaking'
            ? 'bg-blue-500 hover:bg-blue-600'
            : 'bg-blue-600 hover:bg-blue-700'
        }`}
        style={{ bottom: '5.5rem', right: '1.5rem' }}
      >
        {state === 'processing' ? (
          <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
        ) : state === 'recording' ? (
          <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24">
            <rect x="6" y="6" width="12" height="12" rx="2" />
          </svg>
        ) : state === 'speaking' ? (
          <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.536 8.464a5 5 0 010 7.072M18.364 5.636a9 9 0 010 12.728M6 18l.001-6a2 2 0 012-2h.5l4.5-4v16l-4.5-4h-.5a2 2 0 01-2-2z" />
          </svg>
        ) : (
          <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
          </svg>
        )}
      </button>
    </>
  );
}
