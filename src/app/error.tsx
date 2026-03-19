'use client';

import { useEffect } from 'react';

export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    console.error('Unhandled error:', error);
  }, [error]);

  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="text-center space-y-4">
        <h2 className="text-lg font-bold text-gray-900">Something went wrong</h2>
        <p className="text-sm text-gray-500">{error.message || 'An unexpected error occurred.'}</p>
        <button
          onClick={reset}
          className="bg-blue-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
        >
          Try again
        </button>
      </div>
    </main>
  );
}
