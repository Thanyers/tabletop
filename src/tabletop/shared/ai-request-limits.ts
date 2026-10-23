// F066: AI rule-request limits in a module with no imports. Worker startup evaluates modules in bundle order, and
// these constants are read at module level by the provider, the AI helper and billing; a leaf module is always
// initialised before them, so no import cycle can leave a limit undefined.

/**
 * The table part of one AI rule request (prompt, files, rules, rows, turn, notes as JSON): the whole 64 KiB file
 * allowance plus the same again for the current rules, rows and message.
 */
export const TABLE_AI_INPUT_BYTES = 128 * 1024;
/** The whole request: the table input plus room for the system prompt (< 20,000 characters, tested) and envelope. */
export const MAX_CHANGE_REQUEST_BYTES = TABLE_AI_INPUT_BYTES + 32 * 1024;
/** Added to a measured request when reserving input tokens. */
export const TABLE_REQUEST_TOKEN_MARGIN = 1_000;
/** One byte is at most one token, so this reservation covers the largest request. */
export const MAX_REQUEST_INPUT_TOKENS = MAX_CHANGE_REQUEST_BYTES + TABLE_REQUEST_TOKEN_MARGIN;
