import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { applyTableChange, createTableState } from '../domain/table';
import type { WorkspaceView } from '../shared/contracts';
import type { ControlDescriptor, GenerativeViewDescriptor } from '../shared/generative-contracts';
import type { TableAction, TableChange, TableState } from '../shared/table-contracts';
import { planForWorkspace } from '../runtime';
import { cafeQueueChange, diceDuelChange, lightShadowChange } from '../testing/generative-scenarios';
import { rollCombatChange, rollDiceCardChange } from '../testing/table-scenarios';
import { beginControlSubmission, beginRangeCommit, controlSubmissionSignature, createControlSubmissionGate, diceRollMode, finishControlSubmission, GeneratedCanvasObject } from './GeneratedCanvasObjects';
import { readControlDraftValue, resetControlDrafts, writeControlDraft } from './control-drafts';
import { clearServerRollsFor, recordServerRoll } from './roll-store';
import { TableCanvasObject } from './TableCanvasObjects';

function workspace(change: TableChange = cafeQueueChange, role: 'owner' | 'participant' = 'owner'): WorkspaceView {
  const domain = applyTableChange(createTableState(), structuredClone(change));
  return {
    id: 'generated-render-test', title: 'Generated render test', kind: 'table', epoch: 1, revision: 'revision-1',
    actor: { actorId: 'test-actor', name: 'Test actor', role }, members: [], domain, createdAt: 0, expiresAt: 1000,
  };
}

function renderView(view: WorkspaceView, descriptor: GenerativeViewDescriptor, previewOnly = false, sandbox = false): string {
  if (view.domain.kind !== 'table') throw new Error('Expected a table workspace.');
  return renderToStaticMarkup(createElement(GeneratedCanvasObject, {
    view, state: view.domain as TableState, descriptor, busy: null, onCommand: async () => null, previewOnly,
    ...(sandbox ? { sandboxCommand: async () => view } : {}),
  }));
}

function descriptorById(view: WorkspaceView, id: string): GenerativeViewDescriptor {
  if (view.domain.kind !== 'table') throw new Error('Expected a table workspace.');
  const descriptor = view.domain.program?.canvas?.views.find(item => item.id === id);
  if (!descriptor) throw new Error(`Missing generated view ${id}.`);
  return descriptor;
}

