import { z } from 'zod';
import {
  type ActorContext,
  type Artifact,
  type EvidenceGap,
  type InvoiceLine,
  type InvoiceResult,
  type InvoiceState,
  type RateRule,
  type RevisionRecord,
  type ReconcileRow,
  type Shipment,
  type Zone,
} from '../shared/contracts';
import { assert, DATE_SCHEMA, hash, ID_SCHEMA, isWithinWindow, MAX_ROWS, MAX_SATANG, parsePayload, sumSafe } from './helpers';

const artifactSchema: z.ZodType<Artifact> = z.object({
  id: ID_SCHEMA,
  filename: z.string().min(1).max(260),
  kind: z.enum(['shipments', 'invoice', 'rate-card', 'excerpt']),
  status: z.enum(['provided', 'verified', 'rejected']),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i),
  pages: z.array(z.object({ number: z.number().int().min(1).max(20), text: z.string().max(100_000) }).strict()).max(20),
  excerpt: z.string().max(20_000),
  createdAt: z.number().int().nonnegative(),
  reviewedBy: ID_SCHEMA.optional(),
}).strict();

const shipmentSchema: z.ZodType<Shipment> = z.object({
  id: ID_SCHEMA,
  zone: z.enum(['bangkok', 'regional']).nullable(),
  date: DATE_SCHEMA,
  weightGram: z.number().int().min(0).max(1_000_000_000).nullable(),
  remote: z.boolean(),
  sourceId: ID_SCHEMA,
  row: z.number().int().min(1).max(MAX_ROWS + 1),
}).strict();

const invoiceLineSchema: z.ZodType<InvoiceLine> = z.object({
  id: ID_SCHEMA,
  billedSatang: z.number().int().min(0).max(MAX_SATANG).nullable(),
  currency: z.string().length(3).regex(/^[A-Z]{3}$/),
  sourceId: ID_SCHEMA,
  row: z.number().int().min(1).max(MAX_ROWS + 1),
}).strict();

export const invoiceImportSchema = z.object({
  artifact: artifactSchema,
  shipments: z.array(shipmentSchema).max(MAX_ROWS).optional(),
  invoiceLines: z.array(invoiceLineSchema).max(MAX_ROWS).optional(),
}).strict();

const reviewSourceSchema = z.object({ sourceId: ID_SCHEMA, status: z.enum(['verified', 'rejected']) }).strict();
const noPayloadSchema = z.object({}).strict();
const saveRunSchema = noPayloadSchema;

const operationSchema = z.discriminatedUnion('op', [
  z.object({ op: z.enum(['setZoneBase', 'setWeightStep', 'setSurcharge']), id: ID_SCHEMA, zone: z.enum(['bangkok', 'regional', '*']), amountSatang: z.number().int().min(0).max(MAX_SATANG), from: DATE_SCHEMA, to: DATE_SCHEMA.nullable(), sourceId: ID_SCHEMA }).strict(),
  z.object({ op: z.literal('setEffectiveWindow'), id: ID_SCHEMA, from: DATE_SCHEMA, to: DATE_SCHEMA.nullable() }).strict(),
  z.object({ op: z.literal('disableRule'), id: ID_SCHEMA }).strict(),
]);

export const invoiceChangeSchema = z.object({ kind: z.literal('invoice'), operations: z.array(operationSchema).min(1).max(100) }).strict();

function overlaps(a: RateRule, b: RateRule): boolean {
  const scopesOverlap = a.zone === '*' || b.zone === '*' || a.zone === b.zone;
  const dateOverlap = (a.to === null || b.from < a.to) && (b.to === null || a.from < b.to);
  return a.kind === b.kind && scopesOverlap && dateOverlap;
}

