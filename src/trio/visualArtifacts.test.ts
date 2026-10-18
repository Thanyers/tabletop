import { describe, expect, it } from 'vitest';
import { initialRules, taughtRules } from './domain';
import { buildVisualArtifact, escapeXml } from './visualArtifacts';

describe('buildVisualArtifact', () => {
  it('creates a rate-card SVG from the supplied active rates and keeps unknown weights unresolved', () => {
    const active = taughtRules();
    const artifact = buildVisualArtifact('shipping', active, 2);

    expect(artifact.file.filename).toBe('shipping-rate-card-v2.svg');
    expect(artifact.file.mimeType).toContain('image/svg+xml');
    expect(artifact.file.contents).toContain('฿35');
    expect(artifact.file.contents).toContain('฿45');
    expect(artifact.file.contents).toContain('SH-006 · ยังไม่ทราบน้ำหนัก');
    expect(artifact.file.contents).not.toContain('Simulation');
    expect(artifact.activeFingerprint).not.toBe(buildVisualArtifact('shipping', initialRules(), 1).activeFingerprint);
  });

  it('uses the active rules alone when draft and simulation contain different candidate values', () => {
    const snapshot = {
      active: initialRules(),
      draft: taughtRules(),
      simulation: { ...taughtRules(), shipping: { ...taughtRules().shipping, bangkok: 30 } },
      version: 1,
    };
    const artifact = buildVisualArtifact('shipping', snapshot.active, snapshot.version);

    expect(artifact.previewSvg).toContain('฿40');
    expect(artifact.previewSvg).toContain('฿50');
    expect(artifact.previewSvg).not.toContain('฿35');
    expect(artifact.previewSvg).not.toContain('฿30');
  });

  it('escapes data in SVG text rather than treating it as markup', () => {
    const active = taughtRules();
    active.shipping.effectiveDate = '</text><script>alert(1)</script>';
    const artifact = buildVisualArtifact('shipping', active, 2);

    expect(escapeXml(`<svg title="&">'`)).toBe('&lt;svg title=&quot;&amp;&quot;&gt;&apos;');
    expect(artifact.previewSvg).toContain('&lt;/text&gt;&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(artifact.previewSvg).not.toContain('</text><script>');
  });

  it('draws quest clue timing from active rules without inventing an automatic answer reveal', () => {
    const active = taughtRules();
    const artifact = buildVisualArtifact('quest', active, 2);

    expect(artifact.file.filename).toBe('treasure-route-v2.svg');
    expect(artifact.previewSvg).toContain('คำใบ้ · 03:00');
    expect(artifact.previewSvg).toContain('คำใบ้ · 05:00');
    expect(artifact.previewSvg).toContain('ผู้เล่นเลือกขอเฉลย');
    expect(artifact.previewSvg).toContain('ไม่มีการเปิดคำตอบเอง');
  });

  it('renders an encounter result and exports the playable encounter when an encounter rule is present', () => {
    const active = taughtRules();
    active.quest = { ...active.quest, encounter: { allyShield: true, shieldReduction: 2 } };
    const artifact = buildVisualArtifact('quest', active, 3);

    expect(artifact.file.filename).toBe('encounter-lab-v3.html');
    expect(artifact.file.mimeType).toContain('text/html');
    expect(artifact.file.contents).toContain('Mira · ผู้พิทักษ์');
    expect(artifact.file.contents).toContain('d20 [14, 12, 16]');
    expect(artifact.previewSvg).toContain('Active v3');
    expect(artifact.previewSvg).toContain('10 / 10 HP');
    expect(artifact.previewSvg).toContain('8 / 10 HP');
    expect(artifact.previewSvg).toContain('0 / 6 HP');
    expect(artifact.previewSvg).toContain('โล่ของ Mira ช่วย Pip · ลด 2 HP');
    expect(artifact.previewSvg).not.toContain('ด่านสวน');
  });

  it('builds a paused motion guide whose beat interval and practice plan follow active music rules', () => {
    const active = taughtRules();
    const artifact = buildVisualArtifact('music', active, 2);

    expect(artifact.file.filename).toBe('rehearsal-motion-guide-v2.html');
    expect(artifact.file.mimeType).toContain('text/html');
    expect(artifact.motionMetrics).toMatchObject({ chorusBpm: 80, repetitions: 3, beatMilliseconds: 750 });
    expect(artifact.motionMetrics?.chorusSeconds).toBeCloseTo(18, 5);
    expect(artifact.file.contents).toContain('const plan=');
    expect(artifact.file.contents).toContain('(60000/section.bpm)');
    expect(artifact.file.contents).toContain('prefers-reduced-motion:reduce');
    expect(artifact.file.contents).toContain('let sectionIndex=0;let repetition=1;let beat=1;let running=false');
    expect(artifact.file.contents).toContain("connect-src 'none'");
    expect(artifact.file.contents).toContain("media-src 'none'");
    expect(artifact.file.contents).toContain('ไม่เริ่มเอง');
    expect(artifact.file.contents).not.toContain('<audio');
    expect(buildVisualArtifact('music', active, 2).file.contents).toBe(artifact.file.contents);
  });
});
