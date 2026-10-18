import { describe, expect, it } from 'vitest';
import { runInNewContext } from 'node:vm';
import {
  BASELINE_ENCOUNTER_RULE,
  TAUGHT_ENCOUNTER_RULE,
  createEncounterState,
  exportEncounterHtml,
  resolveEncounterAction,
  runEncounter,
} from './encounterModel';

interface ExportHarnessElement {
  textContent: string;
  innerHTML: string;
  value: string;
  checked: boolean;
  disabled: boolean;
  listeners: Map<string, (event?: { currentTarget: ExportHarnessElement }) => void>;
  addEventListener(type: string, listener: (event?: { currentTarget: ExportHarnessElement }) => void): void;
}

function createExportHarness(html: string) {
  const element = (): ExportHarnessElement => ({
    textContent: '',
    innerHTML: '',
    value: '',
    checked: false,
    disabled: false,
    listeners: new Map(),
    addEventListener(type, listener) {
      this.listeners.set(type, listener);
    },
  });
  const ids = ['mira', 'pip', 'goblin', 'result', 'log', 'play', 'step', 'reset'];
  const elements = new Map(ids.map((id) => [id, element()]));
  const shieldSelf = Object.assign(element(), { value: 'mira', checked: false });
  const shieldPip = Object.assign(element(), { value: 'pip', checked: false });
  const inputs = [shieldSelf, shieldPip];
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  if (!script) throw new Error('Export HTML did not include its inline game script.');

  const document = {
    getElementById(id: string) {
      const found = elements.get(id);
      if (!found) throw new Error(`Missing export element: ${id}`);
      return found;
    },
    querySelector(selector: string) {
      if (selector !== '.bot') throw new Error(`Unexpected selector: ${selector}`);
      return bot;
    },
    querySelectorAll(selector: string) {
      return selector === 'input[name="shield-target"]' ? inputs : [];
    },
  };
  const bot = element();
  runInNewContext(script, { document });

  return { elements, shieldSelf, shieldPip };
}

