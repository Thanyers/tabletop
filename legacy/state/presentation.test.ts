import {describe,expect,it} from 'vitest';
import {makeObject} from './objects';
import {presentedObjects,type PresentationBeat} from './presentation';

const stage={left:20,top:20,width:290,height:300};
const beat:PresentationBeat={id:1,ids:['table'],label:'Build table',phase:'skeleton'};
describe('construction presentation',()=>{
 it('shows an uncommitted shell before real content and retains the real object identity on reveal',()=>{
  const original=[makeObject('source','accounting')];
  const preview=presentedObjects(original,beat,'accounting',stage,true);
  expect(original).toHaveLength(1);expect(preview.find(o=>o.kind==='table')?.configuration.presentationShell).toBe(true);
  const table=makeObject('table','accounting');
  const real=presentedObjects([...original,table],{...beat,phase:'compose'},'accounting',stage,true);
  expect(real.filter(o=>o.kind==='table')).toHaveLength(1);expect(real.find(o=>o.kind==='table')?.id).toBe(table.id);expect(real.find(o=>o.kind==='table')?.configuration.presentationShell).toBeUndefined();
 });
 it('bounds guided AI cards without changing saved geometry or resizing user placements',()=>{
  const table=makeObject('table','accounting'),before=structuredClone(table);
  const rendered=presentedObjects([table],null,'accounting',stage,true)[0];
  expect(rendered.width).toBeLessThan(stage.width);expect(rendered.height).toBeLessThan(stage.height);expect(table).toEqual(before);
  expect(presentedObjects([{...table,placementMode:'pinned'}],null,'accounting',stage,true)[0].width).toBe(table.width);
  expect(presentedObjects([table],null,'accounting',stage,false)[0]).toBe(table);
 });
});
