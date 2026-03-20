import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { logger } from '@/lib/logger';

export async function POST(req: NextRequest) {
  try {
    logger.info('POST /api/auth/signup');
    const { email, password } = await req.json();

    if (!email || !password || password.length < 6) {
      return NextResponse.json({ error: 'Invalid email or password (min 6 chars)' }, { status: 400 });
    }

    const normalized = email.toLowerCase().trim();

    // Check if user already exists
    const [existing] = await db.select().from(users).where(eq(users.email, normalized)).limit(1);
    if (existing) {
      return NextResponse.json({ error: 'Email already registered' }, { status: 409 });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const [user] = await db.insert(users).values({ email: normalized, passwordHash }).returning();

    return NextResponse.json({ id: user.id, email: user.email });
  } catch (err) {
    logger.error('POST /api/auth/signup failed', { error: (err as Error).message });
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
