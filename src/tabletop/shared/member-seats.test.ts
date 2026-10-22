import { describe, expect, it } from 'vitest';
import { MAX_TABLE_MEMBER_SEATS, NODE_TABLE_MEMBER_SEATS, SEATS, TABLE_MEMBER_SEATS, TABLE_TURN_SEATS, TABLE_TURN_SEAT_PATTERN, isSeat, isTableTurnSeat, tableMemberSeatLimit } from './contracts';

describe('table member seats', () => {
  it('derives every seat list from the single member-seat constant', () => {
    expect(TABLE_MEMBER_SEATS).toHaveLength(MAX_TABLE_MEMBER_SEATS);
    expect(TABLE_MEMBER_SEATS).toEqual(Array.from({ length: MAX_TABLE_MEMBER_SEATS }, (_, index) => `member-${index + 1}`));
    expect(TABLE_TURN_SEATS).toEqual(['host', ...TABLE_MEMBER_SEATS]);
    // Never shrink: every seat the Node runtime and older rooms store still parses.
    for (let index = 1; index <= NODE_TABLE_MEMBER_SEATS; index += 1) expect(isSeat(`member-${index}`)).toBe(true);
    expect(SEATS).toEqual(expect.arrayContaining(['learner-1', 'learner-2', 'mira', 'pip', 'member-12']));
    expect(isSeat('member-13')).toBe(false);
    expect(isSeat('member-0')).toBe(false);
    expect(isTableTurnSeat('host')).toBe(true);
    expect(TABLE_TURN_SEAT_PATTERN.test('member-12')).toBe(true);
    expect(TABLE_TURN_SEAT_PATTERN.test('member-13')).toBe(false);
    expect(TABLE_TURN_SEAT_PATTERN.test('member-1x')).toBe(false);
  });

  it('caps a table at its own limit but never above what the runtime hands out', () => {
    expect(tableMemberSeatLimit(undefined)).toBe(MAX_TABLE_MEMBER_SEATS);
    expect(tableMemberSeatLimit({ maxMembers: 4 })).toBe(4);
    expect(tableMemberSeatLimit({ maxMembers: 10 }, NODE_TABLE_MEMBER_SEATS)).toBe(NODE_TABLE_MEMBER_SEATS);
    expect(tableMemberSeatLimit({ maxMembers: 0 })).toBe(MAX_TABLE_MEMBER_SEATS);
  });
});
