import {describe,expect,it} from 'vitest';
import {deriveTrioKnowledge} from './TrioConstellation';
import {initialRules} from './domain';
import type {TrioSnapshot} from './types';

function snapshot():TrioSnapshot {
 return {caseId:'quest',level:8,active:initialRules(),draft:initialRules(),simulation:initialRules(),evaluation:null,version:2,approved:true,handoff:'in-progress',events:[
  {id:'source-one',kind:'source',title:'Playtest notes',detail:'A person marked the library clue as confusing.',version:1,at:'2026-10-15T10:00:00Z',references:[]},
  {id:'instruction-two',kind:'instruction',title:'Earlier optional hints',detail:'Keep the answer hidden.',version:2,at:'2026-10-15T10:01:00Z',references:['source-one','missing-reference']},
  {id:'approval-three',kind:'approval',title:'Approved in the fictional demo role',detail:'Authored demo approval.',version:2,at:'2026-10-15T10:02:00Z',references:['instruction-two']},
  {id:'handoff-four',kind:'handoff',title:'Q-LIBRARY-MARKER',detail:'The physical marker still needs confirmation.',version:2,at:'2026-10-15T10:03:00Z',references:['instruction-two']},
 ]};
}

describe('Trio evidence in the original constellation',()=>{
 it('uses only recorded events and resolving references',()=>{
  const graph=deriveTrioKnowledge(snapshot());
  expect(graph.nodes.map(n=>n.id)).toEqual(['source-one','instruction-two','approval-three','handoff-four']);
  expect(graph.links.map(l=>[l.fromId,l.toId,l.relation])).toEqual([
   ['instruction-two','source-one','references'],['approval-three','instruction-two','references'],['handoff-four','instruction-two','references'],
  ]);
  expect(graph.links.some(l=>l.toId==='missing-reference')).toBe(false);
 });
 it('retains unresolved work and does not invent an authenticated person',()=>{
  const graph=deriveTrioKnowledge(snapshot());
  expect(graph.nodes.find(n=>n.id==='handoff-four')?.status).toBe('pending');
  expect(graph.nodes.find(n=>n.id==='approval-three')?.title).toContain('fictional');
  expect(graph.nodes.some(n=>n.category==='person')).toBe(false);
 });
 it('preserves source context and targets the real corresponding work object',()=>{
  const graph=deriveTrioKnowledge(snapshot());
  const source=graph.nodes.find(n=>n.id==='source-one');
  expect(source?.detail).toContain('A person marked the library clue as confusing.');
  expect(source?.evidenceRefs).toEqual(['source-one']);
  expect(source?.workObjectId).toBe('sources');
  expect(graph.nodes.find(n=>n.id==='handoff-four')?.workObjectId).toBe('handoff');
 });
});
