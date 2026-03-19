import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();
import { neon } from '@neondatabase/serverless';
import bcrypt from 'bcryptjs';

async function seed() {
  const sql = neon(process.env.DATABASE_URL!);

  // Create a demo user
  const passwordHash = await bcrypt.hash('demo1234', 12);
  const [user] = await sql`
    INSERT INTO users (email, password_hash)
    VALUES ('demo@example.com', ${passwordHash})
    ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash
    RETURNING id
  `;

  const userId = user.id;

  // Seed sample tasks with varied priority data
  const sampleTasks = [
    {
      title: 'Dispute fraudulent Venmo charge',
      description: 'Someone made an unauthorized charge of $1,000 on my Venmo account.',
      source_type: 'manual',
      monetary_value: 1000,
      revenue_potential: null,
      urgency: 9,
      strategic_value: 5,
    },
    {
      title: 'Launch new SaaS product landing page',
      description: 'Create landing page for the new product that could generate significant revenue.',
      source_type: 'manual',
      monetary_value: null,
      revenue_potential: 5000,
      urgency: 7,
      strategic_value: 9,
    },
    {
      title: 'Write blog post about time management',
      description: 'Personal development content, no direct financial impact.',
      source_type: 'manual',
      monetary_value: null,
      revenue_potential: null,
      urgency: 3,
      strategic_value: 4,
    },
    {
      title: 'Fix critical bug in production',
      description: 'Bug causing checkout failures, losing ~$500/day in revenue.',
      source_type: 'manual',
      monetary_value: 500,
      revenue_potential: 500,
      urgency: 10,
      strategic_value: 8,
    },
    {
      title: 'Schedule dentist appointment',
      description: 'Routine checkup, no financial urgency.',
      source_type: 'manual',
      monetary_value: null,
      revenue_potential: null,
      urgency: 4,
      strategic_value: 2,
    },
  ];

  for (const task of sampleTasks) {
    // Calculate priority score
    const mvNorm = Math.min((task.monetary_value ?? 0) / 1000, 10);
    const rpNorm = Math.min((task.revenue_potential ?? 0) / 1000, 10);
    const urgNorm = task.urgency ?? 0;
    const stNorm = task.strategic_value ?? 0;
    const score = Math.min(
      Math.round(
        mvNorm * 0.35 * 10 +
        rpNorm * 0.30 * 10 +
        urgNorm * 0.20 * 10 +
        stNorm * 0.15 * 10
      ),
      100
    );

    let reason = 'Lower priority: no clear financial or strategic upside identified.';
    const reasons = [];
    if ((task.monetary_value ?? 0) > 0) reasons.push(`protects or involves $${task.monetary_value!.toLocaleString()}`);
    if ((task.revenue_potential ?? 0) > 0) reasons.push(`could generate $${task.revenue_potential!.toLocaleString()} in revenue`);
    if ((task.urgency ?? 0) >= 7) reasons.push('marked as urgent');
    if ((task.strategic_value ?? 0) >= 7) reasons.push('high strategic value');
    if (reasons.length > 0) reason = `Higher priority because it ${reasons.join(', and ')}.`;

    await sql`
      INSERT INTO tasks (user_id, title, description, source_type, monetary_value, revenue_potential, urgency, strategic_value, priority_score, priority_reason)
      VALUES (
        ${userId},
        ${task.title},
        ${task.description},
        ${task.source_type},
        ${task.monetary_value},
        ${task.revenue_potential},
        ${task.urgency},
        ${task.strategic_value},
        ${score},
        ${reason}
      )
    `;
  }

  console.log('Seed complete! Demo user: demo@example.com / demo1234');
}

seed().catch(console.error);
