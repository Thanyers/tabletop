import { z } from 'zod';
import {
  DomainError,
  type ActorContext,
  type Candidate,
  type ChangeSet,
  type DomainState,
  type EncounterRule,
  type InvoiceState,
  type RevisionRecord,
  type RuleOperation,
  type ValidationCheck,
} from '../shared/contracts';
import { applyInvoiceOperations, invoiceChangeSchema, invoiceSourceHash, reconcileInvoice, validateRuleSet } from './invoice';
import { encounterRuleSchema } from './encounter';
import { calculatePhysics, physicsParamsSchema } from './physics';
import { assert, canonicalJson, hash, hasRole, parsePayload } from './helpers';
import { makeTeachingQuestionId } from './teaching';
import { applyTableChange, tableChangeIssues, tableChangeSchema } from './table';
import { jsonWithinBudget } from '../shared/json-budget';
import { expressionWithinBounds } from '../runtime/generative';

const changeSchema = z.discriminatedUnion('kind', [
  invoiceChangeSchema,
  z.object({ kind: z.literal('teaching'), parameters: physicsParamsSchema }).strict(),
  z.object({ kind: z.literal('encounter'), rule: encounterRuleSchema }).strict(),
  tableChangeSchema,
]);
const proposeSchema = z.object({ change: changeSchema }).strict();
const noPayloadSchema = z.object({}).strict();
const rollbackSchema = z.object({ revision: z.number().int().nonnegative() }).strict();
const PROOF_SUITE = 'tabletop-domain-validation-v1';
const APPROVAL_TTL_MS = 15 * 60_000;

function sourceHash(state: DomainState, ctx: ActorContext): string {
  if (state.kind === 'table') return hash(ctx, { dataRevision: state.dataRevision, sources: state.sources, program: state.program, records: state.records, turn: state.turn });
  if (state.kind === 'invoice') return invoiceSourceHash(state, ctx);
  if (state.kind === 'teaching') return hash(ctx, { dataRevision: state.dataRevision, parameters: state.parameters, questionId: state.questionId, answers: state.answers });
  return hash(ctx, {
    dataRevision: state.dataRevision,
    characters: state.characters,
    turn: state.turn,
    phase: state.phase,
    pendingHit: state.pendingHit,
    rule: state.rule,
    seed: state.seed,
  });
}

function planDelta(change: ChangeSet): unknown {
  if (change.kind === 'table') return {
    version: 1, kind: 'table', collections: change.program.collections, actions: change.program.actions.map(a => a.id),
    ...(change.program.canvas ? { canvas: change.program.canvas } : {}),
  };
  if (change.kind !== 'invoice' || !change.operations.some((operation) => operation.op === 'setSurcharge')) return { version: 1, kind: 'none' };
  return {
    version: 1,
    kind: 'invoice-surcharge-review',
    addColumns: [{ id: 'surchargeSatang', valueType: 'THBSatang' }],
    bindings: [{
      source: 'invoice.reconcile.surchargeExceptions@ReviewItemV1[]',
      destination: 'invoice.review.items@ReviewItemV1[]',
      adapter: 'allowlisted-merge-v1',
    }],
  };
}

function hashCandidate(ctx: ActorContext, candidate: Pick<Candidate, 'change' | 'baseDataRevision' | 'baseRuleRevision' | 'createdBy' | 'createdAt' | 'planDeltaHash'>, epoch: number, snapshotHash: string): string {
  return hash(ctx, {
    kind: candidate.change.kind,
    change: candidate.change,
    baseDataRevision: candidate.baseDataRevision,
    baseRuleRevision: candidate.baseRuleRevision,
    epoch,
    sourceHash: snapshotHash,
    planDeltaHash: candidate.planDeltaHash,
    createdBy: candidate.createdBy,
    createdAt: candidate.createdAt,
  });
}

function requireCaseRole(state: DomainState, ctx: ActorContext): void {
  const role = state.kind === 'invoice' || state.kind === 'table' ? 'owner' : state.kind === 'teaching' ? 'teacher' : 'dm';
  hasRole(ctx, [role]);
}

function assertChangeMatchesState(state: DomainState, change: ChangeSet): void {
  assert(change.kind === state.kind, 'CASE_KIND_MISMATCH', 'The rule change does not match this workspace type.');
}

