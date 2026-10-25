import { describe, it, expect } from 'vitest';
import { canvasObjectCount, canvasObjectForEvent, canvasObjectForStep, narrativeAnchor, narrativeFocus, narrativeSelector } from './narrativeFocus';

describe('narrative reference timing', () => {
  it.each(['shipping', 'quest', 'music'] as const)('keeps %s problem reference on existing data before building the change', (id) => {
    expect(narrativeFocus(id, 'notice', 'thinking', 2).target).toBe('minimal');
    expect(narrativeFocus(id, 'notice', 'thinking', 2).record).toBeTruthy();
    expect(narrativeFocus(id, 'notice', 'building', 2).target).toBe(id === 'quest' ? 'minimal' : 'notice');
  });
  it('only advances a column reference after a complete phrase appears', () => {
    expect(narrativeAnchor('shipping', 'minimal', 'ขอดูปลายทาง น้ำ')).toBe('ปลายทาง');
    const anchor = narrativeAnchor('shipping', 'minimal', 'ขอดูปลายทาง น้ำหนัก');
    expect(narrativeSelector('shipping', 'minimal', 'sources', anchor)).toContain('weight');
  });
  it('points at verified evidence before approval rather than an absent approval card', () => {
    expect(narrativeFocus('shipping', 'approve', 'thinking', 5).target).toBe('verify');
  });
  it('selects the exact source hook row and the tempo column when named', () => {
    expect(narrativeSelector('music', 'sources', 'sources', 'ท่อนฮุก')).toBe('[data-narrative-record="MU-004"]');
    expect(narrativeSelector('music', 'minimal', 'sources', '100 BPM')).toBe('[data-narrative-field="bpm"]');
  });
  it('keeps encounter creation on its image and play-testing on the live game', () => {
    expect(narrativeSelector('quest', 'minimal', 'sources', 'ฮีโร่สองคน')).toBe('.source-preview');
    expect(narrativeSelector('quest', 'notice', 'minimal', 'Pip')).toBe('.encounter-game');
  });
  it('keeps all encounter rule stages on one object while preserving source and handoff nodes', () => {
    for (const step of ['minimal', 'notice', 'teach', 'verify', 'approve', 'simulate'] as const) {
      expect(canvasObjectForStep('quest', step)).toBe('minimal');
      expect(narrativeFocus('quest', step, 'typing', 2).target).toBe(step === 'minimal' ? 'sources' : 'minimal');
    }
    expect(canvasObjectForStep('quest', 'sources')).toBe('sources');
    expect(canvasObjectForStep('quest', 'handoff')).toBe('handoff');
    expect(narrativeSelector('quest', 'verify', 'minimal', '')).toBe('.encounter-game');
  });
  it('coalesces quest lineage edges and leaves pre-encounter saved workspaces intact', () => {
    expect(canvasObjectForEvent('quest', 'instruction')).toBe('minimal');
    expect(canvasObjectForEvent('quest', 'test')).toBe('minimal');
    expect(canvasObjectForEvent('quest', 'approval')).toBe('minimal');
    expect(canvasObjectForEvent('quest', 'simulation')).toBe('minimal');
    expect(canvasObjectForEvent('quest', 'source')).toBe('sources');
    expect(canvasObjectForEvent('quest', 'handoff')).toBe('handoff');
    expect(canvasObjectForStep('quest', 'teach', false)).toBe('teach');
    expect(canvasObjectForEvent('quest', 'instruction', false)).toBe('teach');
    expect(narrativeFocus('quest', 'notice', 'thinking', 2, false).target).toBe('minimal');
    expect(narrativeFocus('quest', 'teach', 'reading', 4, false).target).toBe('teach');
    expect(narrativeSelector('quest', 'notice', 'notice', '', false)).toBe('.encounter-game__field');
  });
  it('reports the number of distinct visible canvas objects after coalescing', () => {
    expect(canvasObjectCount('quest', 5)).toBe(2);
    expect(canvasObjectCount('quest', 8)).toBe(3);
    expect(canvasObjectCount('quest', 8, false)).toBe(8);
  });
});
