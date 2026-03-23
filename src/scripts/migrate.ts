import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();
import { neon } from '@neondatabase/serverless';

// Run the database migration by creating tables if they don't exist
async function migrate() {
  const sql = neon(process.env.DATABASE_URL!);

  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS uploads (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      file_url TEXT,
      extracted_text TEXT,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS tasks (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      title TEXT NOT NULL,
      description TEXT,
      source_type TEXT NOT NULL DEFAULT 'manual',
      status TEXT NOT NULL DEFAULT 'todo',
      priority_score REAL NOT NULL DEFAULT 0,
      priority_reason TEXT,
      monetary_value REAL,
      revenue_potential REAL,
      urgency INTEGER,
      strategic_value INTEGER,
      manual_order INTEGER,
      confidence REAL,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW() NOT NULL
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS task_events (
      id SERIAL PRIMARY KEY,
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      raw_input TEXT,
      parsed_output JSONB,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL
    )
  `;

  // Migration: add due_date column
  await sql`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS due_date TIMESTAMP`;

  // Migration: update existing FK to add ON DELETE CASCADE
  await sql`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'task_events_task_id_tasks_id_fk'
        AND table_name = 'task_events'
      ) THEN
        ALTER TABLE task_events DROP CONSTRAINT task_events_task_id_tasks_id_fk;
        ALTER TABLE task_events ADD CONSTRAINT task_events_task_id_tasks_id_fk
          FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE;
      END IF;
    END $$
  `;

  // Migration: subtask support (Issue #10)
  await sql`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS parent_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE`;
  await sql`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS subtask_order INTEGER`;
  await sql`CREATE INDEX IF NOT EXISTS idx_tasks_parent_id ON tasks(parent_id)`;

  // Migration: recurrence support (Issue #9)
  await sql`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS recurrence_rule TEXT`;
  await sql`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS recurrence_days TEXT`;
  await sql`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS recurrence_end_date TIMESTAMP`;
  await sql`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS recurrence_parent_id INTEGER`;
  await sql`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS recurrence_active TEXT DEFAULT 'true'`;

  // Migration: assignee & priority override (Issue #11)
  await sql`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS assignee TEXT`;
  await sql`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS manual_priority_score REAL`;
  await sql`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS manual_priority_reason TEXT`;

  // Migration: priority overrides tracking table (Issue #11)
  await sql`
    CREATE TABLE IF NOT EXISTS priority_overrides (
      id SERIAL PRIMARY KEY,
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id),
      previous_score REAL,
      new_score REAL,
      reason TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'voice',
      created_at TIMESTAMP DEFAULT NOW() NOT NULL
    )
  `;

  // Migration: task categories with priority boost (Issue #13)
  await sql`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS category TEXT`;
  await sql`
    CREATE TABLE IF NOT EXISTS category_boosts (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      category TEXT NOT NULL,
      boost INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL
    )
  `;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_category_boosts_user_category ON category_boosts(user_id, category)`;

  console.log('Migration complete!');
}

migrate().catch(console.error);
