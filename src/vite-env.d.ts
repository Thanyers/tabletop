/// <reference types="vite/client" />

/** Build identity baked in by vite.config.ts; the same object as /version. */
declare const __TABLETOP_BUILD__: { version: string; sha: string; built_at: string } | undefined;