function proposeCandidate(state: DomainState, change: ChangeSet, ctx: ActorContext): DomainState {
  requireCaseRole(state, ctx);
  assertChangeMatchesState(state, change);
  const source = sourceHash(state, ctx);
  const deltaHash = hash(ctx, planDelta(change));
  const created: Candidate = {
    id: `candidate_${hash(ctx, { workspaceId: ctx.workspaceId, actorId: ctx.actorId, time: ctx.now, revisions: state.revisions.length, change })}`,
    change: structuredClone(change),
    baseDataRevision: state.dataRevision,
    baseRuleRevision: state.ruleRevision,
    hash: '',
    planDeltaHash: deltaHash,
    status: 'draft',
    createdBy: ctx.actorId,
    createdAt: ctx.now,
    simulation: null,
    proof: null,
    approval: null,
  };
  created.hash = hashCandidate(ctx, created, ctx.epoch, source);
  if (state.kind === 'invoice') return { ...structuredClone(state), candidate: created };
  if (state.kind === 'teaching') return { ...structuredClone(state), candidate: created };
  return { ...structuredClone(state), candidate: created };
}

function assertCandidateCurrent(state: DomainState, ctx: ActorContext, candidate: Candidate): string {
  assert(candidate.baseDataRevision === state.dataRevision && candidate.baseRuleRevision === state.ruleRevision, 'STALE_CANDIDATE', 'The source data or active rule revision changed. Propose a fresh candidate.');
  const currentSource = sourceHash(state, ctx);
  assert(candidate.hash === hashCandidate(ctx, candidate, ctx.epoch, currentSource), 'STALE_CANDIDATE', 'The candidate no longer matches the current source snapshot or workspace epoch.');
  assert(candidate.planDeltaHash === hash(ctx, planDelta(candidate.change)), 'CANDIDATE_HASH_MISMATCH', 'The derived component plan changed after proposal.');
  return currentSource;
}

function simulateEncounter(rule: EncounterRule): { target: 'pip'; preHitHp: 10; hitDamage: 4; shieldActor: 'mira'; hpAfter: number; shieldApplied: boolean; shieldUsedThisTurn: false } {
  const alreadyUsedThisTurn = false;
  const shieldApplied = rule.allyTarget && 2 >= rule.apCost && (!rule.oncePerTurn || !alreadyUsedThisTurn);
  const damage = Math.max(0, 4 - (shieldApplied ? 2 : 0));
  return { target: 'pip', preHitHp: 10, hitDamage: 4, shieldActor: 'mira', hpAfter: Math.max(0, 10 - damage), shieldApplied, shieldUsedThisTurn: alreadyUsedThisTurn };
}

function simulationFor(state: DomainState, change: ChangeSet, ctx: ActorContext): { before: unknown; after: unknown; checks: ValidationCheck[] } {
  if (state.kind === 'table' && change.kind === 'table') {
    const after = applyTableChange(state, change, ctx);
    const summarize = (s: typeof state) => ({ collections: s.program?.collections.length ?? 0, actions: s.program?.actions.length ?? 0, rowCount: Object.values(s.records).reduce((n, rows) => n + rows.length, 0), turn: s.turn, recordsHash: hash(ctx, s.records) });
    return { before: summarize(state), after: summarize(after), checks: [] };
  }
  if (state.kind === 'invoice' && change.kind === 'invoice') {
    const changed: InvoiceState = { ...structuredClone(state), rules: applyInvoiceOperations(state, change.operations) };
    const before = reconcileInvoice(state);
    const after = reconcileInvoice(changed);
    const delta = planDelta(change);
    return {
      before: { result: before, surface: { columns: ['shipmentId', 'zone', 'date', 'weightGram', 'billedSatang', 'expectedSatang', 'deltaSatang'] } },
      after: { result: after, surface: { columns: ['shipmentId', 'zone', 'date', 'weightGram', 'billedSatang', 'expectedSatang', 'deltaSatang', ...(change.operations.some((operation) => operation.op === 'setSurcharge') ? ['surchargeSatang'] : [])], planDelta: delta } },
      checks: [],
    };
  }
  if (state.kind === 'teaching' && change.kind === 'teaching') {
    return { before: { parameters: state.parameters, result: calculatePhysics(state.parameters) }, after: { parameters: change.parameters, result: calculatePhysics(change.parameters) }, checks: [] };
  }
  if (state.kind === 'encounter' && change.kind === 'encounter') {
    return { before: { rule: state.rule, scenario: simulateEncounter(state.rule), recordedSeed: state.seed }, after: { rule: change.rule, scenario: simulateEncounter(change.rule), recordedSeed: state.seed }, checks: [] };
  }
  throw new DomainError('CASE_KIND_MISMATCH', 'The candidate does not belong to this domain.');
}

