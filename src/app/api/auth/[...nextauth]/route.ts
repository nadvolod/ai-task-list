import NextAuth from 'next-auth';
import { authOptions } from '@/lib/auth';
import { logger } from '@/lib/logger';

logger.info('NextAuth handler initialized');

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
