import { beforeEach, describe, expect, it, vi } from 'vitest';
import { newWorkspace, useWorkspace } from './store';
import { createDataset } from '../domain/seed';
import type { SourceConnection } from '../domain/connections';
const storage=new Map<string,string>();
beforeEach(()=>{if(useWorkspace.getState().demoActive)useWorkspace.getState().endDemo();storage.clear();vi.stubGlobal('localStorage',{getItem:(key:string)=>storage.get(key)??null,setItem:(key:string,value:string)=>storage.set(key,value)});useWorkspace.setState({workspace:newWorkspace('accounting'),library:{},busy:false,inspector:null,demoActive:false,interactionMode:'use',lens:'work',persona:'analyst'});});
describe('guided sample isolation and lenses',()=>{
 it('keeps guided proof focus transient across exit and replay',()=>{
  useWorkspace.getState().save();const original=storage.get('living-canvas.workspaces.v1');
  useWorkspace.getState().startDemo();useWorkspace.getState().setDemoLearningFocus('experiment');useWorkspace.getState().save();
  const sample=storage.get('procedural.guided-demo.v1');expect(sample).toBeDefined();expect(JSON.parse(sample!)).not.toHaveProperty('demoLearningFocus');
  useWorkspace.getState().endDemo();expect(useWorkspace.getState().demoLearningFocus).toBeNull();expect(storage.get('living-canvas.workspaces.v1')).toBe(original);
  useWorkspace.getState().startDemo();expect(useWorkspace.getState().demoLearningFocus).toBeNull();useWorkspace.getState().endDemo();
 });
 it('keeps input provenance with its historical run and never replaces an uploaded ledger on monthly replay',()=>{
  const source:SourceConnection={id:'local-ledger-workbook',kind:'excel',name:'Selected workbook',resource:'local.xlsx · GL postings',rowCount:96,period:'2026-09',fields:[],mode:'local-file'};
  const dataset={...createDataset(),id:'local-september',source:'imported' as const};
  useWorkspace.getState().begin('accounting','Compare connected inputs',dataset,[source]);
  const first=structuredClone(useWorkspace.getState().workspace.runs[0]);source.resource='changed later';
  useWorkspace.getState().nextMonth();expect(useWorkspace.getState().workspace.dataset).toEqual(dataset);expect(useWorkspace.getState().workspace.runs).toHaveLength(1);
  useWorkspace.getState().begin('accounting','Bundled inputs',createDataset(),first.sourceConnections);
  const prior=structuredClone(useWorkspace.getState().workspace.runs[0]);useWorkspace.getState().nextMonth();
  expect(useWorkspace.getState().workspace.sourceConnections).toBeUndefined();expect(useWorkspace.getState().workspace.runs[0]).toEqual(prior);expect(useWorkspace.getState().workspace.runs[1].sourceConnections).toBeUndefined();expect(first.sourceConnections?.[0].resource).toBe('local.xlsx · GL postings');
 });
 it('adapts the same functional view without recalculating or changing accounting policy',()=>{
  const token=useWorkspace.getState().begin('accounting','Start small');useWorkspace.getState().addObject('table',token);
  const before=useWorkspace.getState().workspace;const tableId=before.objects[0].id;
  useWorkspace.getState().setAssetView('minimal');expect(useWorkspace.getState().workspace.objects[0]).toMatchObject({id:tableId,width:440,configuration:{assetView:'minimal'}});
  useWorkspace.getState().setAssetView('comparison');const after=useWorkspace.getState().workspace;
  expect(after.objects[0]).toMatchObject({id:tableId,width:650,configuration:{assetView:'comparison'}});expect(after.result).toBe(before.result);expect(after.dataset).toBe(before.dataset);expect(after.policy).toBe(before.policy);expect(after.runs).toBe(before.runs);
  useWorkspace.getState().setObjectPlacement(tableId,'pinned');useWorkspace.getState().setAssetView('full');expect(useWorkspace.getState().workspace.objects[0].height).toBe(350);
 });
 it('clears guided form stages and resets camera following on a fresh playback',()=>{
  useWorkspace.getState().startDemo();useWorkspace.getState().setDemoDraftStage('schedule-set');useWorkspace.getState().setDemoFollowCamera(false);useWorkspace.getState().endDemo();expect(useWorkspace.getState().demoDraftStage).toBeNull();
  useWorkspace.getState().startDemo();expect(useWorkspace.getState().demoFollowCamera).toBe(true);expect(useWorkspace.getState().demoDraftStage).toBeNull();useWorkspace.getState().endDemo();
 });
 it('keeps saved real work untouched through demo save and reopen',()=>{
  useWorkspace.getState().begin('accounting','My saved investigation');useWorkspace.getState().save();
  const original=storage.get('living-canvas.workspaces.v1');const originalWorkspace=structuredClone(useWorkspace.getState().workspace);
  useWorkspace.getState().startDemo();useWorkspace.getState().begin('accounting','Fictional sample');useWorkspace.getState().save();
  expect(storage.get('living-canvas.workspaces.v1')).toBe(original);expect(storage.has('procedural.guided-demo.v1')).toBe(true);
  useWorkspace.getState().restoreDemo();expect(useWorkspace.getState().workspace.prompt).toBe('Fictional sample');expect(useWorkspace.getState().persona).toBe('colleague');
  useWorkspace.getState().endDemo();expect(useWorkspace.getState().workspace).toEqual(originalWorkspace);expect(storage.get('living-canvas.workspaces.v1')).toBe(original);
 });
 it('hands off a temporary sample and preserves the original saved bytes',()=>{
  useWorkspace.getState().save();const original=storage.get('living-canvas.workspaces.v1');useWorkspace.getState().startDemo();useWorkspace.getState().begin('accounting','Try from here');useWorkspace.getState().endDemo(true);
  expect(useWorkspace.getState().workspace.prompt).toBe('Try from here');expect(useWorkspace.getState().workspace.saved).toBe(false);expect(storage.get('living-canvas.workspaces.v1')).toBe(original);
  useWorkspace.getState().begin('accounting','Continue sample');useWorkspace.getState().save();expect(storage.get('living-canvas.workspaces.v1')).toBe(original);expect(storage.has('procedural.sample-workspace.v1')).toBe(true);expect(useWorkspace.getState().workspace.saveSlot).toBe('sample');useWorkspace.getState().returnToSavedWork();expect(storage.get('living-canvas.workspaces.v1')).toBe(original);expect(useWorkspace.getState().workspace.saveSlot).toBeUndefined();
 });
 it('focuses generated context objects by kind without losing their actual identity',()=>{
  const token=useWorkspace.getState().begin('accounting','Explain');useWorkspace.getState().addObject('context',token);useWorkspace.getState().finish(token);useWorkspace.getState().explainWorkspace();const id=useWorkspace.getState().workspace.objects.find(o=>o.kind==='overview')!.id;useWorkspace.getState().focusLiveObject('overview');expect(useWorkspace.getState().focusObjectId).toBe(id);
 });
 it('keeps unsaved original work recoverable after taking over and saving a sample',()=>{
  useWorkspace.getState().begin('maintenance','Unsaved equipment investigation');const original=structuredClone(useWorkspace.getState().workspace);useWorkspace.getState().startDemo();useWorkspace.getState().begin('accounting','Sample');useWorkspace.getState().endDemo(true);useWorkspace.getState().save();useWorkspace.getState().returnToSavedWork();expect(useWorkspace.getState().workspace).toEqual(original);expect(useWorkspace.getState().workspace.saved).toBe(false);useWorkspace.getState().openSavedSample();expect(useWorkspace.getState().workspace.saveSlot).toBe('sample');expect(useWorkspace.getState().workspace.saved).toBe(true);useWorkspace.getState().reset();expect(useWorkspace.getState().workspace.sampleOriginDomain).toBe('maintenance');useWorkspace.getState().returnToSavedWork();expect(useWorkspace.getState().workspace.prompt).toBe('Unsaved equipment investigation');
 });
 it('switches semantic lenses without changing approved data or work coordinates',()=>{
  const before=structuredClone(useWorkspace.getState().workspace);useWorkspace.getState().setLens('constellation');useWorkspace.getState().setLens('work');useWorkspace.getState().setInteractionMode('arrange');useWorkspace.getState().setInteractionMode('use');expect(useWorkspace.getState().workspace).toEqual(before);
 });
 it('rejects invalid category proposals and preserves submitted candidate values',()=>{
  const base=useWorkspace.getState().workspace.policy;
  useWorkspace.getState().propose({...base,categoryRules:{Furniture:{threshold:-1}}},'Invalid');expect(useWorkspace.getState().workspace.proposals).toHaveLength(0);
  const candidate={...base,categoryRules:{Furniture:{threshold:10000}}};useWorkspace.getState().propose(candidate,'Furniture policy');candidate.categoryRules.Furniture.threshold=99;expect(useWorkspace.getState().workspace.proposals[0].candidate.categoryRules?.Furniture?.threshold).toBe(10000);
 });
 it('retains a correction rationale and cannot resolve an absent source row',()=>{
  useWorkspace.getState().begin('accounting','Investigate');useWorkspace.getState().correctAsset('ROW-009',{inServiceDate:'2026-08-01'},'Verified from the source document');expect(useWorkspace.getState().workspace.events.find(e=>e.humanAction==='case-correction')?.detail).toContain('Verified from the source document');
  useWorkspace.getState().handoffAction('NOT-A-ROW','resolve');expect(useWorkspace.getState().workspace.handoffs).toHaveLength(0);
 });
});
