import { vi } from 'vitest';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

// Mock next-auth - must provide default export since auth.ts does `export default NextAuth(authOptions)`
vi.mock('next-auth', () => {
  return {
    default: vi.fn(() => ({})),
    getServerSession: vi.fn(),
  };
});

export { vi };
