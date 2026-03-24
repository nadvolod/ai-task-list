import { getServerSession } from 'next-auth';
import { authOptions } from './auth';
import { NextRequest } from 'next/server';

export interface AuthResult {
  userId: number;
  email: string;
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
      const key = authHeader.slice(7);
      if (process.env.API_KEY && key === process.env.API_KEY) {
        const userId = parseInt(process.env.API_KEY_USER_ID || '0');
        const email = process.env.API_KEY_USER_EMAIL || 'api@service';
        return userId > 0 ? { userId, email } : null;
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
