'use client';

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

interface Toast {
  id: number;
  message: string;
  type: 'default' | 'error' | 'success';
  action?: ToastAction;
  exiting?: boolean;
}

interface ToastContextType {
  showToast: (message: string, options?: { type?: Toast['type']; action?: ToastAction; duration?: number }) => void;
}

const ToastContext = createContext<ToastContextType | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

let nextId = 0;

export default function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((message: string, options?: { type?: Toast['type']; action?: ToastAction; duration?: number }) => {
    const id = nextId++;
    const duration = options?.duration ?? 4000;
    const toast: Toast = { id, message, type: options?.type ?? 'default', action: options?.action };
    setToasts(prev => [...prev, toast]);

    setTimeout(() => {
      setToasts(prev => prev.map(t => t.id === id ? { ...t, exiting: true } : t));
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== id));
      }, 200);
    }, duration);
  }, []);

  return (
    <ToastContext value={{ showToast }}>
      {children}
      {/* Toast container */}
      <div className="fixed bottom-20 left-0 right-0 z-50 flex flex-col items-center gap-2 pointer-events-none px-4" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        {toasts.map(toast => (
          <div
            key={toast.id}
            className={`pointer-events-auto max-w-sm w-full rounded-xl px-4 py-3 shadow-lg text-sm font-medium flex items-center justify-between gap-3 transition-all duration-200 ${
              toast.exiting ? 'opacity-0 translate-y-2' : 'opacity-100 translate-y-0'
            } ${
              toast.type === 'error' ? 'bg-red-600 text-white' :
              toast.type === 'success' ? 'bg-green-600 text-white' :
              'bg-gray-900 text-white'
            }`}
          >
            <span className="flex-1">{toast.message}</span>
            {toast.action && (
              <button
                onClick={toast.action.onClick}
                className={`flex-shrink-0 text-sm font-bold px-2 py-0.5 rounded-lg transition-colors ${
                  toast.type === 'error' ? 'text-red-100 hover:text-white hover:bg-red-500' :
                  toast.type === 'success' ? 'text-green-100 hover:text-white hover:bg-green-500' :
                  'text-gray-300 hover:text-white hover:bg-gray-700'
                }`}
              >
                {toast.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext>
  );
}