describe('generated canvas renderer', () => {
  it('renders scene primitives, metrics, and real chart points from the committed table state', () => {
    const view = workspace();
    const scene = renderView(view, descriptorById(view, 'cafe-floor'));
    const metric = renderView(view, descriptorById(view, 'average-wait'));
    const chart = renderView(view, descriptorById(view, 'queue-chart'));

    expect(scene).toContain('<svg');
    expect(scene).toContain('<circle');
    expect(scene).toContain('waiting');
    expect(metric).toContain('0');
    expect(chart).toContain('bar chart with 1 data points');
    expect(chart).toContain('waiting');
  });

  it('routes the active plan node output descriptor into the generated renderer', () => {
    const view = workspace();
    const plan = planForWorkspace(view);
    const node = plan.nodes.find(item => item.id === 'table.view.service-controls');
    if (!node) throw new Error('Expected the active table plan to contain its controls view.');
    const markup = renderToStaticMarkup(createElement(TableCanvasObject, {
      view,
      node,
      outputs: plan.outputs[node.id] ?? {},
      busy: null,
      onCommand: async () => null,
    }));

    expect(markup).toContain('aria-label="Service controls"');
    expect(markup).toContain('Advance 5 minutes');
    expect(markup).not.toContain('This generated view is not available.');
  });

  it('renders proposed controls disabled and gives every form field a view-scoped id', () => {
    const view = workspace();
    const markup = renderView(view, descriptorById(view, 'service-controls'), true);
    const ids = [...markup.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);

    expect(markup).toContain('Preview only');
    expect(markup).toMatch(/<button[^>]*disabled=""/);
    expect(markup).toContain('<select id=');
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('enables proposal controls and draggable scene shapes only with an explicit private sandbox', () => {
    const view = workspace();
    const controls = renderView(view, descriptorById(view, 'service-controls'), true, true);
    const sceneView = workspace(lightShadowChange);
    const scene = renderView(sceneView, descriptorById(sceneView, 'light-shadow-scene'), true, true);
    const staticControls = renderView(view, descriptorById(view, 'service-controls'), true);

    expect(controls).toContain('Private trial · actions change this preview only.');
    expect(controls).toContain('<button type="button" class="tt-button tt-button--primary">');
    expect(scene).toContain('data-drag-enabled="true"');
    expect(staticControls).toContain('Preview only · changes are not sent to the table.');
    expect(staticControls).not.toContain('data-drag-enabled="true"');
  });

  it('escapes scene text and renders only allowlisted SVG elements', () => {
    const change = structuredClone(cafeQueueChange);
    const scene = change.program.canvas?.views.find(item => item.kind === 'scene');
    if (scene?.kind !== 'scene') throw new Error('Expected a scene descriptor.');
    scene.elements.push({ id: 'plain-text', shape: 'text', x: 8, y: 128, text: '<img src=x onerror=alert(1)>' });
    const view = workspace(change);
    const markup = renderView(view, descriptorById(view, 'cafe-floor'));

    expect(markup).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(markup).not.toContain('<img');
    expect(markup).not.toContain('<script');
    expect(markup).not.toContain('<foreignObject');
  });

  it('disables controls when the authoritative action role excludes the viewer', () => {
    const change = structuredClone(cafeQueueChange);
    change.program.actions[0].roles = ['owner'];
    const view = workspace(change, 'participant');
    const markup = renderView(view, descriptorById(view, 'service-controls'));

    expect(markup).toContain('disabled=""');
    expect(markup).toContain('This action is not available to your role.');
  });

  it('deduplicates successful button submissions by committed revision and inputs, while allowing rejection retries', () => {
    const view = workspace();
    if (view.domain.kind !== 'table') throw new Error('Expected a table workspace.');
    const state = view.domain;
    const action = state.program?.actions.find(item => item.id === 'advance_time');
    if (!action) throw new Error('Expected an action.');
    const inputs = { clock: 'clock-1', minutes: 5 };
    const gate = createControlSubmissionGate();
    const first = controlSubmissionSignature(view, state, action, inputs, 'button');

    expect(beginControlSubmission(gate, 'time-step', first)).toBe(true);
    expect(beginControlSubmission(gate, 'time-step', first)).toBe(false);
    finishControlSubmission(gate, 'time-step', first, true);
    expect(beginControlSubmission(gate, 'time-step', first)).toBe(false);

    const nextRevision = controlSubmissionSignature({ ...view, revision: 'revision-2' }, state, action, inputs, 'button');
    expect(beginControlSubmission(gate, 'time-step', nextRevision)).toBe(true);
    finishControlSubmission(gate, 'time-step', nextRevision, false);
    expect(beginControlSubmission(gate, 'time-step', nextRevision)).toBe(true);
    finishControlSubmission(gate, 'time-step', nextRevision, true);
    expect(beginControlSubmission(gate, 'time-step', nextRevision)).toBe(false);
  });

  it('suppresses pointerup and blur duplicates for one slider gesture and resets on a new gesture', () => {
    const committedRanges = new Set<string>();

    expect(beginRangeCommit(committedRanges, 'light-x')).toBe(true);
    expect(beginRangeCommit(committedRanges, 'light-x')).toBe(false);
    committedRanges.delete('light-x');
    expect(beginRangeCommit(committedRanges, 'light-x')).toBe(true);
  });

  it('renders the server roll control for a roll parameter and locks the returned total until a re-roll', () => {
    const view = workspace(rollCombatChange());
    const descriptor = descriptorById(view, 'attack-controls');
    const initial = renderView(view, descriptor);
    expect(initial).toContain('ทอย');
    expect(initial).toContain('2d6 + 3');
    expect(initial).toContain('server roll');
    expect(initial).toContain('กด “ทอย”');
    expect(initial).not.toContain('ทอยอีกครั้ง');

    recordServerRoll(view, 'attack', 'damage', { groups: [{ count: 2, faces: 6 }], values: [4, 5], total: 12 });
    const rolled = renderView(view, descriptor);
    expect(rolled).toContain('ทอยอีกครั้ง');
    expect(rolled).toContain('4');
    expect(rolled).toContain('5');
    expect(rolled).toContain('= 12');
    expect(rolled).toContain('ถูกล็อก');
    clearServerRollsFor(view);
    expect(renderView(view, descriptor)).toContain('2d6 + 3');
  });

  it('stops showing a rolled value once the table data revision moves on', () => {
    const view = workspace(rollCombatChange());
    recordServerRoll(view, 'attack', 'damage', { groups: [{ count: 2, faces: 6 }], values: [1, 2], total: 6 });
    expect(renderView(view, descriptorById(view, 'attack-controls'))).toContain('= 6');
    if (view.domain.kind !== 'table') throw new Error('Expected a table workspace.');
    const moved = { ...view, domain: { ...view.domain, dataRevision: view.domain.dataRevision + 1 } };
    expect(renderView(moved, descriptorById(view, 'attack-controls'))).not.toContain('= 6');
    clearServerRollsFor(view);
  });
});

describe('dice card renderer', () => {
  it('renders the dice card with steppers, a ทอย button, and its formula', () => {
    const view = workspace(diceDuelChange);
    const viewDescriptor = descriptorById(view, 'damage-dice');
    if (view.domain.kind !== 'table' || viewDescriptor.kind !== 'controls') throw new Error('Expected a controls view.');
    const dice = viewDescriptor.controls.find(control => control.kind === 'dice');
    if (dice?.kind !== 'dice') throw new Error('Expected a dice control.');
    const action = view.domain.program?.actions.find(item => item.id === 'apply_damage');
    if (!action) throw new Error('Expected the dice action.');
    const markup = renderView(view, viewDescriptor);

    expect(diceRollMode(action, dice)).toBe('client');
    expect(markup).toContain('ทอย');
    expect(markup).toContain('aria-label="Number of dice"');
    expect(markup).toContain('aria-label="Faces per die"');
    expect(markup).toContain('2d6 + 1');
    expect(markup).toContain('Damage die');
    expect(markup).toContain('Visual-only roll');
    expect(markup).not.toContain('Dice results');
  });

  it('renders the dice card disabled in a preview-only proposal', () => {
    const view = workspace(diceDuelChange);
    const markup = renderView(view, descriptorById(view, 'damage-dice'), true);

    expect(markup).toContain('Preview only');
    expect(markup).toMatch(/class="[^"]*tt-dice__roll[^"]*"[^>]*disabled=""/);
    expect(markup).toMatch(/aria-label="Fewer dice" disabled=""/);
  });

  it('shows a dice value written on another card in the bound form field', () => {
    const view = workspace(diceDuelChange);
    writeControlDraft({ workspaceId: view.id, actionId: 'apply_damage', parameterId: 'damage' }, 9, 'dice:test');

    try {
      const markup = renderView(view, descriptorById(view, 'damage-form'));

      expect(markup).toContain('value="9"');
    } finally {
      resetControlDrafts();
    }
  });
});

describe('server roll dice card', () => {
  function serverDiceFixture(): { view: WorkspaceView; viewDescriptor: GenerativeViewDescriptor; dice: Extract<ControlDescriptor, { kind: 'dice' }>; action: TableAction } {
    const view = workspace(rollDiceCardChange());
    const viewDescriptor = descriptorById(view, 'attack-dice');
    if (view.domain.kind !== 'table' || viewDescriptor.kind !== 'controls') throw new Error('Expected a controls view.');
    const dice = viewDescriptor.controls.find(control => control.kind === 'dice');
    if (dice?.kind !== 'dice') throw new Error('Expected a dice control.');
    const action = view.domain.program?.actions.find(item => item.id === 'attack');
    if (!action) throw new Error('Expected the attack action.');
    return { view, viewDescriptor, dice, action };
  }

  it('renders the program roll spec and shows the server-rolled faces and total', () => {
    resetControlDrafts();
    const { view, viewDescriptor, dice, action } = serverDiceFixture();
    const target = { workspaceId: view.id, actionId: 'attack', parameterId: 'damage' };
    const initial = renderView(view, viewDescriptor);

    expect(diceRollMode(action, dice)).toBe('server');
    expect(initial).toContain('server roll');
    // The card's own 1d6 is not authoritative; the program says 2d6 + 3.
    expect(initial).toContain('2d6 + 3');
    expect(initial).toContain('ทอย');
    expect(initial).not.toContain('1d6');
    expect(initial).not.toContain('aria-label="Number of dice"');
    expect(initial).not.toContain('Visual-only roll');
    expect(readControlDraftValue(target)).toBeUndefined();

    recordServerRoll(view, 'attack', 'damage', { groups: [{ count: 2, faces: 6 }], values: [4, 5], total: 12 });
    try {
      const rolled = renderView(view, viewDescriptor);

      expect(rolled).toContain('ทอยอีกครั้ง');
      expect(rolled).toContain('aria-label="Die 1: 4"');
      expect(rolled).toContain('aria-label="Die 2: 5"');
      expect(rolled).toContain('<strong>12</strong>');
      expect(rolled).toContain('9 + 3');
      expect(rolled).toContain('ถูกล็อก');
      expect(rolled).not.toContain('Visual-only roll');
      expect(readControlDraftValue(target)).toBeUndefined();
    } finally {
      clearServerRollsFor(view);
    }
  });

  it('never calls the client CSPRNG path for a roll parameter', () => {
    const { view, viewDescriptor, dice, action } = serverDiceFixture();
    const random = vi.spyOn(globalThis.crypto, 'getRandomValues');

    try {
      expect(diceRollMode(action, dice)).toBe('server');
      renderView(view, viewDescriptor);
      recordServerRoll(view, 'attack', 'damage', { groups: [{ count: 2, faces: 6 }], values: [1, 2], total: 6 });
      renderView(view, viewDescriptor);

      expect(random).not.toHaveBeenCalled();
    } finally {
      random.mockRestore();
      clearServerRollsFor(view);
    }
  });

  it('disables the server dice card in a preview-only proposal', () => {
    const { view, viewDescriptor } = serverDiceFixture();
    const markup = renderView(view, viewDescriptor, true);

    expect(markup).toContain('Preview only');
    expect(markup).toMatch(/class="[^"]*tt-dice__roll[^"]*"[^>]*disabled=""/);
  });
});
