'use client';

import { useState } from 'react';
import { signIn, signOut, useSession } from 'next-auth/react';
import Link from 'next/link';

interface TestResult {
  label: string;
  status: 'pass' | 'fail' | 'pending';
  detail: string;
}

export default function TestPage() {
  const { data: session } = useSession();
  const [results, setResults] = useState<TestResult[]>([]);
  const [running, setRunning] = useState(false);

  function addResult(result: TestResult) {
    setResults(prev => [...prev, result]);
  }

  async function runTest(label: string, fn: () => Promise<string>) {
    addResult({ label, status: 'pending', detail: 'Running...' });
    try {
      const detail = await fn();
      setResults(prev => prev.map(r => r.label === label ? { label, status: 'pass', detail } : r));
    } catch (err) {
      setResults(prev => prev.map(r => r.label === label ? { label, status: 'fail', detail: (err as Error).message } : r));
    }
  }

  async function runAllTests() {
    setResults([]);
    setRunning(true);

    // Health check
    await runTest('Health Check', async () => {
      const res = await fetch('/api/health');
      const data = await res.json();
      return `Status: ${data.status}, DB: ${data.checks.database}, OpenAI: ${data.checks.openai}`;
    });

    // Auth test - signup
    const testEmail = `test-${Date.now()}@example.com`;
    const testPassword = 'testpass123';
    await runTest('Signup', async () => {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: testEmail, password: testPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      return `Created user: ${data.email} (id: ${data.id})`;
    });

    // Auth test - signin
    await runTest('Signin', async () => {
      const res = await signIn('credentials', {
        email: testEmail,
        password: testPassword,
        redirect: false,
      });
      if (res?.error) throw new Error(res.error);
      return `Signed in as ${testEmail}`;
    });

    // Create task
    let taskId: number | null = null;
    await runTest('Create Task', async () => {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Test task from /test page',
          monetaryValue: 500,
          urgency: 7,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      taskId = data.id;
      return `Created task #${data.id} with score ${data.priorityScore}: ${data.priorityReason}`;
    });

    // List tasks
    await runTest('List Tasks', async () => {
      const res = await fetch('/api/tasks');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      return `Found ${data.length} tasks`;
    });

    // Update task
    if (taskId) {
      await runTest('Update Task', async () => {
        const res = await fetch(`/api/tasks/${taskId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ urgency: 10, monetaryValue: 1000 }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        return `Updated task score to ${data.priorityScore}: ${data.priorityReason}`;
      });

      // Delete task
      await runTest('Delete Task', async () => {
        const res = await fetch(`/api/tasks/${taskId}`, { method: 'DELETE' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        return 'Task deleted successfully';
      });
    }

    // Validation tests
    await runTest('Validation: Empty Title', async () => {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: '' }),
      });
      if (res.status !== 400) throw new Error(`Expected 400, got ${res.status}`);
      return 'Correctly rejected empty title with 400';
    });

    await runTest('Validation: Negative Monetary', async () => {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Test', monetaryValue: -100 }),
      });
      if (res.status !== 400) throw new Error(`Expected 400, got ${res.status}`);
      return 'Correctly rejected negative monetaryValue with 400';
    });

    await runTest('Validation: Invalid Task ID', async () => {
      const res = await fetch('/api/tasks/abc', { method: 'DELETE' });
      if (res.status !== 400) throw new Error(`Expected 400, got ${res.status}`);
      return 'Correctly rejected non-numeric task ID with 400';
    });

    await runTest('Upload: No File', async () => {
      const res = await fetch('/api/upload', { method: 'POST', body: new FormData() });
      if (res.status !== 400) throw new Error(`Expected 400, got ${res.status}`);
      return 'Correctly rejected missing file with 400';
    });

    setRunning(false);
  }

  const statusIcon = (s: TestResult['status']) =>
    s === 'pass' ? '✓' : s === 'fail' ? '✗' : '…';
  const statusColor = (s: TestResult['status']) =>
    s === 'pass' ? 'text-green-600' : s === 'fail' ? 'text-red-600' : 'text-gray-400';

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-100 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <h1 className="font-bold text-gray-900">Manual Test Page</h1>
          <Link href="/tasks" className="text-sm text-blue-600 font-medium">Back to Tasks</Link>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 py-4 space-y-4">
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 space-y-3">
          <p className="text-sm text-gray-500">
            Session: {session ? `Signed in as ${session.user?.email}` : 'Not signed in'}
          </p>

          <div className="flex gap-2">
            <button
              onClick={runAllTests}
              disabled={running}
              className="bg-blue-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {running ? 'Running...' : 'Run All Tests'}
            </button>
            <button
              onClick={() => setResults([])}
              className="text-sm text-gray-500 px-3 py-2 rounded-lg hover:bg-gray-100 transition-colors"
            >
              Clear
            </button>
            {session && (
              <button
                onClick={() => signOut({ redirect: false })}
                className="text-sm text-gray-500 px-3 py-2 rounded-lg hover:bg-gray-100 transition-colors"
              >
                Sign Out
              </button>
            )}
          </div>
        </div>

        {results.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm divide-y divide-gray-50">
            {results.map((r, i) => (
              <div key={i} className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className={`font-mono text-sm font-bold ${statusColor(r.status)}`}>
                    {statusIcon(r.status)}
                  </span>
                  <span className="text-sm font-medium text-gray-900">{r.label}</span>
                </div>
                <p className="text-xs text-gray-500 mt-1 ml-5 break-all">{r.detail}</p>
              </div>
            ))}
            <div className="px-4 py-3 bg-gray-50 rounded-b-xl">
              <p className="text-xs text-gray-500">
                Passed: {results.filter(r => r.status === 'pass').length} /
                Failed: {results.filter(r => r.status === 'fail').length} /
                Pending: {results.filter(r => r.status === 'pending').length}
              </p>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
