/**
 * F078-T13: the shared-source limits in one dependency-free leaf module.
 *
 * The domain (`TABLE_LIMITS`' neighbours), the capability summary shown in the
 * UI, and the client's own pre-flight checks each typed these numbers by hand:
 * four slots, 32 KiB per file, 64 KiB per table. `domain/table.ts` re-exports
 * them so existing domain importers are unchanged, and the client imports this
 * leaf so a limit change cannot leave the UI blocking a file the server accepts.
 */

/** Source slots per table; imported files and verified web sources share them. */
export const MAX_TABLE_SOURCES = 4;

/** Largest single UTF-8 source file, in bytes. */
export const TABLE_FILE_BYTES = 32 * 1024;

/** Largest total of all source text on one table, in bytes. */
export const TABLE_TOTAL_SOURCE_BYTES = 64 * 1024;
