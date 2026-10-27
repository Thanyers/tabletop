import { z } from 'zod';
import { jsonWithinBudget } from './json-budget';
import { toolPackageDefinitionSchema, validateToolPackage, type ToolPackageDefinition } from './tool-package';

/**
 * F080: a collaboration space is a place where several independent table workspaces meet.
 *
 * It is a separate aggregate on purpose. The Room today is one workspace (`room-repository`
 * keeps a single bound id and commits inside that Room), and a table state holds one program,
 * so "draw three tables on a canvas" never creates three authorities. A space therefore only
 * holds *references* to source workspaces plus its own membership and shared-tool workspace;
 * it never renames, moves or copies source data, and being in the space grants nothing at the
 * source. Reading a source still needs that source's own grant.
 */

export const COLLABORATION_SPACE_SCHEMA_VERSION = 1 as const;

export const SPACE_LIMITS = {
  maxMembers: 24,
  /** Source tables one space may reference; the plan asks for 3-table topology, not "two only". */
  maxSources: 6,
  maxTitleChars: 80,
  maxMemberNameChars: 80,
  /** Pending connection proposals one space may hold at a time. */
  maxPendingConnections: 8,
} as const;

export const SPACE_ROLES = ['viewer', 'participant', 'maker', 'manager'] as const;
export type SpaceRole = typeof SPACE_ROLES[number];

/**
 * Every action a space role can decide. Notice what is absent: nothing here can grant access
 * to a source table, and nothing here can export source data. Those are decided by the source
 * workspace's own sharing authority, not by a room role.
 */
export const SPACE_VERBS = [
  'space.view',
  'tool.run',
  'tool.author',
  'tool.bind',
  'tool.copyDefinitions',
  'tool.delete',
  'space.manageMembers',
  'space.transferManager',
  'space.delete',
] as const;
export type SpaceVerb = typeof SPACE_VERBS[number];

/**
 * The role x verb matrix from the plan (§4.1), as data so tests and the server read the same
 * source. `participant` may only run tools they were granted at the instance level; `maker`
 * may author and rebind but never widens a source grant; only `manager` administers the space.
 */
export const SPACE_ROLE_VERBS = {
  viewer: ['space.view'],
  participant: ['space.view', 'tool.run'],
  maker: ['space.view', 'tool.run', 'tool.author', 'tool.bind', 'tool.copyDefinitions'],
  manager: [
    'space.view',
    'tool.run',
    'tool.author',
    'tool.bind',
    'tool.copyDefinitions',
    'tool.delete',
    'space.manageMembers',
    'space.transferManager',
    'space.delete',
  ],
} as const satisfies Record<SpaceRole, readonly SpaceVerb[]>;

export function spaceAllows(role: SpaceRole, verb: SpaceVerb): boolean {
  return (SPACE_ROLE_VERBS[role] as readonly string[]).includes(verb);
}

/** Every verb a role may decide; derived from the matrix so it cannot drift. */
export function spaceVerbsFor(role: SpaceRole): readonly SpaceVerb[] {
  return SPACE_ROLE_VERBS[role];
}

/**
 * Convener level rules that are not per-role.
 *
 * Two facts the plan is explicit about and that are easy to lose in an implementation:
 * joining a space never grants source data, and copying definitions is a different permission
 * from exporting or retaining data.
 */
export function spaceMembershipGrantsSourceData(): false {
  return false;
}

export interface ExportPermission {
  granted: boolean;
  /** The grant version the export permission was decided at; a stale grant cannot be used. */
  grantVersion: number;
}

/**
 * Export/retain is never implied by a space role. `maker` may copy *definitions* when the
 * package and dependency allow it, but data export needs its own permission from the source.
 */
export function spaceMayExportData(_role: SpaceRole, permission: ExportPermission, currentGrantVersion: number): boolean {
  return permission.granted && permission.grantVersion === currentGrantVersion;
}

export interface SpaceMember {
  actorId: string;
  /** Display name resolved when the member joined; never a credential or an email. */
  name: string;
  role: SpaceRole;
  joinedAt: number;
}

export type SpaceSourceStatus = 'linked' | 'left' | 'revoked';

