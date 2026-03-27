# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in this project, please report it responsibly.

**Do NOT open a public GitHub issue for security vulnerabilities.**

Instead, please use [GitHub Security Advisories](https://github.com/nadvolod/ai-task-list/security/advisories/new) to report vulnerabilities privately.

### What to include

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

### Response timeline

- **Acknowledgment**: Within 48 hours
- **Initial assessment**: Within 1 week
- **Fix or mitigation**: As soon as possible, depending on severity

## Security Best Practices for Contributors

- Never commit API keys, database credentials, or secrets to the repository
- Use `.env.local` for local secrets (it is gitignored)
- Copy `.env.example` to `.env.local` and fill in your own credentials
- Rotate any credentials that may have been accidentally exposed
