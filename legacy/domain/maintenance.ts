import type { Equipment, EquipmentResult } from './types';

const WARRANTY_SOON_DAYS = 30;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1_000;

export function createEquipment(): Equipment[] {
  return [
    { id: 'EQ-001', name: 'ThinkPad X1 Carbon', category: 'Laptop', owner: 'N. Suriya', warrantyUntil: '2026-11-20', condition: 'working', location: 'Bangkok / Finance' },
    { id: 'EQ-002', name: 'Latitude 7440', category: 'Laptop', owner: 'M. Kanya', warrantyUntil: '2026-10-20', condition: 'working', location: 'Bangkok / Operations' },
    { id: 'EQ-003', name: 'Network switch 48-port', category: 'Network', owner: 'IT Service Desk', warrantyUntil: '2026-10-10', condition: 'working', location: 'Bangkok / Server room' },
    { id: 'EQ-004', name: 'Color laser printer', category: 'Printer', owner: 'P. Arun', warrantyUntil: '2026-09-01', condition: 'working', location: 'Chiang Mai / Office' },
    { id: 'EQ-005', name: 'Conference room display', category: 'Display', owner: 'Facilities', warrantyUntil: '2026-12-15', condition: 'needs-repair', location: 'Bangkok / Meeting room 2' },
    { id: 'EQ-006', name: 'Docking station', category: 'Accessory', owner: 'T. Mali', warrantyUntil: '2027-03-01', condition: 'working', location: 'Bangkok / Finance' },
    { id: 'EQ-007', name: 'Barcode scanner', category: 'Operations', owner: 'Warehouse team', warrantyUntil: '2026-10-05', condition: 'in-repair', location: 'Samut Prakan / Warehouse' },
    { id: 'EQ-008', name: 'Ergonomic chair', category: 'Furniture', owner: 'S. Pim', warrantyUntil: '2027-06-30', condition: 'working', location: 'Bangkok / People' },
    { id: 'EQ-009', name: 'Firewall appliance', category: 'Network', owner: 'IT Service Desk', warrantyUntil: '2026-10-30', condition: 'working', location: 'Bangkok / Server room' },
    { id: 'EQ-010', name: 'Projector', category: 'Display', owner: 'Facilities', warrantyUntil: '2025-08-31', condition: 'needs-repair', location: 'Chiang Mai / Meeting room' },
    { id: 'EQ-011', name: 'Mobile workstation', category: 'Laptop', owner: 'R. Niran', warrantyUntil: '2026-11-14', condition: 'working', location: 'Bangkok / Technology' },
    { id: 'EQ-012', name: 'Document scanner', category: 'Scanner', owner: 'P. Arun', warrantyUntil: '2026-09-30', condition: 'working', location: 'Bangkok / Finance' },
  ];
}

function parseUtcDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) return null;
  return date;
}

export function evaluateEquipment(items: Equipment[], asOf = '2026-09-30'): EquipmentResult[] {
  const asOfDate = parseUtcDate(asOf);
  return items.map((equipment) => {
    const warrantyDate = parseUtcDate(equipment.warrantyUntil);
    if (asOfDate === null || warrantyDate === null) {
      return {
        equipment,
        warrantyDays: 0,
        priority: 'urgent',
        reason: 'Warranty or as-of date needs review.',
      };
    }

    const warrantyDays = Math.round((warrantyDate.getTime() - asOfDate.getTime()) / MILLISECONDS_PER_DAY);
    if (equipment.condition !== 'working') {
      return {
        equipment,
        warrantyDays,
        priority: 'urgent',
        reason: equipment.condition === 'in-repair' ? 'Equipment is already in repair.' : 'Equipment needs repair.',
      };
    }
    if (warrantyDays < 0) {
      return {
        equipment,
        warrantyDays,
        priority: 'urgent',
        reason: 'Warranty has expired.',
      };
    }
    if (warrantyDays <= WARRANTY_SOON_DAYS) {
      return {
        equipment,
        warrantyDays,
        priority: 'soon',
        reason: `Warranty expires in ${warrantyDays} days.`,
      };
    }
    return {
      equipment,
      warrantyDays,
      priority: 'healthy',
      reason: `Warranty has ${warrantyDays} days remaining.`,
    };
  });
}
