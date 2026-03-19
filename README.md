# AI Task List Creator

A mobile-first intelligent task capture and prioritization system. Upload an image of your task list, use voice notes to add context, and let AI rank tasks by monetary impact and strategic value.

## Architecture

- **Framework**: Next.js 16 (App Router, TypeScript)
- **Database**: Neon Postgres with Drizzle ORM
- **Auth**: NextAuth.js with email/password credentials
- **AI**: OpenAI GPT-4o (vision extraction) + Whisper (voice transcription) + GPT-4o-mini (structured parsing)
- **Deployment**: Vercel (serverless-friendly)

### Priority Scoring Formula

```
score = monetary_value_norm(0-10) × 0.35 × 10
      + revenue_potential_norm(0-10) × 0.30 × 10
      + urgency(1-10) × 0.20 × 10
      + strategic_value(1-10) × 0.15 × 10
```

Where `monetary_value_norm = min(monetary_value / 1000, 10)` — so $1,000 = 1 point, $10,000+ = 10 points (max). Score is capped at 100.

### App Routes

| Route | Description |
|-------|-------------|
| `/` | Redirects to tasks or sign-in |
| `/auth/signin` | Sign in |
| `/auth/signup` | Create account |
| `/tasks` | Main task list (sorted by priority) |
| `/tasks/new` | Add a manual task |
| `/tasks/[id]` | Edit task, record voice note |
| `/upload` | Upload image and extract tasks |

### API Routes

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/auth/signup` | POST | Create user account |
| `/api/auth/[...nextauth]` | GET/POST | NextAuth handlers |
| `/api/tasks` | GET | List tasks (sorted by priority) |
| `/api/tasks` | POST | Create task |
| `/api/tasks/[id]` | PATCH | Update task (recalculates priority) |
| `/api/tasks/[id]` | DELETE | Delete task |
| `/api/tasks/[id]/voice` | POST | Transcribe voice note, update priority |
| `/api/upload` | POST | Upload image, extract tasks |

## Environment Variables

```env
DATABASE_URL=postgresql://user:password@host/dbname?sslmode=require
NEXTAUTH_SECRET=your-secret-here-generate-with-openssl-rand-base64-32
NEXTAUTH_URL=http://localhost:3000
OPENAI_API_KEY=sk-...
```

## Local Setup

1. **Clone the repo and install dependencies:**
   ```bash
   git clone <repo-url>
   cd ai-task-list
   npm install
   ```

2. **Set up environment variables:**
   ```bash
   cp .env.example .env.local
   # Edit .env.local with your actual values
   ```

3. **Provision a Neon Postgres database:**
   - Go to [neon.tech](https://neon.tech) and create a free project
   - Copy the connection string to `DATABASE_URL`

4. **Run database migration:**
   ```bash
   npm run db:migrate
   ```

5. **Seed sample data (optional):**
   ```bash
   npm run db:seed
   # Creates demo@example.com / demo1234
   ```

6. **Start the development server:**
   ```bash
   npm run dev
   ```

7. Open [http://localhost:3000](http://localhost:3000)

## Deploy to Vercel

1. Push the repo to GitHub.
2. Import the project in [Vercel](https://vercel.com).
3. Add environment variables in the Vercel dashboard:
   - `DATABASE_URL`
   - `NEXTAUTH_SECRET` (generate: `openssl rand -base64 32`)
   - `NEXTAUTH_URL` (set to your Vercel domain, e.g., `https://ai-task-list.vercel.app`)
   - `OPENAI_API_KEY`
4. Deploy. Vercel will automatically run `npm run build`.
5. After first deploy, run `npm run db:migrate` locally pointing at the production DB.

## Future Enhancements (not in V1)

- Team/collaboration features
- Push notifications
- Calendar integration
- Email/SMS reminders
- Native mobile app
- Advanced analytics
- Billing/subscription
- Subtasks
- Labels, tags, projects
- Offline mode
- AI chat assistant
- Bulk import / CSV export
