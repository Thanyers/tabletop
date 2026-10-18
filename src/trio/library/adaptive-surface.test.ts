import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AdaptiveSurface } from './AdaptiveSurface';
import { PRESENTATION_OPTIONS, resolveSurface } from './resolveSurface';
import { STANDARD_COMPONENTS, STANDARD_RENDERERS } from './StandardComponents';
import { initialRules, taughtRules } from '../domain';
import type { CaseId, TrioSnapshot } from '../types';

function makeSnapshot(caseId: CaseId): TrioSnapshot {
  return {
    caseId,
    level: 8,
    active: taughtRules(),
    draft: initialRules(),
    simulation: initialRules(),
    evaluation: null,
    version: 2,
    approved: true,
    events: [],
    handoff: 'in-progress',
  };
}

describe('adaptive surface library', () => {
  it('resolves only active rules for shipping, quest, and music', () => {
    const shipping = makeSnapshot('shipping');
    shipping.active.shipping = { bangkok: 35, regional: 45, extraKg: 10, effectiveDate: '2026-10-15' };
    shipping.draft.shipping = { bangkok: 2, regional: 3, extraKg: 4, effectiveDate: '2026-10-01' };
    shipping.simulation.shipping = { bangkok: 99, regional: 98, extraKg: 97, effectiveDate: '2026-10-01' };
    const shippingView = resolveSurface(shipping);
    expect(shippingView.records.find((record) => record.id === 'SH-001')?.fields.amount.text).toBe('฿35.00');
    expect(shippingView.records.find((record) => record.id === 'SH-006')?.status).toBe('รอตรวจ');
    expect(shippingView.metrics[0]?.value).toBe('฿35.00');

    const quest = makeSnapshot('quest');
    quest.active.quest = { firstHint: 180, secondHint: 300, autoReveal: false };
    quest.draft.quest = { firstHint: 900, secondHint: 1200, autoReveal: true };
    quest.simulation.quest = { firstHint: 30, secondHint: 60, autoReveal: true };
    const questView = resolveSurface(quest);
    expect(questView.records.find((record) => record.id === 'first-hint')?.fields.hints.text).toBe('ระดับ 1');
    expect(questView.records.find((record) => record.id === 'second-hint')?.fields.answer.text).toBe('ยังซ่อนเฉลย');
    expect(questView.metrics[0]?.value).toBe('180 วิ');

    const music = makeSnapshot('music');
    music.active.music = { chorusBpm: 80, otherBpm: 100, repetitions: 3 };
    music.draft.music = { chorusBpm: 145, otherBpm: 145, repetitions: 1 };
    music.simulation.music = { chorusBpm: 60, otherBpm: 60, repetitions: 9 };
    const musicView = resolveSurface(music);
    expect(musicView.records.find((record) => record.id === 'MU-004')?.fields.tempo.text).toBe('80 BPM');
    expect(musicView.records.find((record) => record.id === 'MU-004')?.fields.repetitions.text).toBe('3 รอบ');
    expect(musicView.metrics[0]?.value).toBe('80 BPM');
  });

  it('offers three case-specific, recommended-first choices backed by the shared component registry', () => {
    for (const caseId of ['shipping', 'quest', 'music'] as const) {
      const options = PRESENTATION_OPTIONS[caseId];
      expect(options).toHaveLength(3);
      expect(options[0]?.id).toBe('original');
      expect(options.filter((option) => option.recommended).map((option) => option.id)).toEqual(['original']);
      for (const option of options) {
        if (option.libraryComponent === 'form') {
          expect(STANDARD_COMPONENTS.form.kind).toBe('form');
          expect(STANDARD_COMPONENTS.form.source).toBe('preserved-child');
          continue;
        }
        expect(STANDARD_COMPONENTS[option.libraryComponent]).toBeDefined();
        expect(STANDARD_RENDERERS[option.libraryComponent]).toBe(STANDARD_COMPONENTS[option.libraryComponent].component);
      }
    }
    expect(PRESENTATION_OPTIONS.quest.map((option) => option.id)).toEqual(['original', 'table', 'cards']);
    expect(PRESENTATION_OPTIONS.music.map((option) => option.id)).toEqual(['original', 'table', 'chart']);
    expect(PRESENTATION_OPTIONS.shipping.map((option) => option.id)).toEqual(['original', 'cards', 'chart']);
  });

  it('keeps the original interactive body as the default in the same surface', () => {
    const html = renderToStaticMarkup(createElement(AdaptiveSurface, {
      snapshot: makeSnapshot('quest'),
      children: createElement('button', { type: 'button', 'data-testid': 'original-route-control' }, 'เริ่มเกม'),
    }));
    expect(html).toContain('data-presentation="original"');
    expect(html).toContain('data-testid="adaptive-surface-original-tools"');
    expect(html).toContain('data-testid="original-route-control"');
    expect(html).toContain('เริ่มเกม');
  });

  it('reports invalid active inputs without hiding the shared error state', () => {
    const snapshot = makeSnapshot('music');
    snapshot.active.music = { chorusBpm: 80, otherBpm: 100, repetitions: 0 };
    const resolved = resolveSurface(snapshot);
    expect(resolved.state).toBe('error');
    expect(resolved.records).toHaveLength(0);
    expect(resolved.stateMessage).toContain('ยังสร้างแผนไม่ได้');
  });
});

