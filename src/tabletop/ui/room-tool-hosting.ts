import type { SpaceToolInstallation } from '../shared/collaboration-space';
import { TOOL_PACKAGE_LIMITS, type ToolPackageDefinition } from '../shared/tool-package';
import { TOOL_BRIDGE_LIMITS, type ToolPortSnapshot, type ToolPresentation } from '../shared/tool-protocol';
import { compileToolPackage, type CompiledToolPackage, type ToolCompileProblem } from '../runtime/tools/compile';
import type { JoinedSource } from './JoinedProjectionView';

/**
 * F080 / D-040: what the room hands to `GeneratedToolHost`.
 *
 * The screen owns three questions when it mounts the tool it installed: can this package compile, what
 * may the frame see of the room's data, and what identity does this mount have. They live here as pure
 * functions so the answers are checkable without a browser: the component only reads the clock-free
 * inputs (installed reference, joined sources, the page's locale and motion preference).
 *
 * Nothing in this module writes. The only mutation a tool can ask for is the intent route, and that
 * commits through the room's ordinary action path (D-033).
 */

export type RoomToolCompile =
  | { state: 'none' }
  | { state: 'failed'; problems: readonly ToolCompileProblem[] }
  | { state: 'ready'; compiled: CompiledToolPackage };

/**
 * Compile the package the room installed.
 *
 * The compiler is synchronous (Sucrase), so there is no "still compiling" render: a definition either
 * produces modules in this render or it does not. The hash callback returns the hash the room stored,
 * which is the value the Worker proved before the install command was applied (D-037) — so the compiled
 * content hash equals the installed one by construction, and a mismatch cannot be papered over here.
 */
export function compileRoomTool(tool: SpaceToolInstallation | undefined): RoomToolCompile {
  const definition = tool?.definition;
  if (!tool || !definition) return { state: 'none' };
  if (definition.packageId !== tool.packageId || definition.version !== tool.version) {
    // Rendering it anyway would show a package the room never installed.
    return {
      state: 'failed',
      problems: [{
        code: 'TOOL_COMPILE_SOURCE',
        path: 'space.tool',
        message: 'The installed package does not match the tool reference.',
      }],
    };
  }
  const result = compileToolPackage(definition, () => tool.contentHash);
  return result.ok ? { state: 'ready', compiled: result.compiled } : { state: 'failed', problems: result.problems };
}

/** The frame's identity for one install; the protocol accepts lowercase ids of up to 40 characters. */
export function toolInstanceId(tool: SpaceToolInstallation): string {
  return `room-${tool.packageId}-v${tool.version}`.slice(0, TOOL_PACKAGE_LIMITS.maxIdChars);
}

/** A fresh 32-hex nonce for one mount, so a frame from a previous mount can no longer be identified. */
export function toolNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

export interface RoomToolView {
  /** The page's language, so the package renders in it instead of guessing. */
  locale: 'th' | 'en';
  reducedMotion: boolean;
}

/** What the host tells the frame about how to present itself. */
export function toolPresentation(definition: ToolPackageDefinition | undefined, view: RoomToolView): ToolPresentation {
  const declared = (definition?.ports ?? []).filter(port => port.kind === 'records').map(port => port.maxRows);
  // The host promises the frame no more rows per records port than the package declared, and never
  // more than the bridge can carry.
  const ceiling = Math.min(...(declared.length > 0 ? declared : [TOOL_BRIDGE_LIMITS.maxRowsPerPort]));
  const maxRows = Math.max(1, Math.min(TOOL_BRIDGE_LIMITS.maxRowsPerPort, ceiling));
  return { locale: view.locale, reducedMotion: view.reducedMotion, maxRows };
}

/**
 * The authorized projections the frame may see, built from the joined sources this screen already read.
 *
 * Only ports the package declared and the joined read actually holds become snapshots: a package does
 * not receive a source it never asked for, and the frame gets the declared field allowlist rather than
 * whatever the source happened to include. The joined client keeps a data revision only, so the rule
 * revision stays 0 — "not reported" is stated honestly instead of invented.
 */
export function toolPortSnapshots(
  sources: readonly JoinedSource[],
  definition: ToolPackageDefinition | undefined,
): ToolPortSnapshot[] {
  if (!definition) return [];
  const declared = new Map(
    definition.ports
      .filter(port => port.direction === 'in' && port.kind === 'records')
      .map(port => [port.id, port] as const),
  );
  const snapshots: ToolPortSnapshot[] = [];
  for (const source of sources) {
    const port = declared.get(source.portId);
    if (!port) continue;
    const limit = Math.min(port.maxRows, TOOL_BRIDGE_LIMITS.maxRowsPerPort);
    snapshots.push({
      portId: port.id,
      kind: 'records',
      status: source.status,
      revision: {
        dataRevision: source.dataRevision,
        ruleRevision: 0,
        grantVersion: source.grantVersion ?? 0,
        readAt: source.readAt ?? 0,
      },
      sourceLabel: source.label,
      rows: source.rows.slice(0, limit).map(row => ({
        id: row.id,
        values: Object.fromEntries(port.fields.map(field => [field, row.values[field] ?? null])),
      })),
    });
    if (snapshots.length >= TOOL_BRIDGE_LIMITS.maxPorts) break;
  }
  return snapshots;
}
