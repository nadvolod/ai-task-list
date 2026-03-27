import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

import { neon } from '@neondatabase/serverless';

async function seedFromImages() {
  const sql = neon(process.env.DATABASE_URL!);

  // Get demo user ID
  const [user] = await sql`SELECT id FROM users WHERE email = 'demo@example.com'`;
  if (!user) {
    console.error('Demo user not found. Run db:seed first.');
    process.exit(1);
  }
  const userId = user.id;

  // Delete all existing tasks for this user to remove duplicates
  await sql`DELETE FROM task_events WHERE task_id IN (SELECT id FROM tasks WHERE user_id = ${userId})`;
  await sql`DELETE FROM tasks WHERE user_id = ${userId}`;
  await sql`DELETE FROM uploads WHERE user_id = ${userId}`;
  console.log('Cleared existing tasks for demo user.');

  // Sample tasks covering various priority scoring patterns
  const allTasks = [
    // Financial / Money Protection (highest priority)
    { title: 'Dispute unauthorized charge - $1,000', monetary_value: 1000, urgency: 9, strategic_value: 5, revenue_potential: null },
    { title: 'Cancel lease & recover security deposit - $4,800', monetary_value: 4800, urgency: 8, strategic_value: 6, revenue_potential: null },
    { title: 'Process insurance reimbursement - $4,300', monetary_value: 4300, urgency: 7, strategic_value: 5, revenue_potential: null },
    { title: 'Recover parking deposit - $500', monetary_value: 500, urgency: 6, strategic_value: 3, revenue_potential: null },
    { title: 'Review monthly utility bill - $115', monetary_value: 115, urgency: 5, strategic_value: 2, revenue_potential: null },
    { title: 'Resolve failed mortgage payment', monetary_value: null, urgency: 9, strategic_value: 5, revenue_potential: null },
    { title: 'Fix failed auto-loan payment', monetary_value: null, urgency: 9, strategic_value: 5, revenue_potential: null },
    { title: 'Pay off credit card balance - $7K', monetary_value: 7000, urgency: 7, strategic_value: 6, revenue_potential: null },

    // Revenue / Business (high priority)
    { title: 'Finalize consulting contract - $12K', monetary_value: null, urgency: 8, strategic_value: 8, revenue_potential: 12000 },
    { title: 'Launch online course - $10K', monetary_value: null, urgency: 7, strategic_value: 8, revenue_potential: 10000 },
    { title: 'Host partner webinar - $12K', monetary_value: null, urgency: 6, strategic_value: 7, revenue_potential: 12000 },
    { title: 'Pursue enterprise sales lead - $78K/yr', monetary_value: null, urgency: 5, strategic_value: 9, revenue_potential: 78000 },
    { title: 'Open new credit line for rental property - $75K', monetary_value: null, urgency: 5, strategic_value: 8, revenue_potential: 75000 },
    { title: 'Research equity line options for rental property', monetary_value: null, urgency: 5, strategic_value: 7, revenue_potential: null },

    // Insurance
    { title: 'Compare insurance quotes: Tier 2 - $60/mo', monetary_value: 720, urgency: 6, strategic_value: 6, revenue_potential: null },
    { title: 'Review home insurance quotes - $3,600/yr', monetary_value: 3600, urgency: 5, strategic_value: 6, revenue_potential: null },
    { title: 'Follow up on rental property insurance (waiting on agent)', monetary_value: null, urgency: 5, strategic_value: 6, revenue_potential: null },

    // Medical / Professional
    { title: 'Follow up with specialist - $125 copay', monetary_value: 125, urgency: 6, strategic_value: 4, revenue_potential: null },
    { title: 'Schedule follow-up appointment', monetary_value: null, urgency: 5, strategic_value: 4, revenue_potential: null },
    { title: 'Submit expense report by end of month', monetary_value: null, urgency: 6, strategic_value: 4, revenue_potential: null },

    // Property
    { title: 'Get renovation cost estimates', monetary_value: null, urgency: 5, strategic_value: 6, revenue_potential: null },
    { title: 'Document project milestones', monetary_value: null, urgency: 4, strategic_value: 3, revenue_potential: null },
    { title: 'Schedule home maintenance', monetary_value: null, urgency: 3, strategic_value: 3, revenue_potential: null },
    { title: 'Get fence repair quotes', monetary_value: null, urgency: 3, strategic_value: 3, revenue_potential: null },
    { title: 'Research apartment deposit terms - $5,000', monetary_value: 5000, urgency: 5, strategic_value: 5, revenue_potential: null },
    { title: 'Transfer $5,000 deposit to savings', monetary_value: 5000, urgency: 5, strategic_value: 5, revenue_potential: null },

    // Work / Professional Development
    { title: 'Set up auto-pay for subscriptions', monetary_value: null, urgency: 4, strategic_value: 3, revenue_potential: null },
    { title: 'Prepare for tech interview', monetary_value: null, urgency: 7, strategic_value: 9, revenue_potential: null },
    { title: 'Complete online tutorial', monetary_value: null, urgency: 4, strategic_value: 5, revenue_potential: null },
    { title: 'Record demo video', monetary_value: null, urgency: 4, strategic_value: 4, revenue_potential: null },
    { title: 'Plan content calendar for next month', monetary_value: null, urgency: 4, strategic_value: 5, revenue_potential: null },
    { title: 'Finalize video quality checklist', monetary_value: null, urgency: 6, strategic_value: 7, revenue_potential: null },
    { title: 'Prepare conference talk proposal', monetary_value: null, urgency: 5, strategic_value: 6, revenue_potential: null },

    // Payments / Balance
    { title: 'Negotiate lower credit card rate', monetary_value: null, urgency: 4, strategic_value: 3, revenue_potential: null },
    { title: 'Update payment method for hotel booking', monetary_value: null, urgency: 4, strategic_value: 3, revenue_potential: null },

    // Misc
    { title: 'Order replacement sports gear', monetary_value: null, urgency: 2, strategic_value: 1, revenue_potential: null },
  ];

  console.log(`Inserting ${allTasks.length} tasks...`);

  for (const task of allTasks) {
    await sql`
      INSERT INTO tasks (user_id, title, source_type, monetary_value, revenue_potential, urgency, strategic_value, priority_score, priority_reason, status)
      VALUES (
        ${userId},
        ${task.title},
        'image_upload',
        ${task.monetary_value},
        ${task.revenue_potential},
        ${task.urgency},
        ${task.strategic_value},
        0,
        'Pending AI scoring',
        'todo'
      )
    `;
  }

  console.log(`Inserted ${allTasks.length} tasks. Now scoring with AI...`);

  // Re-score all tasks via the app's API would require running server
  // Instead, use the fallback scoring here
  const tasks = await sql`SELECT id, title, monetary_value, revenue_potential, urgency, strategic_value FROM tasks WHERE user_id = ${userId}`;

  for (const t of tasks) {
    const mvRaw = Math.max(t.monetary_value ?? 0, 0);
    const rpRaw = Math.max(t.revenue_potential ?? 0, 0);
    const urgNorm = Math.max(Math.min(t.urgency ?? 0, 10), 0);
    const stNorm = Math.max(Math.min(t.strategic_value ?? 0, 10), 0);

    const mvN = Math.min(mvRaw / 1000, 10);
    const rpN = Math.min(rpRaw / 1000, 10);
    const score = Math.min(Math.round(mvN * 3.5 + rpN * 3.0 + urgNorm * 2.0 + stNorm * 1.5), 100);

    const reasons: string[] = [];
    if (mvRaw > 0) reasons.push(`protects or involves $${mvRaw.toLocaleString()}`);
    if (rpRaw > 0) reasons.push(`could generate $${rpRaw.toLocaleString()} in revenue`);
    if (urgNorm >= 7) reasons.push('marked as urgent');
    if (stNorm >= 7) reasons.push('high strategic value');
    const reason = reasons.length === 0
      ? 'Lower priority: no clear financial or strategic upside identified.'
      : `Higher priority because it ${reasons.join(', and ')}.`;

    await sql`UPDATE tasks SET priority_score = ${score}, priority_reason = ${reason} WHERE id = ${t.id}`;
  }

  console.log('All tasks scored. Done!');
}

seedFromImages().catch(console.error);
