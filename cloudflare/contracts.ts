/** Runtime bindings. Secret values are supplied by the host, never by the browser. */
export interface Env {
  DB: D1Database;
  ROOMS: DurableObjectNamespace;
  BILLING: DurableObjectNamespace;
  ASSETS: Fetcher;
  FILES?: R2Bucket;
  PUBLIC_ORIGIN: string;
  GOOGLE_OAUTH_CLIENT_ID?: string;
  GOOGLE_OAUTH_CLIENT_SECRET?: string;
  TABLETOP_ADMIN_EMAIL?: string;
  DEEPSEEK_KEY?: string;
  AI_MONTHLY_BUDGET_MICRO_USD?: string;
  AI_DAILY_BUDGET_MICRO_USD?: string;
  TABLE_READ_ONLY?: string;
}

export interface Account {
  id: string;
  name: string;
  email: string;
  isAdmin: boolean;
}

export interface DirectoryReference {
  room_id: string;
  epoch: number;
}

export const GOOGLE_CALLBACK_PATH = '/api/auth/google/callback';
export const SESSION_IDLE_MS = 24 * 60 * 60 * 1000;
export const SESSION_HARD_MS = 7 * 24 * 60 * 60 * 1000;
export const OAUTH_TTL_MS = 10 * 60 * 1000;
