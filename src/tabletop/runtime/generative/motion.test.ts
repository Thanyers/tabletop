import { describe, expect, it } from 'vitest';
import type { ScenePrimitive, SceneValue } from '../../shared/generative-contracts';
import type { TableProgram, TableRecord } from '../../shared/table-contracts';
import { evaluateGenerativeCanvas } from './evaluator';
import { generativeCanvasSchema } from './schema';
import { validateGenerativeProgram } from './validation';

const records: Record<string, TableRecord[]> = { settings: [{ id: 's1', values: { speed: 10 } }] };

function trackProgram(overrides: { speed?: SceneValue; elements?: ScenePrimitive[] } = {}): TableProgram {
  return {
    version: 1,
    title: 'Track',
    description: '',
    collections: [{ id: 'settings', title: 'Settings', fields: [{ id: 'speed', label: 'Speed', type: 'number', required: true }] }],
    actions: [],
    invariants: [],
    turnOrder: [],
    evidence: [],
    assumptions: [],
    canvas: {
      version: 1,
      views: [{
        id: 'track',
        kind: 'scene',
        title: '10 m track',
        width: 800,
        height: 400,
        elements: overrides.elements ?? [{
          id: 'car',
          shape: 'rect',
          x: 40,
          y: 300,
          width: 80,
          height: 36,
          motion: {
            axis: 'x',
            from: 40,
            to: 760,
            speed: overrides.speed ?? { op: 'recordField', collection: 'settings', recordId: 's1', field: 'speed' },
          },
        }],
      }],
    },
  };
}

function evaluate(program: TableProgram) {
  if (!program.canvas) throw new Error('Expected a canvas.');
  return evaluateGenerativeCanvas(program.canvas, { program, records, actor: 'owner', turn: null });
}

describe('scene motion (F040)', () => {
  it('evaluates from/to/speed and defaults to looping', () => {
    const program = trackProgram();
    expect(generativeCanvasSchema.safeParse(program.canvas).success).toBe(true);
    expect(validateGenerativeProgram(program, records)).toEqual([]);
    const scene = evaluate(program)[0];
    if (scene.kind !== 'scene') throw new Error('Expected a scene.');
    const car = scene.elements[0];
    expect(car).toMatchObject({ shape: 'rect', x: 40, y: 300, motion: { axis: 'x', from: 40, to: 760, speed: 10, loop: true } });
  });

  it('rejects motion on line and polygon primitives at the schema boundary', () => {
    const line = {
      id: 'rail', shape: 'line', x1: 0, y1: 10, x2: 100, y2: 10,
      motion: { axis: 'x', from: 0, to: 100, speed: 10 },
    };
    expect(generativeCanvasSchema.safeParse({
      version: 1,
      views: [{ id: 'track', kind: 'scene', title: 'Track', width: 100, height: 20, elements: [line] }],
    }).success).toBe(false);
  });

  it('rejects a static speed of zero, equal endpoints, and motion combined with drag', () => {
    expect(() => evaluate(trackProgram({ speed: { op: 'literal', value: 0 } }))).toThrow('speed must be a positive number');
    expect(validateGenerativeProgram(trackProgram({ elements: [{
      id: 'car', shape: 'rect', x: 40, y: 1, width: 10, height: 10,
      motion: { axis: 'x', from: 40, to: 40, speed: 10 },
    }] }), records)).toContain('Scene motion must travel between two different positions.');

    const both = trackProgram({ elements: [{
      id: 'car', shape: 'rect', x: 40, y: 1, width: 10, height: 10,
      motion: { axis: 'x', from: 40, to: 100, speed: 10 },
      drag: { actionId: 'move', xParameter: 'x', inputs: {} },
    }] });
    expect(validateGenerativeProgram(both, records)).toContain('A scene element cannot both drag and move on its own.');
  });
});
