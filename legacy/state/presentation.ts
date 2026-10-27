import type { CanvasObject, ObjectKind } from './types';
import { findNearbyPosition, makeObject } from './objects';

export type ConstructionPhase = 'skeleton' | 'compose' | 'settled';
export interface PresentationBeat {
 id:number;
 ids:string[];
 label:string;
 phase:ConstructionPhase;
}
export interface StageBounds { left:number; top:number; width:number; height:number }

const kinds=new Set<ObjectKind>(['context','source','worker','table','dashboard','exceptions','knowledge','proposal','evaluation','intake','learning','overview']);

// Presentation shells never enter the dataset, run history, or saved workspace.
export function presentedObjects(objects:CanvasObject[],beat:PresentationBeat|null,domain:'accounting'|'maintenance',bounds:StageBounds,guided:boolean):CanvasObject[]{
 const items=[...objects];
 if(beat?.phase==='skeleton')for(const id of beat.ids){
  if(kinds.has(id as ObjectKind)&&!items.some(o=>o.id===id||o.kind===id)){
   let shell=makeObject(id as ObjectKind,domain);
   if(guided&&id==='table')shell={...shell,width:440,height:260};
   if(id==='learning'||id==='overview'){
    const anchor=objects.find(o=>o.kind===(id==='learning'?'table':'context'))??objects[0];
    if(anchor)shell={...shell,position:findNearbyPosition(objects,anchor,{width:shell.width,height:shell.height}),dependencies:[anchor.id]};
   }
   items.push({...shell,configuration:{presentationShell:true}});
  }
 }
 if(!guided)return items;
 const maxWidth=Math.max(240,bounds.width-32),maxHeight=Math.max(160,bounds.height-28);
 return items.map(o=>o.placementMode==='pinned'||o.placementMode==='user'?o:{...o,width:Math.min(o.width,maxWidth),height:Math.min(o.height,maxHeight)});
}
