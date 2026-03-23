Follow agent instructions here:
https://gist.github.com/nadvolod/6604ff221b057bf31860ac288ae162b9

## Testing Rules

- **Never skip tests when an API key is missing.** Tests must FAIL if required API keys (OPENAI_API_KEY, GOOGLE_API_KEY, DATABASE_URL, etc.) are not set. Use `throw new Error('KEY_NAME is required')` in `beforeAll` instead of `describe.skipIf`. Silent skips hide broken CI.
- **All API keys must be configured in CI secrets.** If a test needs an API key, that key must be in `.github/workflows/ci.yml` under the job's `env` section, referencing `${{ secrets.KEY_NAME }}`.
- **Real API integration tests are required.** At least some tests for each AI feature must call the real API (OpenAI, Gemini) — not just mocks. Mocked tests validate route handler logic; real API tests validate prompt quality and model behavior.

## Workflow Rules

- **Always commit into a PR and monitor CI.** After implementing any feature or fix, immediately create a branch, commit, push, create a PR, and monitor CI. Never leave work uncommitted.
