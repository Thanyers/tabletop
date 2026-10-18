import {describe,expect,it} from 'vitest';
import {isNegatedManualAction} from './TrioManualDock';

describe('manual action intent',()=>{
 it('blocks English instructions that explicitly withhold approval',()=>{
  for(const text of ['do not approve yet',"don't approve",'don’t approve','never approve this'])expect(isNegatedManualAction(text)).toBe(true);
 });
 it('blocks Thai instructions that withhold approval or checking',()=>{
  for(const text of ['อย่าเพิ่งอนุมัติ','ยังไม่อนุมัติ','ไม่ต้องตรวจ','อย่าทดสอบ'])expect(isNegatedManualAction(text)).toBe(true);
 });
 it('does not execute checks requested in negative English instructions',()=>{
  for(const text of ['do not verify',"don't test yet",'never test this'])expect(isNegatedManualAction(text)).toBe(true);
 });
 it('allows positive action intent and negative reveal rules to reach their own handlers',()=>{
  for(const text of ['approve this','verify samples','อนุมัติกติกานี้','คำใบ้แรก 3 นาที ไม่เฉลยอัตโนมัติ'])expect(isNegatedManualAction(text)).toBe(false);
 });
});
