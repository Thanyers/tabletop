import { describe, expect, it } from 'vitest';
import { createEquipment, evaluateEquipment } from './maintenance';
import type { Equipment } from './types';

describe('equipment maintenance', () => {
  it('returns a fixed 12-item fictional register', () => {
    expect(createEquipment()).toHaveLength(12);
    expect(createEquipment()).toEqual(createEquipment());
  });

  it('classifies repair, expired, soon, and healthy equipment against a fixed date', () => {
    const items: Equipment[] = [
      { id: '1', name: 'Repair', category: 'Laptop', owner: 'IT', warrantyUntil: '2027-01-01', condition: 'needs-repair', location: 'Office' },
      { id: '2', name: 'Expired', category: 'Printer', owner: 'IT', warrantyUntil: '2026-09-29', condition: 'working', location: 'Office' },
      { id: '3', name: 'Soon', category: 'Laptop', owner: 'IT', warrantyUntil: '2026-10-20', condition: 'working', location: 'Office' },
      { id: '4', name: 'Healthy', category: 'Laptop', owner: 'IT', warrantyUntil: '2026-12-01', condition: 'working', location: 'Office' },
    ];
    expect(evaluateEquipment(items, '2026-09-30').map((item) => item.priority)).toEqual(['urgent', 'urgent', 'soon', 'healthy']);
  });
});
