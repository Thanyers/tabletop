import { describe, expect, it } from 'vitest';
import { linkableCandidates, type LinkedSource, type SourceCandidate } from './RoomSourcesPanel';

/**
 * F080 / D-052: the picker must never offer the room itself or a table the room already references,
 * because both are refused by the command and would only confuse the person.
 */
const candidates: SourceCandidate[] = [
  { workspaceId: 'room-1', title: 'The room' },
  { workspaceId: 'table-a', title: 'Plan' },
  { workspaceId: 'table-b', title: 'Budget' },
  { workspaceId: 'table-c', title: 'People' },
];

describe('which tables can still be linked', () => {
  it('offers every table when nothing is linked yet, except the room itself', () => {
    expect(linkableCandidates(candidates, [], 'room-1').map(entry => entry.workspaceId)).toEqual(['table-a', 'table-b', 'table-c']);
  });

  it('drops tables the room already references, whatever their status', () => {
    const linked: LinkedSource[] = [
      { workspaceId: 'table-a', title: 'Plan', status: 'linked' },
      { workspaceId: 'table-b', title: 'Budget', status: 'revoked' },
    ];
    expect(linkableCandidates(candidates, linked, 'room-1').map(entry => entry.workspaceId)).toEqual(['table-c']);
  });

  it('keeps the order the caller gave, so the picker is stable between renders', () => {
    expect(linkableCandidates(candidates, [], 'room-1').map(entry => entry.title)).toEqual(['Plan', 'Budget', 'People']);
  });
});
