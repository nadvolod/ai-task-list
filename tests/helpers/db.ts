import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from '../../src/lib/db/schema';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { getServerSession } from 'next-auth';
import { vi } from 'vitest';

let testDb: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getTestDb() {
  if (!testDb) {
    const sql = neon(process.env.DATABASE_URL!);
    testDb = drizzle(sql, { schema });
  }
  return testDb;
}

export async function createTestUser(emailPrefix = 'test') {
  const db = getTestDb();
  const email = `${emailPrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.com`;
  const passwordHash = await bcrypt.hash('testpass123', 4); // low rounds for speed
  const [user] = await db.insert(schema.users).values({ email, passwordHash }).returning();
  return { userId: user.id, email, password: 'testpass123' };
}

export async function cleanupTestUser(userId: number) {
  const db = getTestDb();
  const userTasks = await db.select().from(schema.tasks).where(eq(schema.tasks.userId, userId));
  for (const task of userTasks) {
    await db.delete(schema.taskEvents).where(eq(schema.taskEvents.taskId, task.id));
  }
  await db.delete(schema.priorityOverrides).where(eq(schema.priorityOverrides.userId, userId));
  await db.delete(schema.categoryBoosts).where(eq(schema.categoryBoosts.userId, userId));
  await db.delete(schema.tasks).where(eq(schema.tasks.userId, userId));
  await db.delete(schema.uploads).where(eq(schema.uploads.userId, userId));
  await db.delete(schema.users).where(eq(schema.users.id, userId));
}

const mockedGetServerSession = vi.mocked(getServerSession);

export function mockSession(userId: number, email?: string) {
  mockedGetServerSession.mockResolvedValue({
    user: { id: String(userId), email: email ?? `user-${userId}@test.com` },
    expires: new Date(Date.now() + 86400000).toISOString(),
  });
}

export function mockNoSession() {
  mockedGetServerSession.mockResolvedValue(null);
}
