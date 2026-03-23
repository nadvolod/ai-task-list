import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./tests/helpers/setup.ts'],
    exclude: ['tests/e2e/**', 'node_modules/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary', 'html'],
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: ['src/types/**', 'src/scripts/**', 'src/app/**/page.tsx', 'src/app/**/layout.tsx', 'src/components/**', 'src/app/**/*Client.tsx', 'src/app/api/voice-capture/**', 'src/app/api/voice-command/**', 'src/app/api/tasks/*/voice/**', 'src/app/api/auth/\\[...nextauth\\]/**', 'src/app/api/health/**', 'src/lib/auth.ts', 'src/lib/ai.ts'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
