import { describe, expect, it } from 'vitest';
import { findNearbyPosition, makeObject } from './objects';

function overlaps(position: { x: number; y: number }, size: { width: number; height: number }, object: ReturnType<typeof makeObject>, gap: number): boolean {
  return position.x < object.position.x + object.width + gap
    && position.x + size.width + gap > object.position.x
    && position.y < object.position.y + object.height + gap
    && position.y + size.height + gap > object.position.y;
}

describe('canvas object composition', () => {
  it('uses asymmetric semantic starting positions and default layer metadata', () => {
    const context = makeObject('context', 'accounting');
    const table = makeObject('table', 'accounting');
    const worker = makeObject('worker', 'accounting');
    const source = makeObject('source', 'accounting');
    const overview = makeObject('overview', 'accounting');

    expect(table.position).toEqual({ x: 0, y: 140 });
    expect(table.width).toBe(650);
    expect(table.height).toBe(390);
    expect(worker.position).toEqual({ x: 620, y: 16 });
    expect(worker.width).toBe(270);
    expect(worker.height).toBe(100);
    expect(worker.collapsed).toBe(true);
    expect(source.position).toEqual({ x: -310, y: 235 });
    expect(overview.width).toBe(520);
    expect(overview.height).toBe(600);
    expect(context.placementMode).toBe('ai');
    expect(typeof context.zIndex).toBe('number');
  });

  it('finds nearby free space without moving existing canvas objects', () => {
    const anchor = makeObject('table', 'accounting');
    const blocker = { ...makeObject('dashboard', 'accounting'), position: { x: 674, y: 160 } };
    const objects = [anchor, blocker];
    const before = structuredClone(objects);
    const size = { width: 440, height: 600 };

    const position = findNearbyPosition(objects, anchor, size);

    expect(objects).toEqual(before);
    expect(objects.every((object) => !overlaps(position, size, object, 24))).toBe(true);
    expect(Math.abs(position.x - anchor.position.x) + Math.abs(position.y - anchor.position.y)).toBeLessThan(2_000);
  });
});