function semanticIssues(state: DomainState, change: ChangeSet): string[] {
  try {
    if (state.kind === 'table' && change.kind === 'table') return tableChangeIssues(state, change);
    if (state.kind === 'invoice' && change.kind === 'invoice') {
      const rules = applyInvoiceOperations(state, change.operations);
      const issues = validateRuleSet(rules, state.sources);
      if (rules.length === state.rules.length && canonicalJson(rules) === canonicalJson(state.rules)) issues.push('The candidate does not change the active rules.');
      return issues;
    }
    if (state.kind === 'teaching' && change.kind === 'teaching') {
      physicsParamsSchema.parse(change.parameters);
      return [];
    }
    if (state.kind === 'encounter' && change.kind === 'encounter') {
      encounterRuleSchema.parse(change.rule);
      return canonicalJson(change.rule) === canonicalJson(state.rule) ? ['The candidate does not change the active encounter rule.'] : [];
    }
  } catch (error) {
    return [error instanceof Error ? error.message : 'The candidate failed a trusted domain check.'];
  }
  return ['The candidate domain does not match the workspace.'];
}

function createProofHash(ctx: ActorContext, candidate: Candidate, currentSource: string, checks: ValidationCheck[]): string {
  return hash(ctx, {
    suite: PROOF_SUITE,
    suiteHash: hash(ctx, { suite: PROOF_SUITE, checks: ['source-current', 'revision-current', 'domain-invariants', 'deterministic-simulation', 'plan-delta'] }),
    candidateHash: candidate.hash,
    sourceHash: currentSource,
    inputSnapshotHash: currentSource,
    baseDataRevision: candidate.baseDataRevision,
    baseRuleRevision: candidate.baseRuleRevision,
    planDeltaHash: candidate.planDeltaHash,
    epoch: ctx.epoch,
    deterministicSeed: candidate.change.kind === 'encounter' ? 'recorded-encounter-seed' : null,
    checks,
  });
}

function expectedApprovalId(ctx: ActorContext, approval: NonNullable<Candidate['approval']>): string {
  return `approval_${hash(ctx, {
    workspaceId: ctx.workspaceId,
    actorId: approval.actorId,
    candidateHash: approval.candidateHash,
    proofHash: approval.proofHash,
    epoch: approval.epoch,
    now: approval.expiresAt - APPROVAL_TTL_MS,
  })}`;
}

function checksFor(state: DomainState, candidate: Candidate, currentSource: string, ctx: ActorContext): ValidationCheck[] {
  const issues = semanticIssues(state, candidate.change);
  let simulationMatches = false;
  try {
    const recomputed = simulationFor(state, candidate.change, ctx);
    simulationMatches = candidate.simulation !== null
      && canonicalJson({ before: candidate.simulation.before, after: candidate.simulation.after }) === canonicalJson({ before: recomputed.before, after: recomputed.after });
  } catch {
    simulationMatches = false;
  }
  const planSupported = candidate.change.kind !== 'invoice' || !candidate.change.operations.some((operation) => operation.op === 'setSurcharge')
    || canonicalJson(planDelta(candidate.change)) === canonicalJson({
      version: 1,
      kind: 'invoice-surcharge-review',
      addColumns: [{ id: 'surchargeSatang', valueType: 'THBSatang' }],
      bindings: [{ source: 'invoice.reconcile.surchargeExceptions@ReviewItemV1[]', destination: 'invoice.review.items@ReviewItemV1[]', adapter: 'allowlisted-merge-v1' }],
    });
  return [
    { id: 'source-current', passed: candidate.baseDataRevision === state.dataRevision && candidate.hash === hashCandidate(ctx, candidate, ctx.epoch, currentSource), message: 'Candidate matches the current data revision, source hash, and epoch.' },
    { id: 'rule-current', passed: candidate.baseRuleRevision === state.ruleRevision, message: 'Candidate is based on the current active rule revision.' },
    { id: 'domain-invariants', passed: issues.length === 0, message: issues.length === 0 ? 'All trusted domain invariants pass.' : issues.join(' ') },
    { id: 'deterministic-simulation', passed: simulationMatches, message: simulationMatches ? 'Stored before/after outputs match recomputation from the same input snapshot.' : 'Simulation is missing or differs from trusted recomputation.' },
    { id: 'plan-delta', passed: planSupported && candidate.planDeltaHash === hash(ctx, planDelta(candidate.change)), message: planSupported ? 'Derived component plan matches the supported recipe.' : 'The derived component plan is not supported.' },
  ];
}

