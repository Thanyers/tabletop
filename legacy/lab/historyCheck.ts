import type { TapRecord } from './types';
export function checkAppendedHistory(before: TapRecord[], after: TapRecord[], hands: ('left'|'right')[]) {
  const added = after.slice(-hands.length);
  const expectedPrefix = before.slice(Math.max(0, before.length + hands.length - 500));
  return { added, preserved: after.length === Math.min(500,before.length+hands.length)
    && new Set(added.map(record=>record.id)).size === hands.length
    && JSON.stringify(after.slice(0,-hands.length))===JSON.stringify(expectedPrefix)
    && added.every((record,index)=>record.hand===hands[index]&&!before.some(old=>old.id===record.id)) };
}