export function validateRuleSet(rules: RateRule[], sources: Artifact[]): string[] {
  const issues: string[] = [];
  const ids = new Set<string>();
  for (const rule of rules) {
    if (ids.has(rule.id)) issues.push(`Duplicate rule ID ${rule.id}.`);
    ids.add(rule.id);
    if (rule.to !== null && rule.from >= rule.to) issues.push(`Rule ${rule.id} must use a non-empty half-open date range.`);
    if (rule.kind === 'base' && rule.zone === '*') issues.push(`Base rule ${rule.id} must name a service zone.`);
    if (rule.enabled) {
      const source = sources.find((item) => item.id === rule.sourceId);
      if (!source) issues.push(`Rule ${rule.id} refers to missing source ${rule.sourceId}.`);
      else if (source.status !== 'verified') issues.push(`Rule ${rule.id} requires verified evidence; source ${source.id} is ${source.status}.`);
      else if (source.kind !== 'rate-card' && source.kind !== 'excerpt') issues.push(`Rule ${rule.id} requires a rate-card or reviewed excerpt source.`);
    }
  }
  const enabled = rules.filter((rule) => rule.enabled);
  for (let i = 0; i < enabled.length; i += 1) {
    for (let j = i + 1; j < enabled.length; j += 1) {
      if (overlaps(enabled[i], enabled[j])) issues.push(`Rules ${enabled[i].id} and ${enabled[j].id} overlap for the same rule family and scope.`);
    }
  }
  return [...new Set(issues)];
}

function activeRule(state: Pick<InvoiceState, 'rules'>, kind: RateRule['kind'], zone: Zone | null, date: string): RateRule | undefined {
  const matching = state.rules.filter((rule) => rule.enabled && rule.kind === kind && (rule.zone === zone || rule.zone === '*') && isWithinWindow(date, rule.from, rule.to));
  return matching.length === 1 ? matching[0] : undefined;
}

function evidenceIssue(state: InvoiceState, rule: RateRule, family: RateRule['kind']): string | null {
  const source = state.sources.find((item) => item.id === rule.sourceId);
  if (!source) return `missing_${family}_evidence`;
  if (source.status !== 'verified') return `unverified_${family}_evidence`;
  if (source.kind !== 'rate-card' && source.kind !== 'excerpt') return `unsupported_${family}_evidence`;
  return null;
}

function familyEvidenceStatus(state: InvoiceState, rule: RateRule | undefined): EvidenceGap['status'] {
  const source = rule ? state.sources.find((item) => item.id === rule.sourceId) : undefined;
  if (source) {
    if (source.status === 'verified' && source.kind !== 'rate-card' && source.kind !== 'excerpt') return 'missing';
    return source.status;
  }
  if (state.sources.some((item) => (item.kind === 'rate-card' || item.kind === 'excerpt') && item.status === 'provided')) return 'provided';
  if (state.sources.some((item) => (item.kind === 'rate-card' || item.kind === 'excerpt') && item.status === 'rejected')) return 'rejected';
  return 'missing';
}

function expectedFor(state: InvoiceState, shipment: Shipment): { expected: number | null; surcharge: number | null; ruleIds: string[]; reasons: string[] } {
  const reasons: string[] = [];
  const ruleIds: string[] = [];
  if (state.sources.find(source => source.id === shipment.sourceId)?.status !== 'verified') reasons.push('unverified_shipment_source');
  if (shipment.zone === null) reasons.push('missing_zone');
  if (shipment.weightGram === null) reasons.push('missing_weight');
  const base = shipment.zone === null ? undefined : activeRule(state, 'base', shipment.zone, shipment.date);
  if (shipment.zone !== null && !base) reasons.push('missing_or_ambiguous_base_rule');
  else if (base) {
    ruleIds.push(base.id);
    const issue = evidenceIssue(state, base, 'base');
    if (issue) reasons.push(issue);
  }

  const stepCount = shipment.weightGram === null ? 0 : Math.ceil(Math.max(0, shipment.weightGram - 1000) / 1000);
  let stepAmount = 0;
  if (stepCount > 0) {
    const step = activeRule(state, 'step', shipment.zone, shipment.date);
    if (!step) reasons.push('missing_or_ambiguous_weight_step');
    else {
      ruleIds.push(step.id);
      stepAmount = step.amountSatang * stepCount;
      if (!Number.isSafeInteger(stepAmount) || stepAmount > MAX_SATANG) reasons.push('expected_amount_overflow');
      const issue = evidenceIssue(state, step, 'step');
      if (issue) reasons.push(issue);
    }
  }

  let surcharge: number | null = 0;
  if (shipment.remote) {
    const rule = activeRule(state, 'surcharge', shipment.zone, shipment.date);
    if (!rule) {
      surcharge = null;
      reasons.push('missing_or_ambiguous_remote_surcharge');
    } else {
      ruleIds.push(rule.id);
      surcharge = rule.amountSatang;
      const issue = evidenceIssue(state, rule, 'surcharge');
      if (issue) reasons.push(issue);
    }
  }

  if (reasons.length > 0 || shipment.weightGram === null || shipment.zone === null || !base || surcharge === null) {
    return { expected: null, surcharge, ruleIds, reasons: [...new Set(reasons)] };
  }
  const expected = base.amountSatang + stepAmount + surcharge;
  if (!Number.isSafeInteger(expected) || expected > MAX_SATANG) return { expected: null, surcharge, ruleIds, reasons: ['expected_amount_overflow'] };
  return { expected, surcharge, ruleIds, reasons };
}

