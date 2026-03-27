# Contributing to AI Task List

Thanks for your interest in contributing! This guide will help you get started.

## Development Setup

1. **Fork and clone the repository**
2. **Install dependencies:**
   ```bash
   npm install
   ```
3. **Set up environment variables:**
   ```bash
   cp .env.example .env.local
   # Edit .env.local with your own API keys and database URL
   ```
4. **Provision a database:**
   - Create a free Postgres database at [neon.tech](https://neon.tech)
   - Copy the connection string to `DATABASE_URL` in `.env.local`
5. **Run database migrations:**
   ```bash
   npm run db:migrate
   ```
6. **Seed sample data (optional):**
   ```bash
   npm run db:seed
   # Creates demo@example.com / demo1234
   ```
7. **Start the dev server:**
   ```bash
   npm run dev
   ```

## Running Tests

```bash
# Unit tests
npx vitest run tests/unit

# Integration tests (requires DATABASE_URL and API keys)
npx vitest run tests/integration

# E2E tests (requires all env vars + running server)
npm run test:e2e

# All tests with coverage
npm run test:coverage
```

### Testing Requirements

- **Tests must fail when API keys are missing.** Never use `describe.skipIf` or silent skips. Use `throw new Error('KEY_NAME is required')` in `beforeAll` instead.
- **Integration tests call real APIs.** Some tests validate prompt quality against real OpenAI/Gemini responses. These require valid API keys.
- **All API keys must be configured in CI.** If a test needs an API key, it must be in `.github/workflows/ci.yml` under the job's `env` section.

## Pull Request Process

1. Create a feature branch from `main` (`feature/your-feature` or `fix/your-fix`)
2. Make your changes
3. Ensure all tests pass and linting is clean:
   ```bash
   npm run lint
   npm run test
   ```
4. Push your branch and create a Pull Request against `main`
5. Fill out the PR template
6. Monitor CI -- all checks must pass before merge

## Code Style

- TypeScript with strict mode
- ESLint for linting (`npm run lint`)
- Tailwind CSS for styling
- Server Components by default, Client Components only when needed

## Reporting Issues

- Use the [bug report template](https://github.com/nadvolod/ai-task-list/issues/new?template=bug_report.md) for bugs
- Use the [feature request template](https://github.com/nadvolod/ai-task-list/issues/new?template=feature_request.md) for new ideas
- See [SECURITY.md](SECURITY.md) for reporting vulnerabilities
