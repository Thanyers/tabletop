import { toolPackageContentCanonical, validateToolPackage, type ToolPackageDefinition } from '../shared/tool-package';

/**
 * F080 / D-051: turn the package JSON a person pastes into an `space.installTool` payload.
 *
 * The hash is derived here, never typed by hand: the Worker recomputes it and refuses a mismatch, so a
 * panel that let someone type it would only produce refusals. This stays a pure function so the rules
 * can be tested without a browser.
 */

export interface ToolInstallTool {
  packageId: string;
  version: number;
  contentHash: string;
  route: 'human' | 'ai';
  title: string;
  definition: ToolPackageDefinition;
}

export type ToolInstallInput = { ok: true; tool: ToolInstallTool } | { ok: false; problem: string };

/** SHA-256 of the canonical package text, as hex. */
export async function toolPackageHashHex(definition: ToolPackageDefinition): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(toolPackageContentCanonical(definition)));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Parse and validate what the person pasted, before any hash exists. */
export function readToolPackageJson(text: string): { ok: true; definition: ToolPackageDefinition } | { ok: false; problem: string } {
  if (text.trim().length === 0) return { ok: false, problem: 'วาง JSON ของ package ก่อน' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, problem: 'ข้อความนี้ไม่ใช่ JSON ที่อ่านได้' };
  }
  const validation = validateToolPackage(parsed);
  if (!validation.ok) {
    const first = validation.problems[0];
    return {
      ok: false,
      problem: `package ไม่ผ่านการตรวจ: ${first ? `${first.path}: ${first.message}` : 'โครงสร้างไม่ถูกต้อง'}`,
    };
  }
  return { ok: true, definition: validation.package };
}

export async function buildToolInstallInput(text: string): Promise<ToolInstallInput> {
  const read = readToolPackageJson(text);
  if (!read.ok) return read;
  const definition = read.definition;
  return {
    ok: true,
    tool: {
      packageId: definition.packageId,
      version: definition.version,
      contentHash: await toolPackageHashHex(definition),
      // The package records where it came from; the room keeps that for its own audit line.
      route: definition.provenance.origin === 'human' ? 'human' : 'ai',
      title: definition.title,
      definition,
    },
  };
}
