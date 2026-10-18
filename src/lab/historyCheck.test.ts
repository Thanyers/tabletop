import { expect,it } from 'vitest';
import { checkAppendedHistory } from './historyCheck';
const record=(id:number,hand:'left'|'right'='left')=>({id:String(id),hand,offsetMs:0,at:id});
it('keeps older results and recognizes new taps at the 500-record boundary',()=>{
 const before=Array.from({length:500},(_,i)=>record(i));
 expect(checkAppendedHistory(before,[...before.slice(2),record(501),record(502,'right')],['left','right']).preserved).toBe(true);
 expect(checkAppendedHistory(before,[...before.slice(2),record(499),record(502,'right')],['left','right']).preserved).toBe(false);
});
it('rejects deletion or mutation of earlier records',()=>{
 const before=[record(1),record(2)];
 expect(checkAppendedHistory(before,[...before,record(3)],['left']).preserved).toBe(true);
 expect(checkAppendedHistory(before,[record(2),record(3)],['left']).preserved).toBe(false);
 expect(checkAppendedHistory(before,[{...record(1),offsetMs:12},record(2),record(3)],['left']).preserved).toBe(false);
});
it('rejects duplicate IDs within newly appended taps',()=>{
 expect(checkAppendedHistory([], [record(1),record(1,'right')], ['left','right']).preserved).toBe(false);
});
