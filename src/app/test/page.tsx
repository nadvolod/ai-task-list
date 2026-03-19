import { redirect } from 'next/navigation';
import TestPageClient from './TestPageClient';

export default function TestPage() {
  if (process.env.NODE_ENV === 'production' && !process.env.ENABLE_TEST_PAGE) {
    redirect('/');
  }

  return <TestPageClient />;
}