function makeRevision(state: DomainState, candidate: Candidate, ctx: ActorContext, revision: number): RevisionRecord {
  if (state.kind === 'table' && state.program) return { revision, change: { kind: 'table', program: structuredClone(state.program), initialRecords: {} }, activatedAt: ctx.now, actorId: ctx.actorId, candidateHash: candidate.hash, snapshot: { kind: 'table', program: structuredClone(state.program) } };
  if (state.kind === 'invoice') {
    return { revision, change: structuredClone(candidate.change), activatedAt: ctx.now, actorId: ctx.actorId, candidateHash: candidate.hash, snapshot: { kind: 'invoice', rules: structuredClone(state.rules) } };
  }
  if (state.kind === 'teaching') {
    return { revision, change: structuredClone(candidate.change), activatedAt: ctx.now, actorId: ctx.actorId, candidateHash: candidate.hash, snapshot: { kind: 'teaching', parameters: structuredClone(state.parameters) } };
  }
  if (state.kind === 'encounter') return { revision, change: structuredClone(candidate.change), activatedAt: ctx.now, actorId: ctx.actorId, candidateHash: candidate.hash, snapshot: { kind: 'encounter', rule: structuredClone(state.rule) } };
  throw new DomainError('TABLE_INACTIVE', 'A table needs an active program before saving a revision.');
}

function nextStateWithChange(state: DomainState, candidate: Candidate, ctx: ActorContext): DomainState {
  const next = state.kind === 'table' && candidate.change.kind === 'table' ? applyTableChange(state, candidate.change, ctx) : structuredClone(state);
  if (next.kind === 'invoice' && candidate.change.kind === 'invoice') next.rules = applyInvoiceOperations(next, candidate.change.operations);
  if (next.kind === 'teaching' && candidate.change.kind === 'teaching') {
    next.parameters = structuredClone(candidate.change.parameters);
    next.questionId = makeTeachingQuestionId(ctx, next.parameters, next.ruleRevision + 1);
  }
  if (next.kind === 'encounter' && candidate.change.kind === 'encounter') {
    next.rule = structuredClone(candidate.change.rule);
    if (next.pendingHit) {
      const beforeCount = next.pendingHit.shields.length;
      next.pendingHit.shields = next.pendingHit.shields.filter((intent) => {
        const actor = next.characters.find((character) => character.id === intent.actor);
        return actor !== undefined
          && intent.target === next.pendingHit?.target
          && (next.rule.allyTarget || intent.actor === intent.target)
          && actor.ap >= next.rule.apCost
          && (!next.rule.oncePerTurn || actor.shieldUsedGeneration !== actor.turnGeneration);
      }).map((intent) => ({ ...intent, ruleRevision: next.ruleRevision + 1 }));
      if (next.pendingHit.shields.length !== beforeCount) {
        next.events.push({
          id: `event_${hash(ctx, { workspaceId: ctx.workspaceId, time: ctx.now, revision: next.ruleRevision + 1, event: 'revalidate-pending-reactions' })}`,
          text: 'Pending shield reactions were rechecked under the new active rule.',
          createdAt: ctx.now,
        });
      }
    }
  }
  const revision = next.ruleRevision + 1;
  next.ruleRevision = revision;
  next.revisions.push(makeRevision(next, candidate, ctx, revision));
  if (next.kind === 'table') {
    next.revisions = next.revisions.slice(-20);
    while (next.revisions.length > 1 && new TextEncoder().encode(JSON.stringify(next.revisions)).byteLength > 256 * 1024) next.revisions.shift();
  }
  if (next.candidate) next.candidate.status = 'active';
  return next;
}

