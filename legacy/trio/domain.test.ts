import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  canApprove,
  initialRules,
  musicPlan,
  questStatus,
  rulesFingerprint,
  shippingResults,
  taughtRules,
  verifyRules,
} from './domain';
import type { RuleBook } from './types';

type ShippingCsvRow = {
  id: string;
  name: string;
  zone: 'bangkok' | 'regional';
  date: string;
  weight: number | null;
  billed: number;
};

function parseShippingCsv(source: string): ShippingCsvRow[] {
  const [headerLine, ...dataLines] = source.trim().split(/\r?\n/);
  if (headerLine === undefined) throw new Error('Shipping fixture CSV has no header.');
  const headers = headerLine.split(',');
  return dataLines.map((line) => {
    const cells = line.split(',');
    const row = new Map(headers.map((header, index) => [header, cells[index] ?? '']));
    const zone = row.get('zone');
    if (zone !== 'bangkok' && zone !== 'regional') throw new Error('Shipping fixture CSV has an unknown zone.');
    const rawWeight = row.get('weight') ?? '';
    return {
      id: row.get('id') ?? '',
      name: row.get('name') ?? '',
      zone,
      date: row.get('date') ?? '',
      weight: rawWeight === '' ? null : Number(rawWeight),
      billed: Number(row.get('billed')),
    };
  });
}

function loadShippingContract(): Record<string, unknown> {
  const source = readFileSync(new URL('../../public/data/shipping-contract.json', import.meta.url), 'utf8');
  const contract: unknown = JSON.parse(source);
  if (typeof contract !== 'object' || contract === null) throw new Error('Shipping contract fixture must be an object.');
  return contract as Record<string, unknown>;
}

describe('TRIO rule presets', () => {
  it('returns fresh baseline and taught rules with the authored values', () => {
    expect(initialRules()).toEqual({
      shipping: { bangkok: 40, regional: 50, extraKg: 10, effectiveDate: '2026-10-01' },
      quest: { firstHint: 300, secondHint: 480, autoReveal: true },
      music: { chorusBpm: 100, otherBpm: 100, repetitions: 1 },
    });
    expect(taughtRules()).toEqual({
      shipping: { bangkok: 35, regional: 45, extraKg: 10, effectiveDate: '2026-10-15' },
      quest: { firstHint: 180, secondHint: 300, autoReveal: false },
      music: { chorusBpm: 80, otherBpm: 100, repetitions: 3 },
    });
    const changed = taughtRules();
    changed.shipping.bangkok = 999;
    expect(taughtRules().shipping.bangkok).toBe(35);
  });
});

describe('shippingResults', () => {
  it('matches the six downloaded order rows and preserves their billed values', () => {
    const source = readFileSync(new URL('../../public/data/shipping-orders.csv', import.meta.url), 'utf8');
    const sourceRows = parseShippingCsv(source);
    const sourceIds = new Set(sourceRows.map((row) => row.id));
    const resultRows = shippingResults(taughtRules().shipping)
      .filter((row) => sourceIds.has(row.id))
      .map(({ id, name, zone, date, weight, billed }) => ({ id, name, zone, date, weight, billed }));

    expect(resultRows).toEqual(sourceRows);
  });

  it('follows the independent contract JSON and applies each started kilogram', () => {
    const contract = loadShippingContract();
    const shipping = taughtRules().shipping;
    expect(shipping).toEqual({
      bangkok: contract.bangkok,
      regional: contract.regional,
      extraKg: contract.extraStartedKg,
      effectiveDate: contract.effectiveDate,
    });

    const results = shippingResults(shipping);
    expect(results.slice(0, 5).map(({ id, amount, billed }) => ({ id, amount, billed }))).toEqual([
      { id: 'SH-001', amount: 35, billed: 40 },
      { id: 'SH-002', amount: 45, billed: 50 },
      { id: 'SH-003', amount: 45, billed: 50 },
      { id: 'SH-004', amount: 55, billed: 60 },
      { id: 'SH-005', amount: 40, billed: 40 },
    ]);
  });

  it('holds missing, negative, and non-finite weights for manual review', () => {
    const results = shippingResults(taughtRules().shipping);
    expect(results.slice(5).map(({ amount }) => amount)).toEqual([null, null, null]);
    expect(results.slice(5).every((result) => result.reason.length > 0)).toBe(true);
  });

  it('rejects invalid calendar and timezone effective dates', () => {
    const rule = taughtRules().shipping;
    for (const effectiveDate of ['2026-02-29', '2026-10-15T00:00:00Z']) {
      const invalidBook: RuleBook = { ...taughtRules(), shipping: { ...rule, effectiveDate } };
      expect(shippingResults(invalidBook.shipping).every((row) => row.amount === null)).toBe(true);
      expect(verifyRules('shipping', invalidBook).failed).toBe(8);
    }
  });

  it('rejects negative and non-finite rule values', () => {
    const base = taughtRules();
    const invalidBooks: RuleBook[] = [
      { ...base, shipping: { ...base.shipping, bangkok: -1 } },
      { ...base, shipping: { ...base.shipping, regional: Number.NaN } },
      { ...base, shipping: { ...base.shipping, extraKg: Number.POSITIVE_INFINITY } },
    ];
    for (const book of invalidBooks) {
      expect(verifyRules('shipping', book).failed).toBe(8);
      expect(canApprove('shipping', book, verifyRules('shipping', book))).toBe(false);
    }
  });
});

