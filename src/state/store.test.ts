import { beforeEach, describe, expect, it, vi } from 'vitest';
import { newWorkspace, useWorkspace } from './store';
import { makeObject } from './objects';
import type { Policy } from '../domain/types';

const storage=new Map<string,string>();
const localStorageMock={getItem:(key:string)=>storage.get(key)||null,setItem:(key:string,value:string)=>{storage.set(key,value);},removeItem:(key:string)=>storage.delete(key),clear:()=>storage.clear()};
function candidate():Policy{return {...useWorkspace.getState().workspace.policy,laptop:{threshold:15000,usefulLifeMonths:36,start:'in-service'}};}
function proposeAndTest(){useWorkspace.getState().propose(candidate(),'Laptops >= THB 15,000, 36 months, from the in-service month');useWorkspace.getState().testProposal();}
beforeEach(()=>{storage.clear();vi.stubGlobal('localStorage',localStorageMock);useWorkspace.setState({workspace:newWorkspace('accounting'),library:{},toast:null,inspector:null,busy:false,focusObjectId:null,focusRequest:0});});
describe('approval and historical integrity',()=>{
 it('does not apply an untested, failed, or rejected proposal',()=>{
  const before=useWorkspace.getState().workspace.result.summary.calculated;
  useWorkspace.getState().propose({...candidate(),laptop:{...candidate().laptop,threshold:19000}},'A deliberately failing change');
  useWorkspace.getState().approve();expect(useWorkspace.getState().workspace.policy.version).toBe(1);
  useWorkspace.getState().testProposal();expect(useWorkspace.getState().workspace.proposals[0].evaluation!.failed).toBeGreaterThan(0);
  useWorkspace.getState().approve();expect(useWorkspace.getState().workspace.result.summary.calculated).toBe(before);
  useWorkspace.getState().reject();useWorkspace.getState().approve();expect(useWorkspace.getState().workspace.policy.version).toBe(1);
 });
 it('approves once, preserves snapshots, and restores as a new version',()=>{
  useWorkspace.getState().begin('accounting','Investigate');const original=structuredClone(useWorkspace.getState().workspace.runs[0]);
  proposeAndTest();expect(useWorkspace.getState().workspace.policy.version).toBe(1);useWorkspace.getState().approve();
  let w=useWorkspace.getState().workspace;expect(w.policy.version).toBe(2);expect(w.result.rows[0].calculated).toBe(500);expect(w.result.summary.exceptions).toBe(20);expect(w.runs[0]).toEqual(original);expect(w.runs[1].approvalRef).toBeTruthy();
  expect(w.events.find(e=>e.humanAction==='approve')?.runId).toBe(w.runs[1].id);expect(w.events.find(e=>e.humanAction==='approve')?.ruleVersion).toBe(2);
  expect(w.events.find(e=>e.humanAction==='approve')).toMatchObject({title:'Human approved the rule',workerId:'local-human'});
  useWorkspace.getState().approve();expect(useWorkspace.getState().workspace.versions.length).toBe(2);
  useWorkspace.getState().rollback(1);w=useWorkspace.getState().workspace;expect(w.policy.version).toBe(3);expect(w.policy.laptop).toEqual(original.policy.laptop);expect(w.runs[0]).toEqual(original);expect(w.versions.length).toBe(3);
 });
 it('refuses an ambiguous one-record correction',()=>{
  const w=useWorkspace.getState().workspace;w.dataset.assets[1].rowId=w.dataset.assets[0].rowId;const before=w.dataset.assets.map(a=>a.recordedMonthlyDepreciation);useWorkspace.setState({workspace:w});useWorkspace.getState().correctAsset(w.dataset.assets[0].rowId,{recordedMonthlyDepreciation:777});expect(useWorkspace.getState().workspace.dataset.assets.map(a=>a.recordedMonthlyDepreciation)).toEqual(before);expect(useWorkspace.getState().toast).toContain('ambiguous');
 });
 it('invalidates evaluated impacts after any source correction or new period',()=>{
  proposeAndTest();const rowId=useWorkspace.getState().workspace.dataset.assets[0].rowId;
  useWorkspace.getState().correctAsset(rowId,{recordedMonthlyDepreciation:700});
  expect(useWorkspace.getState().workspace.proposals[0].evaluation).toBeUndefined();useWorkspace.getState().approve();expect(useWorkspace.getState().workspace.policy.version).toBe(1);
  useWorkspace.getState().testProposal();useWorkspace.getState().nextMonth();expect(useWorkspace.getState().workspace.proposals[0].status).toBe('proposed');expect(useWorkspace.getState().workspace.dataset.period).toBe('2026-10');
 });
 it('retains handoff context and cannot resolve unverified evidence',()=>{
  const row=useWorkspace.getState().workspace.result.rows.find(r=>r.findings.some(f=>f.code==='missing-in-service-date'))!;
  useWorkspace.getState().handoffAction(row.asset.rowId,'continue','Demo reviewer');useWorkspace.getState().handoffAction(row.asset.rowId,'resolve');
  const h=useWorkspace.getState().workspace.handoffs[0];expect(h.status).toBe('waiting');expect(h.owner).toBe('Demo reviewer');expect(h.attempts.length).toBe(2);
 });
});
describe('explicit persistence and domain separation',()=>{
 it('keeps temporary work in memory until saved, then autosaves layout and history',()=>{
  const token=useWorkspace.getState().begin('accounting','Test save');useWorkspace.getState().addObject('source',token);expect(storage.size).toBe(0);
  useWorkspace.getState().save();expect(storage.size).toBe(1);const objects=useWorkspace.getState().workspace.objects.map(o=>({...o,position:{x:45,y:67},manuallyArranged:true}));useWorkspace.getState().updateLayout(objects);
  const raw=JSON.parse([...storage.values()][0]);expect(raw.accounting.objects[0].position).toEqual({x:45,y:67});expect(raw.accounting.runs.length).toBe(1);
 });
 it('preserves invalid numeric source evidence over save and restore',async()=>{
  useWorkspace.getState().save();vi.resetModules();const restored=await import('./store');const bad=restored.useWorkspace.getState().workspace.dataset.assets.find(a=>a.assetId==='FA-020')!;expect(Number.isNaN(bad.cost)).toBe(true);expect(restored.useWorkspace.getState().workspace.result.summary.exceptions).toBe(27);
 });
 it('does not claim a successful save if browser storage rejects it',()=>{
  vi.stubGlobal('localStorage',{...localStorageMock,setItem:()=>{throw new Error('quota');}});useWorkspace.getState().save();expect(useWorkspace.getState().workspace.saved).toBe(false);expect(useWorkspace.getState().toast).toContain('Storage is full');
 });
 it('upgrades live results from an earlier preview while preserving historical numbers',async()=>{
  useWorkspace.getState().begin('accounting','Legacy save');proposeAndTest();useWorkspace.getState().save();const raw=JSON.parse([...storage.values()][0]);delete raw.accounting.result.ledgerFindings;delete raw.accounting.runs[0].result.ledgerFindings;const oldTotal=raw.accounting.runs[0].result.summary.calculated;storage.set('living-canvas.workspaces.v1',JSON.stringify(raw));vi.resetModules();const restored=await import('./store');const w=restored.useWorkspace.getState().workspace;expect(w.result.ledgerFindings).toEqual([]);expect(w.proposals[0].evaluation).toBeUndefined();expect(w.runs[0].result.summary.calculated).toBe(oldTotal);
 });
 it('uses real equipment snapshots and recalculates priorities on an incident',()=>{
  useWorkspace.getState().begin('maintenance','Review equipment');const before=useWorkspace.getState().workspace;expect(before.dataset.assets).toHaveLength(0);expect(before.runs[0].equipmentSnapshot).toHaveLength(12);expect(before.events[0].workerId).toBe('warranty-worker');
  useWorkspace.getState().addIncident('EQ-001','The screen flickers','Demo operator');let w=useWorkspace.getState().workspace;expect(w.runs.at(-1)!.equipmentResults!.find(e=>e.equipment.id==='EQ-001')!.priority).toBe('urgent');expect(w.runs[0].equipmentSnapshot![0].condition).toBe('working');
  expect(w.events.find(e=>e.humanAction==='report')?.runId).toBe(w.runs.at(-1)!.id);
  useWorkspace.getState().setEquipmentCondition('EQ-001','working');w=useWorkspace.getState().workspace;expect(w.incidents[0].status).toBe('resolved');expect(w.runs.at(-1)!.equipmentResults![0].priority).toBe('healthy');
 });
});