function validateCandidate(state: DomainState, candidate: Candidate, ctx: ActorContext, currentSource: string): Candidate {
  const checks = checksFor(state, candidate, currentSource, ctx);
  const passed = checks.every((check) => check.passed);
  return {
    ...structuredClone(candidate),
    status: passed ? 'validated' : 'simulated',
    simulation: candidate.simulation ? { ...structuredClone(candidate.simulation), checks } : null,
    proof: { hash: createProofHash(ctx, candidate, currentSource, checks), candidateHash: candidate.hash, sourceHash: currentSource, passed, createdAt: ctx.now },
    approval: null,
  };
}

function restoreRevision(state: DomainState, revision: number): ChangeSet {
  const record = state.revisions.find((item) => item.revision === revision);
  assert(record, 'REVISION_NOT_FOUND', `Rule revision ${revision} does not exist.`);
  assert(revision < state.ruleRevision, 'ROLLBACK_NOOP', 'Select a compatible earlier rule revision.');
  if (state.kind === 'invoice' && record.snapshot.kind === 'invoice') {
    const operations: RuleOperation[] = [];
    for (const current of state.rules.filter((rule) => rule.enabled)) operations.push({ op: 'disableRule', id: current.id });
    for (const historical of record.snapshot.rules.filter((rule) => rule.enabled)) {
      const op = historical.kind === 'base' ? 'setZoneBase' : historical.kind === 'step' ? 'setWeightStep' : 'setSurcharge';
      operations.push({ op, id: historical.id, zone: historical.zone, amountSatang: historical.amountSatang, from: historical.from, to: historical.to, sourceId: historical.sourceId });
    }
    assert(operations.length > 0, 'ROLLBACK_INCOMPATIBLE', 'The stored invoice rule snapshot cannot be restored.');
    return { kind: 'invoice', operations };
  }
  if (state.kind === 'teaching' && record.snapshot.kind === 'teaching') return { kind: 'teaching', parameters: structuredClone(record.snapshot.parameters) };
  if (state.kind === 'encounter' && record.snapshot.kind === 'encounter') return { kind: 'encounter', rule: structuredClone(record.snapshot.rule) };
  if (state.kind === 'table' && record.snapshot.kind === 'table') return { kind: 'table', program: structuredClone(record.snapshot.program), initialRecords: {} };
  throw new DomainError('ROLLBACK_INCOMPATIBLE', 'The selected revision snapshot cannot be applied to this workspace type.');
}