describe('encounter model', () => {
  it('keeps the same d20 trace and reduces Pip damage when the shield protects an ally', () => {
    const before = runEncounter(BASELINE_ENCOUNTER_RULE, [14, 12, 16]);
    const after = runEncounter(TAUGHT_ENCOUNTER_RULE, [14, 12, 16]);

    expect(before.rolls).toEqual([14, 12, 16]);
    expect(after.rolls).toEqual(before.rolls);
    expect(before.events.map(({ actorId }) => actorId)).toEqual(['mira', 'goblin', 'pip']);
    expect(before.events[1]).toMatchObject({ targetId: 'pip', damage: 4, reducedBy: 0 });
    expect(after.events[1]).toMatchObject({ targetId: 'pip', damage: 2, reducedBy: 2 });
    expect(before.hp.pip).toBe(6);
    expect(after.hp.pip).toBe(8);
    expect(after).toMatchObject({ roundEnded: true, goblinDefeated: true, hp: { goblin: 0 } });
  });

  it('does not let a defeated actor act or append a second event', () => {
    let state = createEncounterState({ pip: 1 });
    state = resolveEncounterAction(state, 'mira', 14, BASELINE_ENCOUNTER_RULE);
    state = resolveEncounterAction(state, 'goblin', 12, BASELINE_ENCOUNTER_RULE);
    expect(state.hp.pip).toBe(0);

    const defeatedState = state;
    const next = resolveEncounterAction(state, 'pip', 16, BASELINE_ENCOUNTER_RULE);
    expect(next).toBe(defeatedState);
    expect(next.events).toHaveLength(2);
    expect(next.acted).not.toContain('pip');
  });

  it('does not permit a defeated goblin to take its turn', () => {
    let state = createEncounterState({ goblin: 0 });
    const original = state;
    state = resolveEncounterAction(state, 'goblin', 20, TAUGHT_ENCOUNTER_RULE);
    expect(state).toBe(original);
  });

  it('lets Mira protect herself under the baseline rule when the goblin must target her', () => {
    let state = createEncounterState({ pip: 0 });
    state = resolveEncounterAction(state, 'mira', 14, BASELINE_ENCOUNTER_RULE);
    state = resolveEncounterAction(state, 'goblin', 12, BASELINE_ENCOUNTER_RULE);

    expect(state.events[1]).toMatchObject({ targetId: 'mira', damage: 2, reducedBy: 2 });
    expect(state.hp.mira).toBe(8);
  });

  it('lets the taught rule choose self or Pip while preserving legacy defaults', () => {
    const selfChoice = runEncounter(TAUGHT_ENCOUNTER_RULE, [14, 12, 16], 'mira');
    const friendChoice = runEncounter(TAUGHT_ENCOUNTER_RULE, [14, 12, 16], 'pip');

    expect(selfChoice.events[0]).toMatchObject({ actorId: 'mira', targetId: 'mira' });
    expect(selfChoice.events[1]).toMatchObject({ targetId: 'pip', damage: 4, reducedBy: 0 });
    expect(selfChoice.hp.pip).toBe(6);
    expect(friendChoice.events[0]).toMatchObject({ actorId: 'mira', targetId: 'pip' });
    expect(friendChoice.events[1]).toMatchObject({ targetId: 'pip', damage: 2, reducedBy: 2 });

    const lockedRule = resolveEncounterAction(createEncounterState(), 'mira', 14, BASELINE_ENCOUNTER_RULE, 'pip');
    expect(lockedRule.events[0]).toMatchObject({ actorId: 'mira', targetId: 'mira' });
  });

  it('never applies more damage than the target has remaining HP', () => {
    const state = resolveEncounterAction(
      createEncounterState({ pip: 1 }),
      'goblin',
      12,
      BASELINE_ENCOUNTER_RULE,
    );

    expect(state.events[0].damage).toBe(1);
    expect(state.hp.pip).toBe(0);
  });

  it('exports a self-contained playable copy using the selected rule', () => {
    const html = exportEncounterHtml(TAUGHT_ENCOUNTER_RULE);

    expect(html).toContain('กติกาที่สอน: โล่ช่วยเพื่อน');
    expect(html).toContain('const rule={"allyShield":true,"shieldReduction":2}');
    expect(html).toContain('const rule=');
    expect(html).toContain('trace=[14,12,16]');
    expect(html).toContain("order=['mira','goblin','pip']");
    expect(html).toContain('name="shield-target" value="mira"');
    expect(html).toContain('name="shield-target" value="pip" checked');
    expect(html).toContain("state.acted.includes('mira')");
    expect(html).toContain("actorLabels[event.actor]");
    expect(html).not.toMatch(/<script[^>]+src=|<link[^>]+href=|fetch\s*\(|eval\s*\(/i);
  });

  it('locks the friend option in the exported baseline rule with a clear explanation', () => {
    const html = exportEncounterHtml(BASELINE_ENCOUNTER_RULE);

    expect(html).toContain('value="pip" disabled');
    expect(html).toContain('เรียนรู้กติกาโล่ช่วยเพื่อนก่อน จึงจะเลือก Pip ได้');
  });

  it('plays the exported action with the chosen target and labels the same actor as the die', () => {
    const html = exportEncounterHtml(TAUGHT_ENCOUNTER_RULE);
    const harness = createExportHarness(html);

    harness.shieldSelf.checked = true;
    harness.shieldPip.checked = false;
    harness.shieldSelf.listeners.get('change')?.({ currentTarget: harness.shieldSelf });
    harness.elements.get('step')?.listeners.get('click')?.();

    expect(harness.elements.get('result')?.innerHTML).toContain('คุณ · Mira');
    expect(harness.elements.get('result')?.innerHTML).toContain('Mira ตั้งโล่ป้องกันตัวเอง · d20 14');
    expect(harness.shieldSelf.disabled).toBe(true);
    expect(harness.shieldPip.disabled).toBe(true);

    harness.elements.get('step')?.listeners.get('click')?.();
    expect(harness.elements.get('result')?.innerHTML).toContain('<strong>Goblin</strong> · Goblin โจมตี Pip · d20 12');
    expect(harness.elements.get('pip')?.textContent).toBe('6 / 10 HP');
  });
});