function buildGaps(state: InvoiceState, shipments: Shipment[]): EvidenceGap[] {
  const requirements: { family: RateRule['kind']; shipment: Shipment }[] = [];
  for (const shipment of shipments) {
    const base = shipment.zone === null ? undefined : activeRule(state, 'base', shipment.zone, shipment.date);
    if (!base || evidenceIssue(state, base, 'base')) requirements.push({ family: 'base', shipment });
    if (shipment.weightGram !== null && Math.ceil(Math.max(0, shipment.weightGram - 1000) / 1000) > 0) {
      const step = shipment.zone === null ? undefined : activeRule(state, 'step', shipment.zone, shipment.date);
      if (!step || evidenceIssue(state, step, 'step')) requirements.push({ family: 'step', shipment });
    }
    if (shipment.remote) {
      const surcharge = shipment.zone === null ? undefined : activeRule(state, 'surcharge', shipment.zone, shipment.date);
      if (!surcharge || evidenceIssue(state, surcharge, 'surcharge')) requirements.push({ family: 'surcharge', shipment });
    }
  }
  const grouped = new Map<string, { family: RateRule['kind']; status: EvidenceGap['status']; rows: Shipment[] }>();
  for (const requirement of requirements) {
    const rule = requirement.shipment.zone === null ? undefined : activeRule(state, requirement.family, requirement.shipment.zone, requirement.shipment.date);
    const status = familyEvidenceStatus(state, rule);
    const key = `${requirement.family}:${status}`;
    const group = grouped.get(key) ?? { family: requirement.family, status, rows: [] };
    group.rows.push(requirement.shipment);
    grouped.set(key, group);
  }
  const familyInfo: Record<RateRule['kind'], { documentType: string; whyNeeded: string; sourceRequirements: string }> = {
    base: {
      documentType: 'rate-card zone base schedule',
      whyNeeded: 'The shipment zone and service date do not have one supported base rate.',
      sourceRequirements: 'Provide a reviewed rate-card clause for the zone base amount and its half-open effective date window.',
    },
    step: {
      documentType: 'rate-card started-kilogram schedule',
      whyNeeded: 'The shipment exceeds one kilogram and no single verified started-kilogram rate supports the calculation.',
      sourceRequirements: 'Provide a reviewed rate-card clause for each started extra kilogram and its effective date window.',
    },
    surcharge: {
      documentType: 'rate-card remote-area addendum',
      whyNeeded: 'A remote surcharge affects these service dates, but no single verified effective rule supports the amount.',
      sourceRequirements: 'Provide a reviewed rate card or addendum that states the remote surcharge amount and effective dates; an extracted or provided document still needs human review.',
    },
  };
  return [...grouped.entries()].map(([key, group]) => {
    const info = familyInfo[group.family];
    return {
      id: `gap:${key}`,
      documentType: info.documentType,
      whyNeeded: info.whyNeeded,
      affectedRecordIds: [...new Set(group.rows.map((row) => row.id))],
      sourceRequirements: info.sourceRequirements,
      status: group.status,
    };
  });
}