describe('spatial canvas and contextual learning',()=>{
 it('reuses and focuses contextual cards while refreshing their actual subject configuration',()=>{
  const w=newWorkspace('accounting');const table=makeObject('table','accounting');const source=makeObject('source','accounting');
  useWorkspace.setState({workspace:{...w,objects:[table,source]}});
  useWorkspace.getState().openLearning('ROW-001','table');
  let state=useWorkspace.getState();const learning=state.workspace.objects.find(o=>o.kind==='learning')!;const firstRequest=state.focusRequest;
  expect(state.focusObjectId).toBe(learning.id);expect(learning.configuration.rowId).toBe('ROW-001');expect(learning.configuration.subjectId).toBe('table');
  state.openLearning('ROW-002','table');state=useWorkspace.getState();
  expect(state.workspace.objects.filter(o=>o.kind==='learning')).toHaveLength(1);expect(state.workspace.objects.find(o=>o.kind==='learning')?.id).toBe(learning.id);expect(state.workspace.objects.find(o=>o.kind==='learning')?.configuration.rowId).toBe('ROW-002');expect(state.focusRequest).toBe(firstRequest+1);
  state.explainWorkspace();state=useWorkspace.getState();const overview=state.workspace.objects.find(o=>o.kind==='overview')!;const request=state.focusRequest;
  expect(state.focusObjectId).toBe(overview.id);expect(state.workspace.events.at(-1)?.title).toBe('Explained this workspace');
  state.explainWorkspace();state=useWorkspace.getState();expect(state.workspace.objects.filter(o=>o.kind==='overview')).toHaveLength(1);expect(state.workspace.objects.find(o=>o.kind==='overview')?.id).toBe(overview.id);expect(state.focusRequest).toBe(request+1);
 });

 it('uses the selected canvas subject when opening a generic Learning Lens',()=>{
  const w=newWorkspace('accounting');const table=makeObject('table','accounting');const source=makeObject('source','accounting');
  useWorkspace.setState({workspace:{...w,objects:[table,source]}});
  useWorkspace.getState().openLearning(undefined,'table');
  const next=useWorkspace.getState().workspace;const lens=next.objects.find(o=>o.kind==='learning')!;
  expect(lens.configuration.rowId).toBeUndefined();
  expect(lens.configuration.subjectId).toBe('table');
  expect(lens.dataRefs).toContain(w.dataset.id);
  expect(next.events.at(-1)?.detail).toContain(`${table.title}: ${table.title} is the table object`);
 });

 it('keeps user and pinned layouts fixed through replay and allows only context cards to be removed',()=>{
  const w=newWorkspace('accounting');const table=makeObject('table','accounting');const source=makeObject('source','accounting');
  useWorkspace.setState({workspace:{...w,objects:[table,source]}});
  const moved=useWorkspace.getState().workspace.objects.map(o=>o.id==='table'?{...o,position:{x:115,y:225}}:o);
  useWorkspace.getState().updateLayout(moved);useWorkspace.getState().setObjectPlacement('source','pinned');
  const before=useWorkspace.getState().workspace.objects.map(o=>({id:o.id,position:{...o.position},mode:o.placementMode}));
  proposeAndTest();useWorkspace.getState().approve();
  const after=useWorkspace.getState().workspace.objects;
  for(const expected of before){const actual=after.find(o=>o.id===expected.id)!;expect(actual.position).toEqual(expected.position);expect(actual.placementMode).toBe(expected.mode);}
  useWorkspace.getState().openLearning('ROW-001','table');const lens=useWorkspace.getState().workspace.objects.find(o=>o.kind==='learning')!;
  useWorkspace.getState().removeContextObject('source');expect(useWorkspace.getState().workspace.objects.some(o=>o.id==='source')).toBe(true);
  useWorkspace.getState().removeContextObject(lens.id);expect(useWorkspace.getState().workspace.objects.some(o=>o.id===lens.id)).toBe(false);
 });

 it('supports layers, placement modes, worker collapse, and collision-aware expansion',()=>{
  const w=newWorkspace('accounting');const table=makeObject('table','accounting');const dashboard=makeObject('dashboard','accounting');const worker=makeObject('worker','accounting');
  useWorkspace.setState({workspace:{...w,objects:[table,dashboard,worker]}});
  const originalPosition={...worker.position};
  useWorkspace.getState().toggleWorker(worker.id);let expanded=useWorkspace.getState().workspace.objects.find(o=>o.id===worker.id)!;
  expect(expanded.collapsed).toBe(false);expect(expanded.height).toBeGreaterThan(worker.height);expect(expanded.position).not.toEqual(originalPosition);
  const overlaps=(object:typeof expanded)=>object.position.x<table.position.x+table.width+24&&object.position.x+object.width+24>table.position.x&&object.position.y<table.position.y+table.height+24&&object.position.y+object.height+24>table.position.y;
  expect(overlaps(expanded)).toBe(false);
  useWorkspace.getState().toggleWorker(worker.id);const collapsed=useWorkspace.getState().workspace.objects.find(o=>o.id===worker.id)!;expect(collapsed.collapsed).toBe(true);expect(collapsed.position).toEqual(originalPosition);
  useWorkspace.getState().setObjectPlacement(worker.id,'pinned');useWorkspace.getState().toggleWorker(worker.id);expanded=useWorkspace.getState().workspace.objects.find(o=>o.id===worker.id)!;
  expect(expanded.placementMode).toBe('pinned');expect(expanded.position).toEqual(originalPosition);
  useWorkspace.getState().setObjectLayer(table.id,'front');const raised=useWorkspace.getState().workspace.objects.find(o=>o.id===table.id)!;expect(raised.zIndex).toBeGreaterThan(Math.max(...useWorkspace.getState().workspace.objects.filter(o=>o.id!==table.id).map(o=>o.zIndex??0)));
  useWorkspace.getState().setObjectLayer(table.id,'back');const lowered=useWorkspace.getState().workspace.objects.find(o=>o.id===table.id)!;expect(lowered.zIndex).toBeLessThan(Math.min(...useWorkspace.getState().workspace.objects.filter(o=>o.id!==table.id).map(o=>o.zIndex??0)));
 });

 it('migrates saved v1 objects to placement, layer, and worker-collapse defaults',async()=>{
  const w=newWorkspace('accounting');const legacyWorker={...makeObject('worker','accounting'),placementMode:undefined,zIndex:undefined,collapsed:undefined};const legacyTable={...makeObject('table','accounting'),placementMode:undefined,zIndex:undefined,collapsed:undefined,manuallyArranged:true};
  const saved={...w,saved:true,savedAt:'2026-09-01T00:00:00.000Z',objects:[legacyWorker,legacyTable]};
  storage.set('living-canvas.workspaces.v1',JSON.stringify({accounting:saved,_activeDomain:'accounting'}));
  vi.resetModules();const restored=await import('./store');const objects=restored.useWorkspace.getState().workspace.objects;const worker=objects.find(o=>o.kind==='worker')!;const table=objects.find(o=>o.kind==='table')!;
  expect(worker.placementMode).toBe('ai');expect(worker.collapsed).toBe(true);expect(typeof worker.zIndex).toBe('number');
  expect(table.placementMode).toBe('user');expect(table.manuallyArranged).toBe(true);expect(typeof table.zIndex).toBe('number');
 });
});