/** A pointer to an existing table workspace; the space never owns the table's data. */
export interface SpaceSourceRef {
  workspaceId: string;
  /** The source epoch this link was made under; a source reset makes the link stale. */
  epoch: number;
  addedBy: string;
  addedAt: number;
  status: SpaceSourceStatus;
}

export interface CollaborationSpace {
  schemaVersion: typeof COLLABORATION_SPACE_SCHEMA_VERSION;
  spaceId: string;
  title: string;
  /**
   * The table workspace whose shared-tool workspace this space operates on. Shared tools belong
   * to the space's workspace, not to the person who happened to create them.
   */
  sharedToolWorkspaceId: string;
  managerActorId: string;
  members: SpaceMember[];
  sources: SpaceSourceRef[];
  revision: number;
  epoch: number;
  createdAt: number;
  updatedAt: number;
  /**
   * How far each member has read, keyed by actor. Absent means "never recorded", which a recap
   * reports as unseen instead of assuming the member is up to date (decision D-021).
   */
  seen?: Record<string, number>;
  /**
   * The room's own statement of what it is for. Absent means the room has none, which the AI context
   * report says out loud instead of inventing one (CTX-01).
   */
  brief?: { text: string; updatedBy: string; updatedAt: number };
  /**
   * The tool version this room runs (D-036). Absent means the room has no tool installed, which the
   * room shell shows as an empty slot instead of pretending one exists.
   */
  tool?: SpaceToolInstallation;
}

/**
 * F080 / D-036: which tool package version a room runs.
 *
 * The room stores the reference (id, version, content hash) rather than the package source: the
 * source lives with the tool workspace, and an installed version is identified by its hash so a room
 * cannot be switched to a different package under the same name.
 */
export interface SpaceToolInstallation {
  packageId: string;
  version: number;
  contentHash: string;
  route: 'human' | 'ai';
  title: string;
  installedBy: string;
  installedAt: number;
  /**
   * D-037: the package this room runs. The Worker proves the hash before the command is applied, so a
   * definition here is the one the reference names; the room can compile and render it without asking
   * another workspace.
   */
  definition?: ToolPackageDefinition;
}

const idSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{2,39}$/u);
const actorSchema = z.string().min(1).max(160);
const titleSchema = z.string().min(1).max(SPACE_LIMITS.maxTitleChars);

export const spaceMemberSchema: z.ZodType<SpaceMember> = z.strictObject({
  actorId: actorSchema,
  name: z.string().min(1).max(SPACE_LIMITS.maxMemberNameChars),
  role: z.enum(SPACE_ROLES),
  joinedAt: z.number().int().nonnegative(),
});

export const spaceSourceRefSchema: z.ZodType<SpaceSourceRef> = z.strictObject({
  workspaceId: z.string().uuid(),
  epoch: z.number().int().nonnegative(),
  addedBy: actorSchema,
  addedAt: z.number().int().nonnegative(),
  status: z.enum(['linked', 'left', 'revoked']),
});

