import { describe, it, expect, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { getTestDb, cleanupTestUser } from '../helpers/db';
import { eq } from 'drizzle-orm';
import { users } from '../../src/lib/db/schema';

const { POST } = await import('../../src/app/api/auth/signup/route');

const createdUserIds: number[] = [];

afterAll(async () => {
  for (const id of createdUserIds) {
    await cleanupTestUser(id);
  }
});

describe('POST /api/auth/signup', () => {
  it('creates a user with valid credentials', async () => {
    const email = `auth-test-${Date.now()}@test.com`;
    const req = new NextRequest('http://localhost/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ email, password: 'validpass123' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.email).toBe(email.toLowerCase());
    expect(data.id).toBeDefined();
    createdUserIds.push(data.id);
  });

  it('returns 409 for duplicate email', async () => {
    const email = `dup-test-${Date.now()}@test.com`;
    // First signup
    const req1 = new NextRequest('http://localhost/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ email, password: 'validpass123' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res1 = await POST(req1);
    const data1 = await res1.json();
    createdUserIds.push(data1.id);

    // Second signup with same email
    const req2 = new NextRequest('http://localhost/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ email, password: 'differentpass' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res2 = await POST(req2);
    expect(res2.status).toBe(409);
  });

  it('returns 400 for short password', async () => {
    const req = new NextRequest('http://localhost/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ email: 'short@test.com', password: '12345' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 for missing email', async () => {
    const req = new NextRequest('http://localhost/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ password: 'validpass123' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('normalizes email with trim and lowercase', async () => {
    const email = `  NormTest-${Date.now()}@Test.COM  `;
    const req = new NextRequest('http://localhost/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ email, password: 'validpass123' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.email).toBe(email.toLowerCase().trim());
    createdUserIds.push(data.id);

    // Verify in DB
    const db = getTestDb();
    const [dbUser] = await db.select().from(users).where(eq(users.id, data.id));
    expect(dbUser.email).toBe(email.toLowerCase().trim());
  });
});