export function reconcileInvoice(state: InvoiceState): InvoiceResult {
  const shipmentCounts = new Map<string, number>();
  const lineCounts = new Map<string, number>();
  for (const shipment of state.shipments) shipmentCounts.set(shipment.id, (shipmentCounts.get(shipment.id) ?? 0) + 1);
  for (const line of state.invoiceLines) lineCounts.set(line.id, (lineCounts.get(line.id) ?? 0) + 1);

  const rows: ReconcileRow[] = [];
  for (const shipment of state.shipments) {
    const matched = state.invoiceLines.filter((line) => line.id === shipment.id);
    const line = matched.length === 1 ? matched[0] : undefined;
    const calculation = expectedFor(state, shipment);
    const reasons = [...calculation.reasons];
    if ((shipmentCounts.get(shipment.id) ?? 0) > 1) reasons.push('duplicate_shipment_id');
    if (matched.length > 1) reasons.push('duplicate_invoice_line_id');
    if (matched.length === 0) reasons.push('unmatched_shipment');
    if (line) {
      if (line.currency !== 'THB') reasons.push('unsupported_currency');
      if (line.billedSatang === null) reasons.push('missing_billed_amount');
      if (state.sources.find(source => source.id === line.sourceId)?.status !== 'verified') reasons.push('unverified_invoice_source');
    }
    const comparable = Boolean(line && reasons.length === 0 && calculation.expected !== null && line.billedSatang !== null);
    const delta = comparable && line && line.billedSatang !== null && calculation.expected !== null
      ? line.billedSatang - calculation.expected
      : null;
    const invoiceSources = matched.map((matchedLine) => matchedLine.sourceId);
    const rateSources = calculation.ruleIds.map(id => state.rules.find(rule => rule.id === id)?.sourceId).filter((id): id is string => Boolean(id));
    const sourceIds = [...new Set([shipment.sourceId, ...invoiceSources, ...rateSources])];
    const invoiceRowRefs = matched.map((matchedLine) => `${matchedLine.sourceId}:${matchedLine.row}`).sort().join(',') || 'missing';
    rows.push({
      key: `shipment:${shipment.sourceId}:${shipment.row}|invoice:${invoiceRowRefs}`,
      shipmentId: shipment.id,
      zone: shipment.zone,
      date: shipment.date,
      weightGram: shipment.weightGram,
      billedSatang: line?.billedSatang ?? null,
      expectedSatang: calculation.expected,
      surchargeSatang: calculation.surcharge,
      deltaSatang: delta,
      reasons: [...new Set(reasons)],
      sourceIds,
      ruleIds: calculation.ruleIds,
    });
  }

  for (const line of state.invoiceLines) {
    const isMatched = state.shipments.some((shipment) => shipment.id === line.id);
    if (isMatched) continue;
    const reasons = ['unmatched_invoice_line'];
    if ((lineCounts.get(line.id) ?? 0) > 1) reasons.push('duplicate_invoice_line_id');
    if (line.currency !== 'THB') reasons.push('unsupported_currency');
    if (line.billedSatang === null) reasons.push('missing_billed_amount');
    rows.push({
      key: `invoice:${line.sourceId}:${line.row}`,
      shipmentId: line.id,
      zone: null,
      date: '',
      weightGram: null,
      billedSatang: line.billedSatang,
      expectedSatang: null,
      surchargeSatang: null,
      deltaSatang: null,
      reasons,
      sourceIds: [line.sourceId],
      ruleIds: [],
    });
  }

  const resolvedExpected: number[] = [];
  for (const row of rows) {
    if (row.expectedSatang !== null && !row.reasons.includes('unmatched_shipment') && !row.reasons.includes('duplicate_shipment_id') && !row.reasons.includes('duplicate_invoice_line_id')) resolvedExpected.push(row.expectedSatang);
  }
  const resolvedBilled: number[] = [];
  for (const line of state.invoiceLines) {
    if (line.billedSatang !== null && line.currency === 'THB' && state.sources.find(source => source.id === line.sourceId)?.status === 'verified' && (lineCounts.get(line.id) ?? 0) === 1 && state.shipments.filter((shipment) => shipment.id === line.id).length === 1) resolvedBilled.push(line.billedSatang);
  }
  const deltas: number[] = [];
  for (const row of rows) if (row.deltaSatang !== null) deltas.push(row.deltaSatang);
  return {
    rows,
    gaps: buildGaps(state, state.shipments),
    knownExpectedSatang: sumSafe(resolvedExpected),
    knownBilledSatang: sumSafe(resolvedBilled),
    deltaSatang: sumSafe(deltas),
    unknownCount: rows.filter((row) => row.deltaSatang === null).length,
  };
}

