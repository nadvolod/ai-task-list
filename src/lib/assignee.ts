/**
 * Derive a default assignee display name from an email address.
 * e.g. "nikolay@example.com" → "Nikolay"
 */
export function defaultAssigneeFromEmail(email?: string | null): string | null {
  if (!email) return null;
  const prefix = email.split('@')[0];
  if (!prefix) return null;
  return prefix.charAt(0).toUpperCase() + prefix.slice(1);
}

/**
 * Normalize an assignee value: trim whitespace, treat blank as null.
 */
export function normalizeAssignee(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
