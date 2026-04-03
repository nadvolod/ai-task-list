import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { redirect } from 'next/navigation';
import MoneyDashboardClient from './MoneyDashboardClient';

export default async function MoneyPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect('/auth/signin');

  return <MoneyDashboardClient />;
}
