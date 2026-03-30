import { useRef, useCallback, useState } from 'react';

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export function useAutoSave(
  taskId: number,
  delay: number = 500,
) {
  const [status, setStatus] = useState<SaveStatus>('idle');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<Record<string, unknown>>({});

  const save = useCallback(async (fields: Record<string, unknown>) => {
    // Merge with any pending fields
    pendingRef.current = { ...pendingRef.current, ...fields };

    if (timerRef.current) clearTimeout(timerRef.current);

    timerRef.current = setTimeout(async () => {
      const body = { ...pendingRef.current };
      pendingRef.current = {};
      setStatus('saving');

      try {
        const res = await fetch(`/api/tasks/${taskId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          setStatus('error');
          return null;
        }

        const updated = await res.json();
        setStatus('saved');
        setTimeout(() => setStatus(prev => prev === 'saved' ? 'idle' : prev), 2000);
        return updated;
      } catch {
        setStatus('error');
        return null;
      }
    }, delay);
  }, [taskId, delay]);

  const saveImmediate = useCallback(async (fields: Record<string, unknown>) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    pendingRef.current = {};
    setStatus('saving');

    try {
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fields),
      });

      if (!res.ok) {
        setStatus('error');
        return null;
      }

      const updated = await res.json();
      setStatus('saved');
      setTimeout(() => setStatus(prev => prev === 'saved' ? 'idle' : prev), 2000);
      return updated;
    } catch {
      setStatus('error');
      return null;
    }
  }, [taskId]);

  return { save, saveImmediate, status };
}
