/**
 * Who sees what inside a table (F034).
 * - 'open': every member sees the whole table state and every member's AI chat. Current product rule (2026-10-21).
 * - 'private': role projections (owner-only drafts, DM/teacher notes, hidden rolls, own answers) and
 *   actor-private AI chats. Kept intact so the rule can be switched back or extended later.
 * Membership is required under both policies.
 */
export type VisibilityPolicy = 'open' | 'private';

export const VISIBILITY_POLICY: VisibilityPolicy = 'open';