describe('questStatus', () => {
  it('switches hints at the authored boundaries, suppresses hints after solving, and handles absent time', () => {
    const rule = taughtRules().quest;
    expect(questStatus(rule, 179)).toMatchObject({ hintLevel: 0, answerRevealed: false });
    expect(questStatus(rule, 180)).toMatchObject({ hintLevel: 1, answerRevealed: false });
    expect(questStatus(rule, 299)).toMatchObject({ hintLevel: 1, answerRevealed: false });
    expect(questStatus(rule, 300)).toMatchObject({ hintLevel: 2, answerRevealed: false });
    expect(questStatus(rule, 480)).toMatchObject({ hintLevel: 2, answerRevealed: false });
    expect(questStatus(rule, 300, true)).toMatchObject({
      hintLevel: 0,
      answerRevealed: false,
    });
    expect(questStatus(rule, 300, true).summary.length).toBeGreaterThan(0);
    expect(questStatus(rule, Number.NaN)).toMatchObject({ hintLevel: 0, answerRevealed: false });
    expect(questStatus(initialRules().quest, 480).answerRevealed).toBe(true);
    expect(questStatus(rule, -1).hintLevel).toBe(0);
  });

  it('rejects invalid hint rules without producing a hint', () => {
    expect(questStatus({ firstHint: -1, secondHint: 300, autoReveal: false }, 300)).toMatchObject({
      hintLevel: 0,
      answerRevealed: false,
    });
    expect(questStatus({ firstHint: 180, secondHint: Number.NaN, autoReveal: false }, 300).hintLevel).toBe(0);
  });
});

describe('musicPlan', () => {
  it('matches every baseline section to the downloadable human rehearsal record', () => {
    const csv=readFileSync(new URL('../../public/data/music-rehearsal.csv',import.meta.url),'utf8').trim().split(/\r?\n/).slice(1).map(line=>line.split(','));
    const plan=musicPlan(initialRules().music);
    expect(csv.map(row=>({id:row[0],bpm:Number(row[2]),beats:Number(row[3])}))).toEqual(plan.map(section=>({id:section.id,bpm:section.bpm,beats:section.beats})));
  });
  it('keeps the chorus at eight beats with three slower repetitions and leaves other sections at 100 BPM', () => {
    const plan = musicPlan(taughtRules().music);
    expect(plan).toHaveLength(7);
    const chorus = plan.find((section) => section.id === 'MU-004');
    expect(chorus).toMatchObject({
      id: 'MU-004', bpm: 80, repetitions: 3, beats: 8, seconds: 18,
    });
    expect(chorus?.name.length).toBeGreaterThan(0);
    expect(plan.filter((section) => section.id !== 'MU-004').every((section) => (
      section.bpm === 100 && section.repetitions === 1
    ))).toBe(true);
    expect(musicPlan({ chorusBpm: 80, otherBpm: 100, repetitions: Number.NaN })).toEqual([]);
    expect(musicPlan({ chorusBpm: 0, otherBpm: 100, repetitions: 3 })).toEqual([]);
    expect(musicPlan({ chorusBpm: Number.MIN_VALUE, otherBpm: 100, repetitions: 3 })).toEqual([]);
  });
});