export const collaborationSpaceSchema: z.ZodType<CollaborationSpace> = z.strictObject({
  schemaVersion: z.literal(COLLABORATION_SPACE_SCHEMA_VERSION),
  spaceId: idSchema,
  title: titleSchema,
  sharedToolWorkspaceId: z.string().uuid(),
  managerActorId: actorSchema,
  members: z.array(spaceMemberSchema).min(1).max(SPACE_LIMITS.maxMembers),
  sources: z.array(spaceSourceRefSchema).max(SPACE_LIMITS.maxSources),
  revision: z.number().int().nonnegative(),
  epoch: z.number().int().nonnegative(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  seen: z.record(z.string().min(1).max(160), z.number().int().nonnegative()).optional(),
  brief: z.strictObject({
    text: z.string().min(1).max(600),
    updatedBy: z.string().min(1).max(160),
    updatedAt: z.number().int().nonnegative(),
  }).optional(),
  tool: z.strictObject({
    packageId: idSchema,
    version: z.number().int().min(1).max(10_000),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
    route: z.enum(['human', 'ai']),
    title: titleSchema,
    installedBy: actorSchema,
    installedAt: z.number().int().nonnegative(),
    definition: toolPackageDefinitionSchema.optional(),
  }).optional(),
});

export type SpaceProblemCode = 'SPACE_SCHEMA' | 'SPACE_MEMBER' | 'SPACE_SOURCE' | 'SPACE_BUDGET';

export interface SpaceProblem {
  code: SpaceProblemCode;
  path: string;
  message: string;
}

export type SpaceValidation =
  | { ok: true; space: CollaborationSpace }
  | { ok: false; problems: SpaceProblem[] };

/** Validate a space, including the identities that must stay unique. */
export function validateCollaborationSpace(value: unknown): SpaceValidation {
  let inspectable: unknown;
  try {
    inspectable = JSON.parse(JSON.stringify(value));
  } catch {
    return { ok: false, problems: [{ code: 'SPACE_BUDGET', path: 'space', message: 'The space cannot be serialised.' }] };
  }
  if (!jsonWithinBudget(inspectable)) {
    return { ok: false, problems: [{ code: 'SPACE_BUDGET', path: 'space', message: 'The space is too deep or too large to inspect.' }] };
  }
  const parsed = collaborationSpaceSchema.safeParse(value);
  if (!parsed.success) {
    return {
      ok: false,
      problems: parsed.error.issues.map(issue => ({
        code: 'SPACE_SCHEMA',
        path: issue.path.length ? issue.path.join('.') : 'space',
        message: issue.message,
      })),
    };
  }
  const space = parsed.data;
  const problems: SpaceProblem[] = [];
  const actors = new Set(space.members.map(member => member.actorId));
  if (actors.size !== space.members.length) {
    problems.push({ code: 'SPACE_MEMBER', path: 'members', message: 'A member may only appear once.' });
  }
  if (!actors.has(space.managerActorId)) {
    problems.push({ code: 'SPACE_MEMBER', path: 'managerActorId', message: 'The manager must be a member of the space.' });
  }
  const managers = space.members.filter(member => member.role === 'manager');
  if (managers.length !== 1 || managers[0]?.actorId !== space.managerActorId) {
    problems.push({ code: 'SPACE_MEMBER', path: 'members', message: 'Exactly one member is the manager, and it is managerActorId.' });
  }
  const sources = new Set(space.sources.map(source => source.workspaceId));
  if (sources.size !== space.sources.length) {
    problems.push({ code: 'SPACE_SOURCE', path: 'sources', message: 'A source table may only be referenced once.' });
  }
  if (space.sources.some(source => source.workspaceId === space.sharedToolWorkspaceId)) {
    problems.push({ code: 'SPACE_SOURCE', path: 'sources', message: 'The shared-tool workspace cannot also be a source.' });
  }
  return problems.length > 0 ? { ok: false, problems } : { ok: true, space };
}

/** The role an actor holds in this space, or `undefined` when they are not a member. */
export function spaceRoleOf(space: CollaborationSpace, actorId: string): SpaceRole | undefined {
  return space.members.find(member => member.actorId === actorId)?.role;
}

/**
 * Being in the space is not permission to read a source table.
 *
 * The caller must pass the source-side decision separately; this function exists so no code
 * path can accidentally treat membership (or a canvas position) as a data grant.
 */
export function spaceMayReadSource(
  space: CollaborationSpace,
  actorId: string,
  source: { workspaceId: string; sourceGrantActive: boolean; actorGranted: boolean },
): boolean {
  if (spaceRoleOf(space, actorId) === undefined) return false;
  const reference = space.sources.find(entry => entry.workspaceId === source.workspaceId);
  if (!reference || reference.status !== 'linked') return false;
  return source.sourceGrantActive && source.actorGranted;
}

/* ------------------------------------------------------------------------------------------------
 * Commands: the smallest set of changes the space owns.
 * ---------------------------------------------------------------------------------------------- */

export type SpaceCommand =
  | { type: 'space.seen'; revision: number }
  | { type: 'space.setBrief'; text: string }
  | { type: 'space.clearBrief' }
  | { type: 'space.rename'; title: string }
  | { type: 'space.addMember'; member: SpaceMember }
  | { type: 'space.removeMember'; actorId: string }
  | { type: 'space.setRole'; actorId: string; role: SpaceRole }
  | { type: 'space.transferManager'; actorId: string }
  | { type: 'space.addSource'; source: SpaceSourceRef }
  | { type: 'space.leaveSource'; workspaceId: string }
  | { type: 'space.installTool'; tool: Omit<SpaceToolInstallation, 'installedBy' | 'installedAt'> }
  | { type: 'space.uninstallTool' };

export type SpaceDecision =
  | { ok: true; space: CollaborationSpace }
  | { ok: false; code: string; message: string };

const clone = (space: CollaborationSpace): CollaborationSpace => structuredClone(space);

/**
 * Apply one command.
 *
 * Every branch that changes membership or a role copies `sources` unchanged, which is what makes
 * "adding a member does not widen a source grant" a structural property rather than a promise in
 * a comment. Reading a source remains the source's decision.
 */
export function decideSpace(space: CollaborationSpace, actorId: string, command: SpaceCommand, now: number): SpaceDecision {
  const role = spaceRoleOf(space, actorId);
  if (!role) return { ok: false, code: 'SPACE_NOT_MEMBER', message: 'Only a member may act in this space.' };
  const next = clone(space);
  next.revision = space.revision + 1;
  next.updatedAt = now;

  switch (command.type) {
    case 'space.rename': {
      if (!spaceAllows(role, 'space.manageMembers')) return { ok: false, code: 'SPACE_FORBIDDEN', message: 'Only the manager may rename the space.' };
      const title = command.title.trim();
      if (title.length === 0 || title.length > SPACE_LIMITS.maxTitleChars) return { ok: false, code: 'SPACE_INVALID', message: 'Use a title of 1 to 80 characters.' };
      next.title = title;
      return { ok: true, space: next };
    }
    case 'space.addMember': {
      if (!spaceAllows(role, 'space.manageMembers')) return { ok: false, code: 'SPACE_FORBIDDEN', message: 'Only the manager may add a member.' };
      if (next.members.length >= SPACE_LIMITS.maxMembers) return { ok: false, code: 'SPACE_LIMIT', message: 'The space is full.' };
      if (next.members.some(member => member.actorId === command.member.actorId)) return { ok: false, code: 'SPACE_DUPLICATE', message: 'That member is already in the space.' };
      if (command.member.role === 'manager') return { ok: false, code: 'SPACE_INVALID', message: 'Transfer management instead of adding a second manager.' };
      // The join time is audit data: the domain stamps it instead of trusting the payload.
      next.members = [...next.members, { ...command.member, joinedAt: now }];
      // `sources` is deliberately untouched: joining the space is not a data grant.
      return { ok: true, space: next };
    }
    case 'space.removeMember': {
      if (!spaceAllows(role, 'space.manageMembers')) return { ok: false, code: 'SPACE_FORBIDDEN', message: 'Only the manager may remove a member.' };
      if (command.actorId === space.managerActorId) return { ok: false, code: 'SPACE_INVALID', message: 'Transfer management before leaving.' };
      next.members = space.members.filter(member => member.actorId !== command.actorId);
      return { ok: true, space: next };
    }
    case 'space.setRole': {
      if (!spaceAllows(role, 'space.manageMembers')) return { ok: false, code: 'SPACE_FORBIDDEN', message: 'Only the manager may change a role.' };
      if (command.role === 'manager') return { ok: false, code: 'SPACE_INVALID', message: 'Transfer management instead of granting the manager role.' };
      if (!next.members.some(member => member.actorId === command.actorId)) return { ok: false, code: 'SPACE_MISSING', message: 'That actor is not a member.' };
      next.members = next.members.map(member => (member.actorId === command.actorId ? { ...member, role: command.role } : member));
      return { ok: true, space: next };
    }
    case 'space.transferManager': {
      if (!spaceAllows(role, 'space.transferManager')) return { ok: false, code: 'SPACE_FORBIDDEN', message: 'Only the manager may transfer management.' };
      if (command.actorId === space.managerActorId) return { ok: false, code: 'SPACE_INVALID', message: 'That actor is already the manager.' };
      if (!next.members.some(member => member.actorId === command.actorId)) return { ok: false, code: 'SPACE_MISSING', message: 'That actor is not a member.' };
      next.members = next.members.map(member => {
        if (member.actorId === command.actorId) return { ...member, role: 'manager' };
        if (member.actorId === space.managerActorId) return { ...member, role: 'maker' };
        return member;
      });
      next.managerActorId = command.actorId;
      return { ok: true, space: next };
    }
    case 'space.addSource': {
      // Linking a table is a space action by whoever may bind tools; the source still decides
      // whether anyone in the space may read it.
      if (!spaceAllows(role, 'tool.bind')) return { ok: false, code: 'SPACE_FORBIDDEN', message: 'Only a maker or the manager may link a source table.' };
      if (next.sources.length >= SPACE_LIMITS.maxSources) return { ok: false, code: 'SPACE_LIMIT', message: 'The space already references the maximum number of tables.' };
      if (next.sources.some(source => source.workspaceId === command.source.workspaceId)) return { ok: false, code: 'SPACE_DUPLICATE', message: 'That table is already referenced.' };
      if (command.source.workspaceId === space.sharedToolWorkspaceId) return { ok: false, code: 'SPACE_INVALID', message: 'The shared-tool workspace cannot also be a source.' };
      next.sources = [...next.sources, { ...command.source, addedBy: actorId, addedAt: now }];
      return { ok: true, space: next };
    }
    case 'space.setBrief': {
      // Whoever may bind tools may state the room's purpose; the record keeps who and when.
      if (!spaceAllows(role, 'tool.bind')) return { ok: false, code: 'SPACE_FORBIDDEN', message: 'Only a maker or the manager may write the room brief.' };
      const text = command.text.trim();
      if (text.length === 0 || text.length > 600) return { ok: false, code: 'SPACE_INVALID', message: 'The brief needs 1 to 600 characters.' };
      next.brief = { text, updatedBy: actorId, updatedAt: now };
      return { ok: true, space: next };
    }
    case 'space.clearBrief': {
      if (!spaceAllows(role, 'tool.bind')) return { ok: false, code: 'SPACE_FORBIDDEN', message: 'Only a maker or the manager may clear the room brief.' };
      delete next.brief;
      return { ok: true, space: next };
    }
    case 'space.installTool': {
      // D-036: installing a tool version is a maker action, and the domain stamps who and when so the
      // room cannot claim an installation that the record does not support.
      if (!spaceAllows(role, 'tool.author')) return { ok: false, code: 'SPACE_FORBIDDEN', message: 'Only a maker or the manager may install a tool in this room.' };
      const packageId = command.tool.packageId.trim();
      if (!/^[a-z0-9][a-z0-9-]{2,39}$/u.test(packageId)) return { ok: false, code: 'SPACE_INVALID', message: 'Use a package id of 3 to 40 lowercase characters.' };
      if (!Number.isInteger(command.tool.version) || command.tool.version < 1 || command.tool.version > 10_000) return { ok: false, code: 'SPACE_INVALID', message: 'Use a version between 1 and 10000.' };
      if (!/^[a-f0-9]{64}$/u.test(command.tool.contentHash)) return { ok: false, code: 'SPACE_INVALID', message: 'An installation needs the content hash of the version it runs.' };
      const title = command.tool.title.trim();
      if (title.length === 0 || title.length > SPACE_LIMITS.maxTitleChars) return { ok: false, code: 'SPACE_INVALID', message: 'Use a tool title of 1 to 80 characters.' };
      // Replacing a different package is refused: change the room's tool on purpose, not by accident.
      if (next.tool && next.tool.packageId !== packageId) return { ok: false, code: 'SPACE_INVALID', message: 'Uninstall the current tool before installing a different package.' };
      // D-037: a definition may travel with the reference, but it must be a valid package that names
      // the same id and version; the Worker proves the hash before this command is applied.
      if (command.tool.definition) {
        const validation = validateToolPackage(command.tool.definition);
        if (!validation.ok) return { ok: false, code: 'SPACE_INVALID', message: 'The installed package does not validate.' };
        if (validation.package.packageId !== packageId || validation.package.version !== command.tool.version) {
          return { ok: false, code: 'SPACE_INVALID', message: 'The package does not match the id and version being installed.' };
        }
      }
      next.tool = {
        packageId,
        version: command.tool.version,
        contentHash: command.tool.contentHash,
        route: command.tool.route,
        title,
        installedBy: actorId,
        installedAt: now,
        ...(command.tool.definition ? { definition: command.tool.definition } : {}),
      };
      return { ok: true, space: next };
    }
    case 'space.uninstallTool': {
      if (!spaceAllows(role, 'tool.author')) return { ok: false, code: 'SPACE_FORBIDDEN', message: 'Only a maker or the manager may remove the room tool.' };
      delete next.tool;
      return { ok: true, space: next };
    }
    case 'space.seen': {
      // A member records their own reading position; an older position never moves it back.
      const previous = next.seen?.[actorId];
      if (previous !== undefined && command.revision <= previous) {
        next.seen = { ...(next.seen ?? {}), [actorId]: previous };
        return { ok: true, space: next };
      }
      next.seen = { ...(next.seen ?? {}), [actorId]: command.revision };
      return { ok: true, space: next };
    }
    case 'space.leaveSource': {
      if (!spaceAllows(role, 'tool.bind')) return { ok: false, code: 'SPACE_FORBIDDEN', message: 'Only a maker or the manager may remove a source table.' };
      const source = next.sources.find(entry => entry.workspaceId === command.workspaceId);
      if (!source) return { ok: false, code: 'SPACE_MISSING', message: 'That table is not referenced by this space.' };
      // Leaving keeps the reference and its history; the status is what stops reads and writes.
      next.sources = next.sources.map(entry => (entry.workspaceId === command.workspaceId ? { ...entry, status: 'left' } : entry));
      return { ok: true, space: next };
    }
    default:
      return { ok: false, code: 'SPACE_UNKNOWN_COMMAND', message: 'Unknown space command.' };
  }
}

/* ------------------------------------------------------------------------------------------------
 * Reader compatibility.
 * ---------------------------------------------------------------------------------------------- */

export interface SpaceReadResult {
  space: CollaborationSpace | undefined;
  problems: SpaceProblem[];
}

/**
 * Read a stored space without rejecting a value a newer build wrote.
 *
 * A space did not exist before this feature, so "absent" is normal and must not be an error.
 * An unreadable entry is reported and the rest is kept rather than losing the whole space.
 */
export function readCollaborationSpace(value: unknown): SpaceReadResult {
  if (value === undefined || value === null) return { space: undefined, problems: [] };
  if (typeof value !== 'object' || Array.isArray(value)) {
    return { space: undefined, problems: [{ code: 'SPACE_SCHEMA', path: 'space', message: 'Stored space is not an object.' }] };
  }
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== COLLABORATION_SPACE_SCHEMA_VERSION) {
    return {
      space: undefined,
      problems: [{
        code: 'SPACE_SCHEMA',
        path: 'schemaVersion',
        message: typeof record.schemaVersion === 'number' && record.schemaVersion > COLLABORATION_SPACE_SCHEMA_VERSION
          ? 'This space was written by a newer schema.'
          : 'Unknown space schema version.',
      }],
    };
  }
  const problems: SpaceProblem[] = [];
  const members = Array.isArray(record.members) ? record.members.flatMap((entry, index) => {
    const parsed = spaceMemberSchema.safeParse(entry);
    if (parsed.success) return [parsed.data];
    problems.push({ code: 'SPACE_MEMBER', path: `members.${index}`, message: 'Skipped an unreadable member entry.' });
    return [];
  }) : [];
  const sources = Array.isArray(record.sources) ? record.sources.flatMap((entry, index) => {
    const parsed = spaceSourceRefSchema.safeParse(entry);
    if (parsed.success) return [parsed.data];
    problems.push({ code: 'SPACE_SOURCE', path: `sources.${index}`, message: 'Skipped an unreadable source entry.' });
    return [];
  }) : [];
  const validated = validateCollaborationSpace({ ...record, members, sources });
  if (!validated.ok) return { space: undefined, problems: [...problems, ...validated.problems] };
  return { space: validated.space, problems };
}
