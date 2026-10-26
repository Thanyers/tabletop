import { toolPackageContentCanonical, validateToolPackage } from '../src/tabletop/shared/tool-package.js';
import { AuthorityError } from '../server/errors.js';
import { sha256 } from '../server/codec.js';

/**
 * F080 / D-037: prove the content hash of an installed tool package before the room stores it.
 *
 * A definition must be a valid package, must name the same id and version as the reference, and must
 * hash to the hash the reference claims. Anything else is refused, so a room can never record an
 * installation that the definition does not support. `sha256` is the Worker-side helper the room
 * already uses for invite tickets, which keeps this check on the same digest as everywhere else.
 */

interface InstallPayload {
  tool?: {
    packageId?: unknown;
    version?: unknown;
    contentHash?: unknown;
    definition?: unknown;
  };
}

/** Returns the command type it checked, or null when the envelope is not a tool installation. */
export function verifyToolInstall(envelope: unknown): 'space.installTool' | null {
  if (typeof envelope !== 'object' || envelope === null) return null;
  const record = envelope as { type?: unknown; payload?: unknown };
  if (record.type !== 'space.installTool') return null;

  const payload = (record.payload ?? {}) as InstallPayload;
  const tool = payload.tool;
  if (!tool || tool.definition === undefined) return 'space.installTool';

  const validation = validateToolPackage(tool.definition);
  if (!validation.ok) {
    throw new AuthorityError('SPACE_INVALID', 'The installed package does not validate.');
  }
  if (validation.package.packageId !== tool.packageId || validation.package.version !== tool.version) {
    throw new AuthorityError('SPACE_INVALID', 'The package does not match the id and version being installed.');
  }
  const actual = sha256(toolPackageContentCanonical(validation.package));
  if (actual !== tool.contentHash) {
    throw new AuthorityError('SPACE_INVALID', 'The package content does not match the hash being installed.');
  }
  return 'space.installTool';
}