export function invoiceSourceHash(state: InvoiceState, ctx: ActorContext): string {
  return hash(ctx, { sources: state.sources, shipments: state.shipments, invoiceLines: state.invoiceLines, rules: state.rules });
}

function makeSource(ctx: ActorContext, source: Omit<Artifact, 'sha256'> & { sha256?: string }): Artifact {
  const { sha256, ...rest } = source;
  return { ...rest, sha256: sha256 ?? hash(ctx, { id: rest.id, pages: rest.pages, excerpt: rest.excerpt }) };
}

export function createInvoiceState(ctx: ActorContext): InvoiceState {
  const shipmentSource = makeSource(ctx, {
    id: 'sample_shipments', filename: 'october-shipments.csv', kind: 'shipments', status: 'verified',
    pages: [], excerpt: 'Four normalized service rows for the reviewed demonstration fixture.', createdAt: ctx.now,
  });
  const invoiceSource = makeSource(ctx, {
    id: 'sample_invoice', filename: 'october-carrier-invoice.txt', kind: 'invoice', status: 'verified',
    pages: [{ number: 1, text: 'Carrier invoice line items for shipment IDs S-BKK-1100, S-BKK-1000, S-BKK-REMOTE-1100, and S-REMOTE-1100.' }],
    excerpt: 'Amounts are supplied in THB and represented as integer satang.', createdAt: ctx.now,
  });
  const rateSource = makeSource(ctx, {
    id: 'sample_rate_card', filename: 'reviewed-base-and-step-excerpt.txt', kind: 'rate-card', status: 'verified',
    pages: [{ number: 1, text: 'Bangkok and regional base rates; each started extra kilogram charge. No remote surcharge is stated.' }],
    excerpt: 'Verified base and started-kilogram rates effective on the dates below; remote-area surcharge evidence is absent.', createdAt: ctx.now,
  });
  const sources = [shipmentSource, invoiceSource, rateSource];
  const shipments: Shipment[] = [
    { id: 'S-BKK-1100', zone: 'bangkok', date: '2026-10-15', weightGram: 1100, remote: false, sourceId: shipmentSource.id, row: 2 },
    { id: 'S-BKK-1000', zone: 'bangkok', date: '2026-10-14', weightGram: 1000, remote: false, sourceId: shipmentSource.id, row: 3 },
    { id: 'S-BKK-REMOTE-1100', zone: 'bangkok', date: '2026-10-20', weightGram: 1100, remote: true, sourceId: shipmentSource.id, row: 4 },
    { id: 'S-REMOTE-1100', zone: 'regional', date: '2026-10-20', weightGram: 1100, remote: true, sourceId: shipmentSource.id, row: 5 },
  ];
  const invoiceLines: InvoiceLine[] = [
    { id: 'S-BKK-1100', billedSatang: 5000, currency: 'THB', sourceId: invoiceSource.id, row: 2 },
    { id: 'S-BKK-1000', billedSatang: 4000, currency: 'THB', sourceId: invoiceSource.id, row: 3 },
    { id: 'S-BKK-REMOTE-1100', billedSatang: 6000, currency: 'THB', sourceId: invoiceSource.id, row: 4 },
    { id: 'S-REMOTE-1100', billedSatang: 7000, currency: 'THB', sourceId: invoiceSource.id, row: 5 },
  ];
  const rules: RateRule[] = [
    { id: 'base-bangkok-before-15', kind: 'base', zone: 'bangkok', amountSatang: 4000, from: '2000-01-01', to: '2026-10-15', sourceId: rateSource.id, enabled: true },
    { id: 'base-regional-before-15', kind: 'base', zone: 'regional', amountSatang: 5000, from: '2000-01-01', to: '2026-10-15', sourceId: rateSource.id, enabled: true },
    { id: 'base-bangkok-from-15', kind: 'base', zone: 'bangkok', amountSatang: 3500, from: '2026-10-15', to: null, sourceId: rateSource.id, enabled: true },
    { id: 'base-regional-from-15', kind: 'base', zone: 'regional', amountSatang: 4500, from: '2026-10-15', to: null, sourceId: rateSource.id, enabled: true },
    { id: 'started-kg-step', kind: 'step', zone: '*', amountSatang: 1000, from: '2000-01-01', to: null, sourceId: rateSource.id, enabled: true },
  ];
  const change = { kind: 'invoice' as const, operations: [] };
  const initialRevision: RevisionRecord = {
    revision: 0,
    change,
    activatedAt: ctx.now,
    actorId: ctx.actorId,
    candidateHash: hash(ctx, { workspaceId: ctx.workspaceId, revision: 0, change, actorId: ctx.actorId, time: ctx.now }),
    snapshot: { kind: 'invoice', rules: structuredClone(rules) },
  };
  return {
    kind: 'invoice', dataRevision: 1, ruleRevision: 0, candidate: null, revisions: [initialRevision],
    shipments, invoiceLines, sources, rules, runs: [],
  };
}

