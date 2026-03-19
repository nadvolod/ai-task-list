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

  // All tasks merged from both images, deduplicated
  const allTasks = [
    // Financial / Money Protection (highest priority)
    { title: 'Fight Venmo charge - $1,000', monetary_value: 1000, urgency: 9, strategic_value: 5, revenue_potential: null },
    { title: 'Email Emma to cancel lease & recover $4,800', monetary_value: 4800, urgency: 8, strategic_value: 6, revenue_potential: null },
    { title: 'Insurance payment + $4,300', monetary_value: 4300, urgency: 7, strategic_value: 5, revenue_potential: null },
    { title: 'End of spot - recover $500', monetary_value: 500, urgency: 6, strategic_value: 3, revenue_potential: null },
    { title: 'Monthly electric charge - $115', monetary_value: 115, urgency: 5, strategic_value: 2, revenue_potential: null },
    { title: 'Failed payment - Loan Depot', monetary_value: null, urgency: 9, strategic_value: 5, revenue_potential: null },
    { title: 'Failed payment - Penny Mac', monetary_value: null, urgency: 9, strategic_value: 5, revenue_potential: null },
    { title: 'Balance WHO contract - Discover CC - $7K', monetary_value: 7000, urgency: 7, strategic_value: 6, revenue_potential: null },

    // Revenue / Business (high priority)
    { title: 'Arts contract after March 31 - $12K', monetary_value: null, urgency: 8, strategic_value: 8, revenue_potential: 12000 },
    { title: "Tricor's course - $10K", monetary_value: null, urgency: 7, strategic_value: 8, revenue_potential: 10000 },
    { title: "Vitho webinar for Tricor's - $12K", monetary_value: null, urgency: 6, strategic_value: 7, revenue_potential: 12000 },
    { title: 'Flight sale opportunity - $78,000/yr', monetary_value: null, urgency: 5, strategic_value: 9, revenue_potential: 78000 },
    { title: 'New line for Devonshire - $75K', monetary_value: null, urgency: 5, strategic_value: 8, revenue_potential: 75000 },
    { title: 'Equity line for Devonshire', monetary_value: null, urgency: 5, strategic_value: 7, revenue_potential: null },

    // Insurance
    { title: 'Analyze all insurance quotes: Tier 2 - $60/mo', monetary_value: 720, urgency: 6, strategic_value: 6, revenue_potential: null },
    { title: 'Insurance Quotes - $3,600/yr - Andrea from All State', monetary_value: 3600, urgency: 5, strategic_value: 6, revenue_potential: null },
    { title: 'Home insurance for Devonshire - Soliant (emailed, waiting)', monetary_value: null, urgency: 5, strategic_value: 6, revenue_potential: null },

    // Medical / Professional
    { title: 'Dr Scott from Klarity - $125 (waiting for response)', monetary_value: 125, urgency: 6, strategic_value: 4, revenue_potential: null },
    { title: 'Get back from Dr - Klarity', monetary_value: null, urgency: 5, strategic_value: 4, revenue_potential: null },
    { title: 'Dan - Dept March', monetary_value: null, urgency: 6, strategic_value: 4, revenue_potential: null },

    // Property / Devonshire
    { title: 'Get bare bones steps in Devonshire', monetary_value: null, urgency: 5, strategic_value: 6, revenue_potential: null },
    { title: 'Log Dream steps', monetary_value: null, urgency: 4, strategic_value: 3, revenue_potential: null },
    { title: 'Other house stuff', monetary_value: null, urgency: 3, strategic_value: 3, revenue_potential: null },
    { title: 'Fence - Trunk', monetary_value: null, urgency: 3, strategic_value: 3, revenue_potential: null },
    { title: 'Apts $5,000 deposit info', monetary_value: 5000, urgency: 5, strategic_value: 5, revenue_potential: null },
    { title: '$5,000 deposit into ND', monetary_value: 5000, urgency: 5, strategic_value: 5, revenue_potential: null },

    // Work / Professional Development
    { title: 'Kasya auto-pay setup', monetary_value: null, urgency: 4, strategic_value: 3, revenue_potential: null },
    { title: 'NVIDIA interview prep', monetary_value: null, urgency: 7, strategic_value: 9, revenue_potential: null },
    { title: 'Virtuoso tutorial', monetary_value: null, urgency: 4, strategic_value: 5, revenue_potential: null },
    { title: 'Record', monetary_value: null, urgency: 4, strategic_value: 4, revenue_potential: null },
    { title: 'Plan new set of Nlog Playr + Devonshire', monetary_value: null, urgency: 4, strategic_value: 5, revenue_potential: null },
    { title: 'Finalize YT quality checklist for Temporal', monetary_value: null, urgency: 6, strategic_value: 7, revenue_potential: null },
    { title: 'Temporal Replay conference', monetary_value: null, urgency: 5, strategic_value: 6, revenue_potential: null },

    // CC / Balance
    { title: 'Propose to Discover (balance)', monetary_value: null, urgency: 4, strategic_value: 3, revenue_potential: null },
    { title: 'New base hotel - waiting for CC info', monetary_value: null, urgency: 4, strategic_value: 3, revenue_potential: null },

    // Misc
    { title: 'New skate straps', monetary_value: null, urgency: 2, strategic_value: 1, revenue_potential: null },
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
