'use client';

import type { Task } from '@/types/task';

interface StatusIconProps {
  status: Task['status'];
  size?: 'sm' | 'md';
  animated?: boolean;
}

export default function StatusIcon({ status, size = 'md', animated = false }: StatusIconProps) {
  const iconSize = size === 'sm' ? 'w-4 h-4' : 'w-5 h-5';
  const checkSize = size === 'sm' ? 'w-2.5 h-2.5' : 'w-3 h-3';

  if (status === 'done') {
    return (
      <div className={`${iconSize} rounded-full bg-green-500 border-2 border-green-500 flex items-center justify-center ${animated ? 'animate-check-pop' : ''}`}>
        <svg className={`${checkSize} text-white`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </div>
    );
  }

  if (status === 'doing') {
    return (
      <div className={`${iconSize} rounded-full bg-amber-500 border-2 border-amber-500 flex items-center justify-center`}>
        <svg className={`${checkSize} text-white`} fill="currentColor" viewBox="0 0 24 24">
          <path d="M8 5v14l11-7z" />
        </svg>
      </div>
    );
  }

  if (status === 'waiting') {
    return (
      <div className={`${iconSize} rounded-full bg-purple-500 border-2 border-purple-500 flex items-center justify-center`}>
        <svg className={`${checkSize} text-white`} fill="currentColor" viewBox="0 0 24 24">
          <path d="M6 4h4v16H6zM14 4h4v16h-4z" />
        </svg>
      </div>
    );
  }

  return (
    <div className={`${iconSize} rounded-full border-2 border-gray-300`} />
  );
}