export function handleInvoiceCommand(state: InvoiceState, type: string, payload: unknown, ctx: ActorContext): { state: InvoiceState; label: string } | null {
  if (type === 'invoice.import') {
    assert(ctx.role === 'owner', 'FORBIDDEN', 'Only the invoice owner can import evidence.');
    const input = parsePayload(invoiceImportSchema, payload);
    assert(input.artifact.status === 'provided', 'SOURCE_STATUS_INVALID', 'Imported evidence must start as provided and await human review.');
    assert(input.artifact.reviewedBy === undefined, 'SOURCE_STATUS_INVALID', 'An imported artifact cannot claim a completed human review.');
    assert(!state.sources.some((source) => source.id === input.artifact.id), 'DUPLICATE_SOURCE', 'Source IDs are immutable and cannot be reused.');
    assert(state.sources.length < 20, 'SOURCE_QUOTA', 'This table holds at most 20 evidence sources. Export your work and start another table.');
    if (input.shipments) {
      assert(input.artifact.kind === 'shipments', 'SOURCE_KIND_MISMATCH', 'Shipment rows must come from a shipments artifact.');
      assert(input.shipments.every((row) => row.sourceId === input.artifact.id), 'SOURCE_MISMATCH', 'Every shipment row must refer to the imported artifact.');
      assert(new Set(input.shipments.map((row) => row.row)).size === input.shipments.length, 'DUPLICATE_SOURCE_ROW', 'Shipment source row references must be unique within an artifact.');
    }
    if (input.invoiceLines) {
      assert(input.artifact.kind === 'invoice', 'SOURCE_KIND_MISMATCH', 'Invoice lines must come from an invoice artifact.');
      assert(input.invoiceLines.every((row) => row.sourceId === input.artifact.id), 'SOURCE_MISMATCH', 'Every invoice line must refer to the imported artifact.');
      assert(new Set(input.invoiceLines.map((row) => row.row)).size === input.invoiceLines.length, 'DUPLICATE_SOURCE_ROW', 'Invoice source row references must be unique within an artifact.');
    }
    assert(Boolean(input.shipments) || Boolean(input.invoiceLines) || input.artifact.kind === 'rate-card' || input.artifact.kind === 'excerpt', 'EMPTY_IMPORT', 'The import contains no normalized rows.');
    const next = structuredClone(state);
    next.sources.push(structuredClone(input.artifact));
    // A file represents the complete current table. Keep immutable sources and saved
    // runs so the next period can reuse approved rules without merging old periods.
    if (input.shipments) next.shipments = structuredClone(input.shipments);
    if (input.invoiceLines) next.invoiceLines = structuredClone(input.invoiceLines);
    assert(next.shipments.length <= MAX_ROWS && next.invoiceLines.length <= MAX_ROWS, 'ROW_LIMIT', 'The combined dataset exceeds 10,000 rows per table.');
    next.dataRevision += 1;
    return { state: next, label: 'Evidence imported as provided.' };
  }
  if (type === 'invoice.reviewSource') {
    assert(ctx.role === 'owner', 'FORBIDDEN', 'Only the invoice owner can review evidence.');
    const input = parsePayload(reviewSourceSchema, payload);
    const source = state.sources.find((item) => item.id === input.sourceId);
    assert(source, 'SOURCE_NOT_FOUND', 'The source does not exist in this invoice workspace.');
    assert(source.status === 'provided', 'SOURCE_ALREADY_REVIEWED', 'Only provided evidence can receive its first review decision.');
    const next = structuredClone(state);
    const updated = next.sources.find((item) => item.id === input.sourceId);
    if (updated) {
      updated.status = input.status;
      updated.reviewedBy = ctx.actorId;
    }
    next.dataRevision += 1;
    return { state: next, label: `Source marked ${input.status}.` };
  }
  if (type === 'invoice.sample') {
    assert(ctx.role === 'owner', 'FORBIDDEN', 'Only the invoice owner can load the sample dataset.');
    parsePayload(noPayloadSchema, payload);
    const fresh = createInvoiceState(ctx);
    const suffix = hash(ctx, { workspaceId: ctx.workspaceId, nextDataRevision: state.dataRevision + 1, now: ctx.now }).slice(0, 16);
    const shipmentSource = fresh.sources.find((source) => source.kind === 'shipments');
    const invoiceSource = fresh.sources.find((source) => source.kind === 'invoice');
    assert(shipmentSource && invoiceSource, 'SAMPLE_UNAVAILABLE', 'The normalized sample artifacts are incomplete.');
    const nextShipmentSource = { ...shipmentSource, id: `${shipmentSource.id}_${suffix}` };
    const nextInvoiceSource = { ...invoiceSource, id: `${invoiceSource.id}_${suffix}` };
    const shipments = fresh.shipments.map((shipment) => ({ ...shipment, sourceId: nextShipmentSource.id }));
    const invoiceLines = fresh.invoiceLines.map((line) => ({ ...line, sourceId: nextInvoiceSource.id }));
    return {
      state: {
        ...state,
        dataRevision: state.dataRevision + 1,
        candidate: structuredClone(state.candidate),
        shipments,
        invoiceLines,
        sources: [...structuredClone(state.sources), nextShipmentSource, nextInvoiceSource],
        rules: structuredClone(state.rules),
        revisions: structuredClone(state.revisions),
        runs: structuredClone(state.runs),
      },
      label: 'A fresh sample dataset loaded under the existing approved rates; prior runs and sources were retained.',
    };
  }
  if (type === 'invoice.saveRun') {
    assert(ctx.role === 'owner', 'FORBIDDEN', 'Only the invoice owner can save a reconciliation run.');
    parsePayload(saveRunSchema, payload);
    const next = structuredClone(state);
    const result = reconcileInvoice(next);
    const sourceIds = [...new Set([...next.shipments.map((row) => row.sourceId), ...next.invoiceLines.map((row) => row.sourceId)])].sort();
    const runId = `run_${hash(ctx, { dataRevision: next.dataRevision, ruleRevision: next.ruleRevision, sourceIds, createdAt: ctx.now, count: next.runs.length })}`;
    next.runs.push({ id: runId, createdAt: ctx.now, dataRevision: next.dataRevision, ruleRevision: next.ruleRevision, result, sourceIds });
    return { state: next, label: `Reconciliation saved with ${result.unknownCount} unresolved rows.` };
  }
  return null;
}

