import type { AccessConfig, Permission } from './permissions';
import type { RollResult } from './roll';
import type { TableChange, TableProgram, TableState } from './table-contracts';
export type CaseKind = 'invoice' | 'teaching' | 'encounter' | 'table';
export type Role = 'owner' | 'teacher' | 'learner' | 'dm' | 'player' | 'participant';
export type Seat = 'learner-1' | 'learner-2' | 'mira' | 'pip' | 'member-1' | 'member-2' | 'member-3' | 'member-4' | 'member-5' | 'member-6' | 'member-7';
/** `permissions` is set by the server from the table's access settings (F035); without it, legacy role checks apply. */
export interface ActorContext { actorId: string; name: string; role: Role; seat?: Seat; workspaceId: string; epoch: number; now: number; hash(value: unknown): string; permissions?: ReadonlySet<Permission> }
export interface Member { actorId: string; name: string; role: Role; seat?: Seat }
export interface SourcePage { number: number; text: string }
export interface Artifact {
  id: string; filename: string; kind: 'shipments' | 'invoice' | 'rate-card' | 'excerpt';
  status: 'provided' | 'verified' | 'rejected'; sha256: string; pages: SourcePage[];
  excerpt: string; createdAt: number; reviewedBy?: string;
}
export type Zone = 'bangkok' | 'regional';
export interface Shipment { id: string; zone: Zone | null; date: string; weightGram: number | null; remote: boolean; sourceId: string; row: number }
export interface InvoiceLine { id: string; billedSatang: number | null; currency: string; sourceId: string; row: number }
export interface RateRule { id: string; kind: 'base' | 'step' | 'surcharge'; zone: Zone | '*'; amountSatang: number; from: string; to: string | null; sourceId: string; enabled: boolean }
export interface ReconcileRow { key: string; shipmentId: string; zone: Zone | null; date: string; weightGram: number | null; billedSatang: number | null; expectedSatang: number | null; surchargeSatang: number | null; deltaSatang: number | null; reasons: string[]; sourceIds: string[]; ruleIds: string[] }
export interface EvidenceGap { id: string; documentType: string; whyNeeded: string; affectedRecordIds: string[]; sourceRequirements: string; status: 'missing' | 'suggested' | 'provided' | 'verified' | 'rejected' }
export interface InvoiceResult { rows: ReconcileRow[]; gaps: EvidenceGap[]; knownExpectedSatang: number; knownBilledSatang: number; deltaSatang: number; unknownCount: number }
export type RuleOperation =
  | { op: 'setZoneBase' | 'setWeightStep' | 'setSurcharge'; id: string; zone: Zone | '*'; amountSatang: number; from: string; to: string | null; sourceId: string }
  | { op: 'setEffectiveWindow'; id: string; from: string; to: string | null }
  | { op: 'disableRule'; id: string };
export interface PhysicsParams { force: number; mass: number; time: number }
export interface EncounterRule { allyTarget: boolean; apCost: 0 | 1; oncePerTurn: boolean }
export type ChangeSet = { kind: 'invoice'; operations: RuleOperation[] } | { kind: 'teaching'; parameters: PhysicsParams } | { kind: 'encounter'; rule: EncounterRule } | TableChange;
export interface ValidationCheck { id: string; passed: boolean; message: string }
export interface Candidate {
  id: string; change: ChangeSet; baseDataRevision: number; baseRuleRevision: number;
  hash: string; planDeltaHash: string; status: 'draft' | 'simulated' | 'validated' | 'approved' | 'active';
  createdBy: string; createdAt: number;
  simulation: { before: unknown; after: unknown; checks: ValidationCheck[] } | null;
  proof: { hash: string; candidateHash: string; sourceHash: string; passed: boolean; createdAt: number } | null;
  approval: { id: string; actorId: string; candidateHash: string; proofHash: string; epoch: number; expiresAt: number; revoked: boolean } | null;
}
export interface RevisionRecord { revision: number; change: ChangeSet; activatedAt: number; actorId: string; candidateHash: string; snapshot: { kind: 'invoice'; rules: RateRule[] } | { kind: 'teaching'; parameters: PhysicsParams } | { kind: 'encounter'; rule: EncounterRule } | { kind: 'table'; program: TableProgram } }
/** Table-wide display settings; a missing field follows the default. */
export interface DisplaySettings { connections?: boolean }
export interface DomainBase { dataRevision: number; ruleRevision: number; candidate: Candidate | null; revisions: RevisionRecord[]; access?: AccessConfig; display?: DisplaySettings }
export interface InvoiceRun { id: string; createdAt: number; dataRevision: number; ruleRevision: number; result: InvoiceResult; sourceIds: string[] }
export interface InvoiceState extends DomainBase { kind: 'invoice'; shipments: Shipment[]; invoiceLines: InvoiceLine[]; sources: Artifact[]; rules: RateRule[]; runs: InvoiceRun[] }
export type Representation = 'text' | 'scene' | 'graph';
export interface Answer { actorId: string; name: string; questionId: string; lessonRevision: number; value: number; correct: boolean; feedback: string; submittedAt: number }
export interface TeachingState extends DomainBase { kind: 'teaching'; parameters: PhysicsParams; representations: Record<string, Representation>; difficulties: Record<string, 'beginner' | 'advanced'>; questionId: string; answers: Answer[]; teacherNote?: string }
export interface Character { id: 'mira' | 'pip' | 'goblin'; name: string; hp: number; maxHp: number; ap: number; turnGeneration: number; shieldUsedGeneration: number | null }
export interface PendingHit { id: string; attacker: Character['id']; target: Character['id']; damage: number | null; roll: number | null; deadline: number; ruleRevision: number; shields: { actor: Character['id']; target: Character['id']; ruleRevision: number }[] }
export interface EncounterEvent { id: string; text: string; createdAt: number }
export interface EncounterPausedState { at: number; remainingReactionMs: number | null }
export interface EncounterState extends DomainBase { kind: 'encounter'; characters: Character[]; turn: Character['id']; phase: 'turn.start' | 'reaction.open' | 'action.resolved' | 'turn.end'; pendingHit: PendingHit | null; rule: EncounterRule; events: EncounterEvent[]; dmNote?: string; seed: number; paused?: EncounterPausedState }
export type DomainState = InvoiceState | TeachingState | EncounterState | TableState;
export interface DomainCommand { type: string; payload: unknown }
export interface DomainDecision {
  state: DomainState;
  label: string;
  /** F048: the roll this decision produced (`table.roll`) or consumed (`table.act`). */
  roll?: RollResult;
  rollParameterId?: string;
}
export interface CommandEnvelope extends DomainCommand { commandId: string; expectedRevision: string; expectedEpoch: number }
export interface WorkspaceView { id: string; title: string; kind: CaseKind; epoch: number; revision: string; actor: Member; members: Member[]; domain: DomainState; createdAt: number; expiresAt: number }
export interface SessionView { csrfToken: string; actorId: string; name: string; expiresAt: number; workspaces: { id: string; title: string; kind: CaseKind; role: Role; /** F053: last change, ms since epoch; absent on the Node runtime. */ updatedAt?: number }[] }
export interface CommandAck { ok: true; commandId: string; duplicate: boolean; workspace: WorkspaceView; /** F048: returned only to the caller that issued or consumed the roll. */ roll?: RollResult }
export interface ApiError { ok: false; errorCode: string; message: string; requestId?: string }
export class DomainError extends Error { constructor(public readonly code: string, message: string) { super(message); this.name = 'DomainError' } }
