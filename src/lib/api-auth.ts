import { getServerSession } from 'next-auth';
import { authOptions } from './auth';
import { NextRequest } from 'next/server';
import { timingSafeEqual } from 'crypto';

export interface AuthResult {
  userId: number;
  email: string;
}

function constantTimeEqual(a: string, b: string): boolean {
  try {
    const bufA = Buffer.from(a, 'utf8');
    const bufB = Buffer.from(b, 'utf8');
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

/**
 * Get authenticated user from either:
 * 1. API key (Authorization: Bearer <key>) — for server-to-server calls
 * 2. NextAuth session — for browser-based calls
 *
 * Returns { userId, email } or null if unauthorized.
 */
export async function getAuthUser(req?: NextRequest): Promise<AuthResult | null> {
  // Check API key first
  if (req) {
    const authHeader = req.headers.get('authorization');
    if (authHeader?.startsWith('Bearer ')) {
      const key = authHeader.slice(7).trim();
      const configuredKey = process.env.API_KEY;

      if (configuredKey && constantTimeEqual(key, configuredKey)) {
        const rawUserId = process.env.API_KEY_USER_ID;
        if (!rawUserId) {
          console.error('API key auth misconfigured: API_KEY_USER_ID is not set');
          return null;
        }
        const userId = Number.parseInt(rawUserId, 10);
        if (!Number.isFinite(userId) || userId <= 0) {
          console.error('API key auth misconfigured: API_KEY_USER_ID must be a positive integer');
          return null;
        }
        const email = process.env.API_KEY_USER_EMAIL;
        if (!email) {
          console.error('API key auth misconfigured: API_KEY_USER_EMAIL is not set');
          return null;
        }
        return { userId, email };
      }
    }
  }

  // Fall back to NextAuth session
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return null;
  return {
    userId: parseInt(session.user.id),
    email: session.user.email || ''
  };
}
