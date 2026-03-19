import OpenAI from 'openai';

export interface PriorityInput {
  title?: string;
  description?: string | null;
  monetaryValue?: number | null;
  revenuePotential?: number | null;
  urgency?: number | null;       // 1-10
  strategicValue?: number | null; // 1-10
  userManualBoost?: number;       // 0-10
}

export interface PriorityResult {
  score: number;
  reason: string;
}

/**
 * AI-based priority scoring using GPT-4o-mini.
 * Falls back to local calculation if AI is unavailable.
 */
export async function calculatePriorityAI(input: PriorityInput): Promise<PriorityResult> {
  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const taskDescription = [
      input.title ? `Title: ${input.title}` : null,
      input.description ? `Description: ${input.description}` : null,
      input.monetaryValue != null ? `Monetary value at stake: $${input.monetaryValue}` : null,
      input.revenuePotential != null ? `Revenue potential: $${input.revenuePotential}` : null,
      input.urgency != null ? `Urgency: ${input.urgency}/10` : null,
      input.strategicValue != null ? `Strategic value: ${input.strategicValue}/10` : null,
    ].filter(Boolean).join('\n');

    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 200,
      temperature: 0.3,
      messages: [
        {
          role: 'system',
          content: `You are a task prioritization engine. Given a task's details, assign a priority score from 0 to 100 and a short one-sentence explanation.

Scoring guidelines:
- Tasks that protect or involve real money should score highest (70-100)
- Tasks with revenue potential should score high (50-90)
- Urgent tasks get a boost (+10-20 points)
- Strategic/long-term value tasks score moderately (30-60)
- Tasks with no financial or strategic upside score low (0-30)
- If a manual boost is provided, add up to 20 points

Return ONLY valid JSON: { "score": number, "reason": "one sentence" }`,
        },
        {
          role: 'user',
          content: taskDescription || 'No details provided for this task.',
        },
      ],
    });

    const content = response.choices[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(content.match(/\{[\s\S]*\}/)?.[0] ?? '{}');

    let score = Math.min(Math.max(Math.round(parsed.score ?? 0), 0), 100);
    const boost = Math.min(Math.max(input.userManualBoost ?? 0, 0), 10);
    score = Math.min(score + boost * 2, 100);

    return {
      score,
      reason: parsed.reason || 'Priority assessed by AI.',
    };
  } catch (err) {
    console.error('AI priority scoring failed, using fallback:', err);
    return calculatePriorityFallback(input);
  }
}

/**
 * Local fallback priority scoring (no AI needed).
 * Used when AI is unavailable, in tests, and in seed scripts.
 */
export function calculatePriorityFallback(input: PriorityInput): PriorityResult {
  const reasons: string[] = [];
  let score = 0;

  const mvRaw = Math.max(input.monetaryValue ?? 0, 0);
  const mvNorm = Math.min(mvRaw / 1000, 10);
  score += mvNorm * 3.5;

  const rpRaw = Math.max(input.revenuePotential ?? 0, 0);
  const rpNorm = Math.min(rpRaw / 1000, 10);
  score += rpNorm * 3.0;

  const urgNorm = Math.max(Math.min(input.urgency ?? 0, 10), 0);
  score += urgNorm * 2.0;

  const stNorm = Math.max(Math.min(input.strategicValue ?? 0, 10), 0);
  score += stNorm * 1.5;

  const boostNorm = Math.max(Math.min(input.userManualBoost ?? 0, 10), 0);
  score += boostNorm * 2;

  score = Math.min(Math.round(score), 100);

  if (mvRaw > 0) {
    reasons.push(`protects or involves $${mvRaw.toLocaleString()}`);
  }
  if (rpRaw > 0) {
    reasons.push(`could generate $${rpRaw.toLocaleString()} in revenue`);
  }
  if (urgNorm >= 7) {
    reasons.push('marked as urgent');
  }
  if (stNorm >= 7) {
    reasons.push('high strategic value');
  }

  let reason: string;
  if (reasons.length === 0) {
    reason = 'Lower priority: no clear financial or strategic upside identified.';
  } else {
    reason = `Higher priority because it ${reasons.join(', and ')}.`;
  }

  return { score, reason };
}