describe('independent verification and approval', () => {
  it('provides six to eight readable examples per case and passes the taught rules', () => {
    const book = taughtRules();
    const shipping = verifyRules('shipping', book);
    const quest = verifyRules('quest', book);
    const music = verifyRules('music', book);

    expect(shipping.cases).toHaveLength(8);
    expect(quest.cases).toHaveLength(8);
    expect(music.cases).toHaveLength(8);
    for (const evaluation of [shipping, quest, music]) {
      expect(evaluation.failed).toBe(0);
      expect(evaluation.passed).toBe(evaluation.cases.length);
      expect(evaluation.cases.every((sample) => sample.input.length > 0
        && sample.expected.length > 0
        && sample.actual.length > 0
        && sample.reason.length > 0)).toBe(true);
    }
  });

  it('reports authored regressions from the initial rules instead of deriving expectations from them', () => {
    const book = initialRules();
    expect(verifyRules('shipping', book).failed).toBe(5);
    expect(verifyRules('quest', book).failed).toBe(5);
    expect(verifyRules('music', book).failed).toBe(1);
  });

  it('approves only a complete passing evaluation for the same case and fingerprint', () => {
    const book = taughtRules();
    const evaluation = verifyRules('shipping', book);
    expect(canApprove('shipping', book, null)).toBe(false);
    expect(canApprove('shipping', book, evaluation)).toBe(true);
    expect(canApprove('quest', book, evaluation)).toBe(false);
    expect(canApprove('shipping', initialRules(), evaluation)).toBe(false);

    const changedShipping: RuleBook = {
      ...book,
      shipping: { ...book.shipping, bangkok: 36 },
    };
    expect(canApprove('shipping', changedShipping, evaluation)).toBe(false);

    const changedUnrelatedCase: RuleBook = {
      ...book,
      quest: { ...book.quest, secondHint: 301 },
    };
    expect(canApprove('shipping', changedUnrelatedCase, evaluation)).toBe(true);
  });

  it('rejects failed, incomplete, NaN-count, and stale evaluations', () => {
    const book = taughtRules();
    const evaluation = verifyRules('shipping', book);
    const failedCases = evaluation.cases.map((sample, index) => (
      index === 0 ? { ...sample, passed: false } : sample
    ));
    const failedEvaluation = { ...evaluation, cases: failedCases };
    const incompleteEvaluation = {
      ...evaluation,
      cases: evaluation.cases.slice(1),
      passed: evaluation.passed - 1,
    };
    const nonFiniteCountEvaluation = { ...evaluation, passed: Number.NaN };

    expect(canApprove('shipping', book, failedEvaluation)).toBe(false);
    expect(canApprove('shipping', book, incompleteEvaluation)).toBe(false);
    expect(canApprove('shipping', book, nonFiniteCountEvaluation)).toBe(false);
    expect(canApprove('shipping', book, verifyRules('shipping', initialRules()))).toBe(false);
  });

  it('isolates a simulated rule change and leaves active rules and results untouched', () => {
    const active = taughtRules();
    const original = structuredClone(active);
    const activePlan = musicPlan(active.music);
    Object.freeze(active.shipping);
    Object.freeze(active.quest);
    Object.freeze(active.music);
    Object.freeze(active);
    const simulation: RuleBook = { ...active, music: { ...active.music, chorusBpm: 70 } };

    const simulatedPlan = musicPlan(simulation.music);
    expect(simulatedPlan.find((section) => section.id === 'MU-004')?.bpm).toBe(70);
    expect(active.music.chorusBpm).toBe(80);
    expect(musicPlan(active.music)).toEqual(activePlan);
    expect(active).toEqual(original);
    expect(verifyRules('music', simulation).failed).toBe(1);
    expect(active).toEqual(original);
  });

  it('fingerprints only the selected case and distinguishes malformed numeric inputs', () => {
    const book = taughtRules();
    const changedQuest: RuleBook = { ...book, quest: { ...book.quest, secondHint: 301 } };
    const invalidShipping: RuleBook = { ...book, shipping: { ...book.shipping, bangkok: Number.NaN } };
    expect(rulesFingerprint('shipping', book)).toBe(rulesFingerprint('shipping', changedQuest));
    expect(rulesFingerprint('shipping', book)).not.toBe(rulesFingerprint('shipping', invalidShipping));
    expect(rulesFingerprint('quest', initialRules())).toBe('trio-v1:quest:3:300:3:480:4:true');
    expect(rulesFingerprint('quest', initialRules())).not.toBe(rulesFingerprint('quest', withEncounter(initialRules(), { allyShield: false, shieldReduction: 2 })));
  });

  it('verifies authored encounter behavior against the runtime, including shield, misses and HP clamping', () => {
    const taught = withEncounter(taughtRules(), { allyShield: true, shieldReduction: 2 });
    const initial = withEncounter(initialRules(), { allyShield: false, shieldReduction: 2 });
    const evaluation = verifyRules('quest', taught);

    expect(evaluation.cases.map((sample) => sample.id)).toEqual([
      'QE-001', 'QE-002', 'QE-003', 'QE-004', 'QE-005', 'QE-006', 'QE-007', 'QE-008',
    ]);
    expect(evaluation.failed).toBe(0);
    expect(evaluation.cases.find((sample) => sample.id === 'QE-001')?.actual).toContain('Pip 8/10 HP');
    expect(evaluation.cases.find((sample) => sample.id === 'QE-002')?.actual).toContain('Pip เหลือ 8/10 HP');
    expect(evaluation.cases.find((sample) => sample.id === 'QE-003')?.actual).toContain('Goblin 0/6 HP');
    expect(evaluation.cases.find((sample) => sample.id === 'QE-004')?.actual).toContain('Pip 6/10 HP');
    expect(evaluation.cases.find((sample) => sample.id === 'QE-006')?.actual).toContain('Goblin เหลือ 0/2 HP');
    expect(verifyRules('quest', initial).failed).toBe(2);
  });

  it('rejects malformed encounter rules and prevents stale or failed encounter approval', () => {
    const taught = withEncounter(taughtRules(), { allyShield: true, shieldReduction: 2 });
    const evaluation = verifyRules('quest', taught);
    expect(canApprove('quest', taught, evaluation)).toBe(true);

    for (const shieldReduction of [-1, Number.NaN, Number.POSITIVE_INFINITY, 7]) {
      const invalid = withEncounter(taught, { allyShield: true, shieldReduction });
      const invalidEvaluation = verifyRules('quest', invalid);
      expect(invalidEvaluation.failed).toBe(8);
      expect(canApprove('quest', invalid, invalidEvaluation)).toBe(false);
    }

    const changedShield = withEncounter(taught, { allyShield: false, shieldReduction: 2 });
    expect(rulesFingerprint('quest', changedShield)).not.toBe(rulesFingerprint('quest', taught));
    expect(canApprove('quest', changedShield, evaluation)).toBe(false);
    const failedCaseEvaluation = {
      ...evaluation,
      cases: evaluation.cases.map((sample, index) => index === 0 ? { ...sample, passed: false } : sample),
    };
    expect(canApprove('quest', taught, failedCaseEvaluation)).toBe(false);
  });

  it('keeps simulation and verification from mutating active encounter rules', () => {
    const active = withEncounter(taughtRules(), { allyShield: true, shieldReduction: 2 });
    const original = structuredClone(active);
    const simulation = withEncounter(active, { allyShield: true, shieldReduction: 4 });

    expect(verifyRules('quest', simulation).failed).toBeGreaterThan(0);
    expect(verifyRules('quest', active).failed).toBe(0);
    expect(active).toEqual(original);
  });
});

function withEncounter(book: RuleBook, encounter: { allyShield: boolean; shieldReduction: number }): RuleBook {
  return { ...book, quest: { ...book.quest, encounter } };
}
