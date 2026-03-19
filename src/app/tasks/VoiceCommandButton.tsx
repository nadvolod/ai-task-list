'use client';

import { useState, useRef, useEffect } from 'react';

type VoiceState = 'idle' | 'recording' | 'processing' | 'results' | 'error';

interface ActionResult {
  type: string;
  taskId?: number;
  taskTitle?: string;
  status: 'success' | 'error';
  error?: string;
  result?: Record<string, unknown>;
}

interface VoiceCommandResponse {
  transcription: string;
  actions: ActionResult[];
  summary: string;
  queryResponse?: string;
}

export default function VoiceCommandButton({ onTasksChanged }: { onTasksChanged: () => void }) {
  const [state, setState] = useState<VoiceState>('idle');
  const [response, setResponse] = useState<VoiceCommandResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    };
  }, []);

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
        await sendVoiceCommand(blob);
      };

      mediaRecorder.start();
      setState('recording');
      setResponse(null);
      setErrorMsg('');
    } catch {
      setState('error');
      setErrorMsg('Microphone access denied. Please allow microphone access.');
    }
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop();
    setState('processing');
  }

  async function sendVoiceCommand(blob: Blob) {
    const formData = new FormData();
    formData.append('audio', blob, 'recording.webm');

    try {
      const res = await fetch('/api/voice-command', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setState('error');
        setErrorMsg(data.error ?? 'Failed to process voice command.');
        return;
      }

      const data: VoiceCommandResponse = await res.json();
      setResponse(data);
      setState('results');

      // Refresh task list if any mutations happened
      const hasMutations = data.actions.some(
        a => a.status === 'success' && a.type !== 'query'
      );
      if (hasMutations) {
        onTasksChanged();
      }

      // Auto-dismiss after 6 seconds
      dismissTimerRef.current = setTimeout(() => {
        setState('idle');
        setResponse(null);
      }, 6000);
    } catch {
      setState('error');
      setErrorMsg('Network error. Please try again.');
    }
  }

  function dismiss() {
    if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    setState('idle');
    setResponse(null);
    setErrorMsg('');
  }

  function handleMicClick() {
    if (state === 'recording') {
      stopRecording();
    } else if (state === 'idle' || state === 'error') {
      startRecording();
    } else if (state === 'results') {
      dismiss();
    }
  }

  function actionLabel(action: ActionResult): string {
    const title = action.taskTitle || 'Unknown task';
    switch (action.type) {
      case 'add_task': {
        const score = (action.result as Record<string, unknown>)?.priorityScore;
        return `Created: "${title}"${score != null ? ` (priority: ${Math.round(score as number)})` : ''}`;
      }
      case 'mark_done':
        return `Marked done: "${title}"`;
      case 'mark_undone':
        return `Reopened: "${title}"`;
      case 'update_task':
      case 'reprioritize': {
        const score = (action.result as Record<string, unknown>)?.priorityScore;
        return `Updated: "${title}"${score != null ? ` (priority: ${Math.round(score as number)})` : ''}`;
      }
      case 'delete_task':
        return `Deleted: "${title}"`;
      case 'query':
        return '';
      default:
        return `${action.type}: "${title}"`;
    }
  }

  return (
    <>
      {/* Results / Error overlay */}
      {(state === 'results' || state === 'error') && (
        <div
          className="fixed bottom-24 left-4 right-4 max-w-lg mx-auto z-50 animate-in slide-in-from-bottom"
          onClick={dismiss}
        >
          <div className="bg-white rounded-2xl border border-gray-200 shadow-lg p-4 space-y-3">
            {state === 'error' && (
              <p className="text-sm text-red-600">{errorMsg}</p>
            )}

            {state === 'results' && response && (
              <>
                {/* Transcription */}
                <p className="text-xs text-gray-400 italic">
                  &ldquo;{response.transcription}&rdquo;
                </p>

                {/* Action results */}
                {response.actions.length > 0 && (
                  <div className="space-y-1">
                    {response.actions.map((action, i) => {
                      if (action.type === 'query') return null;
                      const label = actionLabel(action);
                      if (!label) return null;
                      return (
                        <div key={i} className="flex items-center gap-2">
                          <span className={`text-xs font-bold ${action.status === 'success' ? 'text-green-600' : 'text-red-500'}`}>
                            {action.status === 'success' ? '\u2713' : '\u2717'}
                          </span>
                          <span className="text-sm text-gray-700">{label}</span>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Query response */}
                {response.queryResponse && (
                  <div className="bg-blue-50 rounded-lg px-3 py-2">
                    <p className="text-sm text-blue-800">{response.queryResponse}</p>
                  </div>
                )}

                {/* Summary fallback if no actions */}
                {response.actions.length === 0 && (
                  <p className="text-sm text-gray-600">{response.summary}</p>
                )}
              </>
            )}

            <p className="text-xs text-gray-300 text-center">Tap to dismiss</p>
          </div>
        </div>
      )}

      {/* Floating mic button */}
      <button
        onClick={handleMicClick}
        disabled={state === 'processing'}
        aria-label={
          state === 'recording' ? 'Stop recording voice command' :
          state === 'processing' ? 'Processing voice command' :
          'Record voice command'
        }
        className={`fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full shadow-lg flex items-center justify-center transition-all
          ${state === 'recording'
            ? 'bg-red-500 hover:bg-red-600 animate-pulse'
            : state === 'processing'
            ? 'bg-gray-400 cursor-wait'
            : 'bg-blue-600 hover:bg-blue-700'
          }
        `}
      >
        {state === 'processing' ? (
          <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
        ) : state === 'recording' ? (
          /* Stop icon */
          <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
            <rect x="6" y="6" width="12" height="12" rx="2" />
          </svg>
        ) : (
          /* Mic icon */
          <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4M12 15a3 3 0 003-3V5a3 3 0 00-6 0v7a3 3 0 003 3z" />
          </svg>
        )}
      </button>

      {/* Recording indicator */}
      {state === 'recording' && (
        <div className="fixed bottom-22 right-6 z-50 bg-red-500 text-white text-xs font-medium px-3 py-1.5 rounded-full shadow-lg animate-pulse">
          Listening...
        </div>
      )}

      {/* Processing indicator */}
      {state === 'processing' && (
        <div className="fixed bottom-22 right-6 z-50 bg-gray-700 text-white text-xs font-medium px-3 py-1.5 rounded-full shadow-lg">
          Thinking...
        </div>
      )}
    </>
  );
}
