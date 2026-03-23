import { pgTable, text, integer, real, timestamp, jsonb, serial } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const uploads = pgTable('uploads', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id),
  fileUrl: text('file_url'),
  extractedText: text('extracted_text'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const tasks = pgTable('tasks', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id),
  title: text('title').notNull(),
  description: text('description'),
  sourceType: text('source_type').notNull().default('manual'), // manual | image_upload | voice_context
  status: text('status').notNull().default('todo'), // todo | doing | done
  priorityScore: real('priority_score').notNull().default(0),
  priorityReason: text('priority_reason'),
  monetaryValue: real('monetary_value'),
  revenuePotential: real('revenue_potential'),
  urgency: integer('urgency'), // 1-10
  strategicValue: integer('strategic_value'), // 1-10
  manualOrder: integer('manual_order'),
  confidence: real('confidence'), // 0-1
  dueDate: timestamp('due_date'),
  // Subtask support (Issue #10) — FK constraint added via migration
  parentId: integer('parent_id'),
  subtaskOrder: integer('subtask_order'),
  // Recurrence support (Issue #9)
  recurrenceRule: text('recurrence_rule'), // 'daily' | 'weekly' | 'biweekly' | 'monthly' | null
  recurrenceDays: text('recurrence_days'), // comma-separated ISO weekdays: "1,3,5"
  recurrenceEndDate: timestamp('recurrence_end_date'),
  recurrenceParentId: integer('recurrence_parent_id'), // links instances in a recurrence chain
  recurrenceActive: text('recurrence_active').default('true'),
  // Category (Issue #13)
  category: text('category'), // user-defined category e.g. "Temporal", "Personal"
  // Assignee & priority override (Issue #11)
  assignee: text('assignee'),
  manualPriorityScore: real('manual_priority_score'),
  manualPriorityReason: text('manual_priority_reason'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const categoryBoosts = pgTable('category_boosts', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  category: text('category').notNull(),
  boost: integer('boost').notNull().default(0), // priority points added (e.g. +15)
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const priorityOverrides = pgTable('priority_overrides', {
  id: serial('id').primaryKey(),
  taskId: integer('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  userId: integer('user_id').notNull().references(() => users.id),
  previousScore: real('previous_score'),
  newScore: real('new_score'),
  reason: text('reason').notNull(),
  source: text('source').notNull().default('voice'), // 'voice' | 'manual'
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const taskEvents = pgTable('task_events', {
  id: serial('id').primaryKey(),
  taskId: integer('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  eventType: text('event_type').notNull(), // voice_note | image_extract | manual_edit
  rawInput: text('raw_input'),
  parsedOutput: jsonb('parsed_output'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