export function handleEvolutionCommand(state: DomainState, type: string, payload: unknown, ctx: ActorContext): { state: DomainState; label: string } | null {
  if (type === 'evolve.propose') {
    requireCaseRole(state, ctx);
    assert(jsonWithinBudget(payload) && expressionWithinBounds(payload), 'INVALID_PAYLOAD', 'The candidate exceeds the allowed structure or expression depth.');
    const input = parsePayload(proposeSchema, payload);
    assertChangeMatchesState(state, input.change);
    return { state: proposeCandidate(state, input.change, ctx), label: 'Candidate created against the current data and rule revisions.' };
  }
  if (type === 'evolve.rollback') {
    requireCaseRole(state, ctx);
    const input = parsePayload(rollbackSchema, payload);
    const change = restoreRevision(state, input.revision);
    return { state: proposeCandidate(state, change, ctx), label: `Rollback candidate prepared from revision ${input.revision}; approval and activation are still required.` };
  }
  if (type === 'evolve.simulate') {
    requireCaseRole(state, ctx);
    parsePayload(noPayloadSchema, payload);
    assert(state.candidate, 'CANDIDATE_NOT_FOUND', 'Propose a candidate before running a simulation.');
    const candidate = structuredClone(state.candidate);
    assertCandidateCurrent(state, ctx, candidate);
    const next = structuredClone(state);
    const simulation = simulationFor(state, candidate.change, ctx);
    candidate.status = 'simulated';
    candidate.simulation = simulation;
    candidate.proof = null;
    candidate.approval = null;
    next.candidate = candidate;
    return { state: next, label: 'Deterministic before/after simulation saved; Active state is unchanged.' };
  }
  if (type === 'evolve.validate') {
    requireCaseRole(state, ctx);
    parsePayload(noPayloadSchema, payload);
    assert(state.candidate, 'CANDIDATE_NOT_FOUND', 'Propose a candidate before validation.');
    const candidate = structuredClone(state.candidate);
    assertCandidateCurrent(state, ctx, candidate);
    assert(candidate.status === 'simulated' && candidate.simulation !== null, 'SIMULATION_REQUIRED', 'Run a deterministic simulation before validation.');
    const currentSource = sourceHash(state, ctx);
    const validated = validateCandidate(state, candidate, ctx, currentSource);
    const next = structuredClone(state);
    next.candidate = validated;
    const failed = validated.simulation?.checks.filter((check) => !check.passed) ?? [];
    return { state: next, label: failed.length ? `Validation blocked: ${failed.map((check) => check.message).join(' ')}` : 'Trusted validation proof passed.' };
  }
  if (type === 'evolve.approve') {
    requireCaseRole(state, ctx);
    parsePayload(noPayloadSchema, payload);
    assert(state.candidate, 'CANDIDATE_NOT_FOUND', 'There is no candidate to approve.');
    const candidate = structuredClone(state.candidate);
    const currentSource = assertCandidateCurrent(state, ctx, candidate);
    assert(candidate.status === 'validated' && candidate.proof?.passed, 'VALIDATION_REQUIRED', 'Only a candidate with a passing trusted proof can be approved.');
    assert(candidate.proof.candidateHash === candidate.hash && candidate.proof.sourceHash === currentSource, 'PROOF_MISMATCH', 'The validation proof does not bind to the current candidate and source.');
    assert(candidate.simulation !== null && candidate.simulation.checks.every((check) => check.passed), 'PROOF_MISMATCH', 'Validation checks are absent or failed.');
    assert(candidate.proof.hash === createProofHash(ctx, candidate, currentSource, candidate.simulation.checks), 'PROOF_MISMATCH', 'The validation proof hash is invalid.');
    assert(Number.isSafeInteger(ctx.now + APPROVAL_TTL_MS), 'INVALID_CLOCK', 'The server approval expiry is outside the supported range.');
    candidate.status = 'approved';
    candidate.approval = {
      id: `approval_${hash(ctx, { workspaceId: ctx.workspaceId, actorId: ctx.actorId, candidateHash: candidate.hash, proofHash: candidate.proof.hash, epoch: ctx.epoch, now: ctx.now })}`,
      actorId: ctx.actorId,
      candidateHash: candidate.hash,
      proofHash: candidate.proof.hash,
      epoch: ctx.epoch,
      expiresAt: ctx.now + APPROVAL_TTL_MS,
      revoked: false,
    };
    const next = structuredClone(state);
    next.candidate = candidate;
    return { state: next, label: 'Human approval recorded for this candidate and proof.' };
  }
  if (type === 'evolve.activate') {
    requireCaseRole(state, ctx);
    parsePayload(noPayloadSchema, payload);
    assert(state.candidate, 'CANDIDATE_NOT_FOUND', 'There is no candidate to activate.');
    const candidate = structuredClone(state.candidate);
    const currentSource = assertCandidateCurrent(state, ctx, candidate);
    const approval = candidate.approval;
    assert(candidate.status === 'approved' && candidate.proof?.passed && approval, 'APPROVAL_REQUIRED', 'A current durable approval is required before activation.');
    assert(!approval.revoked, 'APPROVAL_REVOKED', 'This approval was revoked.');
    assert(approval.epoch === ctx.epoch && approval.expiresAt > ctx.now, 'APPROVAL_EXPIRED', 'The approval belongs to another epoch or has expired.');
    assert(approval.actorId.length > 0, 'APPROVAL_INVALID', 'The approving actor is missing.');
    assert(approval.id === expectedApprovalId(ctx, approval), 'APPROVAL_INVALID', 'The approval record identity does not match its stored scope.');
    assert(approval.candidateHash === candidate.hash && approval.proofHash === candidate.proof.hash, 'APPROVAL_MISMATCH', 'The approval is bound to a different candidate or proof.');
    assert(candidate.proof.candidateHash === candidate.hash && candidate.proof.sourceHash === currentSource, 'PROOF_MISMATCH', 'The validation proof is stale or forged.');
    assert(candidate.proof.hash === createProofHash(ctx, candidate, currentSource, candidate.simulation?.checks ?? []), 'PROOF_MISMATCH', 'The validation proof hash is invalid.');
    assert(candidate.simulation?.checks.every((check) => check.passed), 'VALIDATION_REQUIRED', 'One or more trusted validation checks failed.');
    const next = nextStateWithChange(state, candidate, ctx);
    return { state: next, label: `Candidate activated as rule revision ${next.ruleRevision}.` };
  }
  return null;
}
