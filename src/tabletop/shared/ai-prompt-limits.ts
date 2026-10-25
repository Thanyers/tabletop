/**
 * F078-T13: the two AI prompt caps in one dependency-free leaf module.
 *
 * They are separate limits with separate owners — a rule draft is not the table
 * assistant — but each used to be re-typed as `4_000`/`4000` in the contract
 * schemas, the Worker routes, the job repository and the provider schemas. A leaf
 * module has no imports, so Worker startup can read it without an import cycle
 * (the same reason `ai-request-limits.ts` exists).
 */

/** Longest rule-draft prompt (characters) a member may send to the model. */
export const MAX_DRAFT_PROMPT_CHARS = 4_000;

/** Longest table-assistant prompt (characters) a member may send. */
export const MAX_ASSISTANT_PROMPT_CHARS = 4_000;
