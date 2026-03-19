// Priority scoring model
// Weights are designed so monetary/revenue tasks rank highest
const WEIGHTS = {
  monetary_value: 0.35,    // Protecting or generating money
  revenue_potential: 0.30, // Future revenue upside
  urgency: 0.20,           // How time-sensitive
  strategic_value: 0.15,   // Long-term importance
};

export interface PriorityInput {
  monetaryValue?: number | null;
  revenuePotential?: number | null;
  urgency?: number | null;       // 1-10
  strategicValue?: number | null; // 1-10
  userManualBoost?: number;       // 0-10
}

/**
 * Calculates a priority score 0-100 and returns a human-readable reason.
 */
export function calculatePriority(input: PriorityInput): {
  score: number;
  reason: string;
} {
  const reasons: string[] = [];
  let score = 0;

  // Monetary value: normalize to 0-10 using $10,000 as "10" ceiling
  const mvRaw = input.monetaryValue ?? 0;
  const mvNorm = Math.min(mvRaw / 1000, 10); // $1000 = 1 point, $10000+ = 10
  score += mvNorm * WEIGHTS.monetary_value * 10;

  // Revenue potential: normalize similarly
  const rpRaw = input.revenuePotential ?? 0;
  const rpNorm = Math.min(rpRaw / 1000, 10);
  score += rpNorm * WEIGHTS.revenue_potential * 10;

  // Urgency: already 1-10
  const urgNorm = input.urgency ?? 0;
  score += urgNorm * WEIGHTS.urgency * 10;

  // Strategic value: already 1-10
  const stNorm = input.strategicValue ?? 0;
  score += stNorm * WEIGHTS.strategic_value * 10;

  // Manual boost (user override)
  const boostNorm = input.userManualBoost ?? 0;
  score += boostNorm * 2; // up to +20 extra points

  // Cap at 100
  score = Math.min(Math.round(score), 100);

  // Build human-readable reason
  if (mvRaw > 0) {
    reasons.push(`protects or involves $${mvRaw.toLocaleString()}`);
  }
  if (rpRaw > 0) {
    reasons.push(`could generate $${rpRaw.toLocaleString()} in revenue`);
  }
  if ((input.urgency ?? 0) >= 7) {
    reasons.push('marked as urgent');
  }
  if ((input.strategicValue ?? 0) >= 7) {
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
