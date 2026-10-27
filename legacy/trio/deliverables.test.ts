import { describe, expect, it } from 'vitest';
import { initialRules, taughtRules, verifyRules } from './domain';
import { buildTrioDeliverables, escapeCsvCell } from './deliverables';
import type { CaseId, TrioSnapshot } from './types';

const GENERATED_AT = new Date('2026-10-15T04:05:06.000Z');

function snapshot(caseId: CaseId): TrioSnapshot {
  const active = initialRules();
  return {
    caseId,
    level: 8,
    active,
    draft: structuredClone(active),
    simulation: structuredClone(active),
    evaluation: null,
    version: 1,
    approved: true,
    events: [],
    handoff: 'waiting',
  };
}

describe('demo deliverables', () => {
  it('exports shipping results from Active and leaves missing weight unresolved', () => {
    const current = snapshot('shipping');
    current.draft = taughtRules();
    current.simulation.shipping.bangkok = 30;
    const bundle = buildTrioDeliverables(current, GENERATED_AT);

    expect(bundle.csv.filename).toBe('shipping-results-v1.csv');
    expect(bundle.csv.contents.startsWith('\uFEFF')).toBe(true);
    expect(bundle.csv.contents).toContain('"SH-001","Bangkok","1","2026-10-15","40","40","0"');
    expect(bundle.csv.contents).toContain('"SH-006","ต่างจังหวัด","ไม่ระบุน้ำหนัก","2026-10-15","50","ยังไม่คำนวณ","ไม่ทราบ"');
    expect(bundle.summary).toMatchObject({
      activeVersion: 1,
      resultCount: 8,
      resolvedCount: 5,
      reviewCount: 3,
      unresolvedHandoffCount: 1,
      draftMatchesActive: false,
      draftCheckPassed: 8,
      draftCheckFailed: 0,
    });
    expect(bundle.summary.values).toMatchObject({ bangkokRate: 40, regionalRate: 50, effectiveDate: '2026-10-01' });
    expect(bundle.report.contents).toContain('Draft ปัจจุบันต่างจาก Active');
    expect(bundle.report.contents).toContain('ไม่เปลี่ยนผล Active');
  });

  it('builds the quest plan from active hint thresholds and reveal behavior', () => {
    const current = snapshot('quest');
    current.draft = taughtRules();
    current.simulation.quest.firstHint = 60;
    current.evaluation = verifyRules('quest', initialRules());
    current.draft.quest.firstHint = 180;
    const bundle = buildTrioDeliverables(current, GENERATED_AT);

    expect(bundle.csv.filename).toBe('quest-hint-plan-v1.csv');
    expect(bundle.csv.contents).toContain('"คำใบ้แรก","300","5","true","false"');
    expect(bundle.csv.contents).toContain('"คำใบ้ที่สอง","480","8","true","true"');
    expect(bundle.summary.values).toMatchObject({ firstHintSeconds: 300, secondHintSeconds: 480, autoReveal: true });
    expect(bundle.summary.savedEvaluationState).toBe('stale');
    expect(bundle.report.contents).toContain('stale');
    expect(bundle.report.contents).toContain('2026-10-15T04:05:06.000Z');
  });

  it('exports encounter HP from Active and compares baseline, Draft, and Active runtime results', () => {
    const current = snapshot('quest');
    current.active.quest = { ...current.active.quest, encounter: { allyShield: false, shieldReduction: 2 } };
    current.draft = taughtRules();
    current.draft.quest = { ...current.draft.quest, encounter: { allyShield: true, shieldReduction: 2 } };
    current.evaluation = verifyRules('quest', current.draft);
    const bundle = buildTrioDeliverables(current, GENERATED_AT);

    expect(bundle.csv.filename).toBe('quest-encounter-v1.csv');
    expect(bundle.csv.contents).toContain('"EN-001","14 · 12 · 16","โล่คุ้มกันตัวเอง","ชนะ · Goblin หมด HP","10","6","0"');
    expect(bundle.summary).toMatchObject({ resultCount: 1, resolvedCount: 1, reviewCount: 0, draftCheckPassed: 8, draftCheckFailed: 0 });
    expect(bundle.summary.values).toMatchObject({
      oldPipHp: 6,
      draftPipHp: 8,
      activePipHp: 6,
      oldGoblinHp: 0,
      draftGoblinHp: 0,
      activeGoblinHp: 0,
    });
    expect(bundle.report.contents).toContain('เทียบ HP ก่อนปรับ, Draft และ Active');
    expect(bundle.report.contents).toContain('Mira → Goblin → Pip');
    expect(bundle.report.contents).toContain('src/trio/creative/encounterModel.ts');
    expect(bundle.report.contents).toContain('ผลจาก encounter runtime');
  });

  it('exports all music sections with active BPM, repetition, beats and duration', () => {
    const current = snapshot('music');
    current.active.music = { chorusBpm: 84, otherBpm: 102, repetitions: 2 };
    current.draft.music = taughtRules().music;
    current.simulation.music = { chorusBpm: 60, otherBpm: 102, repetitions: 2 };
    const bundle = buildTrioDeliverables(current, GENERATED_AT);

    expect(bundle.csv.filename).toBe('music-rehearsal-plan-v1.csv');
    expect(bundle.csv.contents).toContain('"MU-004","Chorus (ท่อนฮุก)","84","2","8","16","11.43"');
    expect(bundle.csv.contents).toContain('"MU-001","Intro (ท่อนเปิด)","102","1","4","4","2.35"');
    expect(bundle.summary).toMatchObject({ resultCount: 7, resolvedCount: 7, reviewCount: 0, draftMatchesActive: false });
    expect(bundle.summary.values).toMatchObject({ chorusBpm: 84, otherBpm: 102, repetitions: 2 });
    expect(bundle.report.contents).toContain('ท่อนฮุก 84 BPM · 2 รอบ');
  });

  it('escapes HTML evidence and safely quotes CSV cells', () => {
    const current = snapshot('music');
    current.events = [{
      id: 'event<&1',
      kind: 'source',
      title: 'บันทึกจากคนซ้อม <script>alert(1)</script>',
      detail: 'คำสังเกต </p><img src=x onerror=alert(1)> & "ลองช้าลง"',
      version: 1,
      at: '2026-10-15T04:00:00.000Z',
      references: ['run<&1'],
    }];
    const bundle = buildTrioDeliverables(current, GENERATED_AT);

    expect(bundle.report.contents).toContain('บันทึกจากคนซ้อม &lt;script&gt;alert(1)&lt;/script&gt;');
    expect(bundle.report.contents).toContain('คำสังเกต &lt;/p&gt;&lt;img src=x onerror=alert(1)&gt; &amp; &quot;ลองช้าลง&quot;');
    expect(bundle.report.contents).not.toContain('<script>alert(1)</script>');
    expect(bundle.report.contents).toContain('event&lt;&amp;1');
    expect(escapeCsvCell('=HYPERLINK("x")')).toBe('"\'=HYPERLINK(""x"")"');
    expect(escapeCsvCell('-1+2')).toBe('"\'-1+2"');
    expect(escapeCsvCell('ordinary, value')).toBe('"ordinary, value"');
  });
});