export function applyInvoiceOperations(state: InvoiceState, operations: z.infer<typeof invoiceChangeSchema>['operations']): RateRule[] {
  const rules = structuredClone(state.rules);
  for (const operation of operations) {
    const existingIndex = rules.findIndex((rule) => rule.id === operation.id);
    if (operation.op === 'disableRule') {
      assert(existingIndex >= 0, 'RULE_NOT_FOUND', `Rule ${operation.id} does not exist.`);
      rules[existingIndex] = { ...rules[existingIndex], enabled: false };
      continue;
    }
    if (operation.op === 'setEffectiveWindow') {
      assert(existingIndex >= 0, 'RULE_NOT_FOUND', `Rule ${operation.id} does not exist.`);
      rules[existingIndex] = { ...rules[existingIndex], from: operation.from, to: operation.to };
      continue;
    }
    const kind: RateRule['kind'] = operation.op === 'setZoneBase' ? 'base' : operation.op === 'setWeightStep' ? 'step' : 'surcharge';
    if (existingIndex >= 0) {
      rules[existingIndex] = { ...rules[existingIndex], kind, zone: operation.zone, amountSatang: operation.amountSatang, from: operation.from, to: operation.to, sourceId: operation.sourceId, enabled: true };
    } else {
      rules.push({ id: operation.id, kind, zone: operation.zone, amountSatang: operation.amountSatang, from: operation.from, to: operation.to, sourceId: operation.sourceId, enabled: true });
    }
  }
  return rules;
}
