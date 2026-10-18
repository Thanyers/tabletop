import { create } from 'zustand';
import type { PresentationBeat } from './presentation';
import type { Asset, Dataset, Equipment, Policy } from '../domain/types';
import type { SourceConnection } from '../domain/connections';
import { BASE_POLICY, createDataset } from '../domain/seed';
import { reconcile } from '../domain/accounting';
import { evaluateProposal } from '../domain/evaluation';
import { deriveLearning as buildLearning, explainWorkspace as buildWorkspaceExplanation } from '../domain/learning';
import { createEquipment, evaluateEquipment } from '../domain/maintenance';
import { findNearbyPosition, makeObject } from './objects';
import type { AssetViewStage, CanvasObject, DemoDraftStage, Domain, InspectorTarget, PlacementMode, Proposal, TraceEvent, Workspace } from './types';

const STORAGE_KEY='living-canvas.workspaces.v1';
const DEMO_STORAGE_KEY='procedural.guided-demo.v1';
const SAMPLE_STORAGE_KEY='procedural.sample-workspace.v1';
const SAMPLE_ACTIVE_KEY='procedural.active-sample.v1';
let demoBackup:{workspace:Workspace;library:Partial<Record<Domain,Workspace>>}|null=null;
let sampleOriginBackup:{workspace:Workspace;library:Partial<Record<Domain,Workspace>>}|null=null;
const EXPANDED_WORKER_HEIGHT=280;
const COMPACT_WORKER_HEIGHT=100;
const encodeWorkspace=(_key:string,value:unknown)=>typeof value==='number'&&!Number.isFinite(value)?{__lc_numeric:String(value)}:value;
const decodeWorkspace=(_key:string,value:unknown)=>value&&typeof value==='object'&&'__lc_numeric' in value?Number((value as {__lc_numeric:string}).__lc_numeric):value;
export const uid=(prefix:string)=>`${prefix}-${crypto.randomUUID().slice(0,8)}`;
const now=()=>new Date().toISOString();
function normalizeSavedObject(object:CanvasObject,index:number):CanvasObject{
 const candidate=object.placementMode;
 const placementMode:PlacementMode=candidate==='user'||candidate==='pinned'||candidate==='ai'?candidate:object.manuallyArranged?'user':'ai';
 return {...object,zIndex:typeof object.zIndex==='number'&&Number.isFinite(object.zIndex)?object.zIndex:index,placementMode,collapsed:typeof object.collapsed==='boolean'?object.collapsed:object.kind==='worker'};
}
function nextZIndex(objects:readonly CanvasObject[]):number{
 return objects.reduce((maximum,object,index)=>Math.max(maximum,object.zIndex??index),-1)+1;
}
function placedNear(objects:readonly CanvasObject[],object:CanvasObject,anchor:CanvasObject):CanvasObject{
 return {...object,position:findNearbyPosition(objects,anchor,{width:object.width,height:object.height}),zIndex:nextZIndex(objects),placementMode:'ai'};
}
function positionValue(value:unknown):value is {x:number;y:number}{
 return typeof value==='object'&&value!==null&&'x' in value&&'y' in value&&typeof value.x==='number'&&Number.isFinite(value.x)&&typeof value.y==='number'&&Number.isFinite(value.y);
}
function sizeValue(value:unknown):value is {width:number;height:number}{
 return typeof value==='object'&&value!==null&&'width' in value&&'height' in value&&typeof value.width==='number'&&Number.isFinite(value.width)&&typeof value.height==='number'&&Number.isFinite(value.height);
}
function layoutUpdate(workspace:Workspace,objects:CanvasObject[]):CanvasObject[]{
 const previousById=new Map(workspace.objects.map((object)=>[object.id,object]));
 return objects.map((object,index)=>{
  const previous=previousById.get(object.id);
  const moved=previous!==undefined&&(previous.position.x!==object.position.x||previous.position.y!==object.position.y);
  const placementMode:PlacementMode=previous?.placementMode==='pinned'?'pinned':moved?'user':object.placementMode??previous?.placementMode??(object.manuallyArranged?'user':'ai');
  return {...object,zIndex:typeof object.zIndex==='number'&&Number.isFinite(object.zIndex)?object.zIndex:previous?.zIndex??index,placementMode,collapsed:typeof object.collapsed==='boolean'?object.collapsed:previous?.collapsed??object.kind==='worker',manuallyArranged:object.manuallyArranged??previous?.manuallyArranged??placementMode!=='ai'};
 });
}
export const ACCOUNTING_PROMPT="Find out why this month's depreciation doesn't reconcile with the general ledger, and build me a reusable way to investigate it.";
export const MAINTENANCE_PROMPT='Find equipment that needs a repair or is nearing the end of its warranty, and give the team a way to report issues.';
export const TEACHING_PROMPT='บริษัทเรามีกฎเฉพาะนะ Laptop ที่ราคา 15,000 บาทขึ้นไป ให้ถือเป็นสินทรัพย์ และคิดค่าเสื่อม 36 เดือน เริ่มเดือนที่พร้อมใช้งาน';
export function newWorkspace(domain:Domain):Workspace{
 const dataset:Dataset=domain==='accounting'?createDataset():{id:'equipment-register',name:'Northstar equipment inventory',period:'2026-09',assets:[],ledger:[],source:'synthetic'}; const policy=structuredClone(BASE_POLICY);
 return {schemaVersion:1,domain,title:domain==='accounting'?'Northstar · monthly close':'Northstar · equipment care',prompt:'',objects:[],dataset,policy,versions:[policy],proposals:[],activeProposalId:null,result:reconcile(dataset,policy),runs:[],events:[],equipment:createEquipment(),incidents:[],handoffs:[],saved:false,savedAt:null,viewport:{x:0,y:0,zoom:1},preferences:{hideMatched:false},agentConfiguration:{mode:'deterministic-demo',approvalRequired:true}};
}
function loadSaved():{library:Partial<Record<Domain,Workspace>>;activeDomain?:Domain;error?:string}{
 try {const raw=localStorage.getItem(STORAGE_KEY);if(!raw)return {library:{}};const parsed=JSON.parse(raw,decodeWorkspace);const library:Partial<Record<Domain,Workspace>>={};
 for(const domain of ['accounting','maintenance'] as Domain[]){const w=parsed?.[domain];if(w?.schemaVersion===1&&w?.saved&&w.domain===domain&&Array.isArray(w.objects)&&Array.isArray(w.dataset?.assets)&&Array.isArray(w.dataset?.ledger)&&Array.isArray(w.versions)&&Array.isArray(w.proposals)&&Array.isArray(w.events)&&Array.isArray(w.runs)&&Array.isArray(w.equipment)&&Array.isArray(w.incidents)&&Array.isArray(w.handoffs)&&w.result?.summary&&Array.isArray(w.result?.rows)&&w.policy?.laptop&&w.preferences&&w.viewport){
  // Earlier local previews did not record ledger-only findings. Refresh the live
  // result and invalidate pending checks; never rewrite historical calculations.
  const needsUpgrade=!Array.isArray(w.result.ledgerFindings);
  const normalized={...w,objects:w.objects.map((object:CanvasObject,index:number)=>normalizeSavedObject(object,index))};
  library[domain]=needsUpgrade?{...normalized,result:reconcile(w.dataset,w.policy),proposals:w.proposals.map((p:Proposal)=>p.status==='tested'?{...p,status:'proposed',evaluation:undefined}:p)}:normalized;
 }else if(w){return {library:{},error:'A saved workspace has an unsupported format. The stored copy is preserved.'};}}
 return {library,activeDomain:parsed._activeDomain==='maintenance'?'maintenance':'accounting'};}catch{return {library:{},error:'Saved workspace could not be read. Your local copy has not been overwritten.'};}
}
function event(w:Workspace,title:string,detail:string,options:Partial<TraceEvent>={}):TraceEvent{
 const at=now();return {id:uid('event'),runId:w.runs.at(-1)?.id||uid('run'),taskId:`${w.domain}-investigation`,workerId:w.domain==='accounting'?'depreciation-worker':'warranty-worker',workerType:'deterministic',title,detail,inputs:[w.dataset.id,`policy-v${w.policy.version}`],outputs:[w.domain==='accounting'?'reconciliation':'maintenance-priorities'],ruleVersion:w.policy.version,startedAt:at,endedAt:at,status:'completed',...options};
}
function replay(w:Workspace,cause:string,approvalRef?:string,attachLastAction=false):Workspace{
 const result=reconcile(w.dataset,w.policy);const runId=uid('run');
 const equipmentResults=w.domain==='maintenance'?evaluateEquipment(w.equipment):undefined;
 const run={id:runId,createdAt:now(),cause,dataset:structuredClone(w.dataset),policy:structuredClone(w.policy),result:structuredClone(result),sourceConnections:structuredClone(w.sourceConnections),approvalRef,...(equipmentResults?{equipmentResults,equipmentSnapshot:structuredClone(w.equipment)}:{})};
 const next={...w,result,runs:[...w.runs,run],objects:w.objects.map(o=>({...o,executionRef:runId,version:w.policy.version}))};
 const events=attachLastAction?w.events.map((e,index)=>index===w.events.length-1?{...e,runId,ruleVersion:w.policy.version}:e):w.events;
 return {...next,events:[...events,event(next,cause,equipmentResults?`${equipmentResults.length} equipment records evaluated; ${equipmentResults.filter(e=>e.priority!=='healthy').length} need attention.`:`${result.summary.totalAssets} rows evaluated; ${result.summary.exceptions} require review.`,{runId,approvalRef})]};
}
function invalidateTests(w:Workspace):Workspace{return {...w,proposals:w.proposals.map(p=>p.status==='tested'?{...p,status:'proposed',evaluation:undefined}:p)};}
interface Store{
 demoLearningFocus: 'why'|'approved'|'experiment'|null;setDemoLearningFocus:(focus:'why'|'approved'|'experiment'|null)=>void;
 presentation:PresentationBeat|null;setPresentation:(beat:PresentationBeat|null)=>void;
 interactionMode:'use'|'arrange';lens:'work'|'constellation';persona:'analyst'|'colleague';demoActive:boolean;demoPaused:boolean;demoDraftStage:DemoDraftStage;demoFollowCamera:boolean;
 setDemoFollowCamera:(follow:boolean)=>void;setDemoDraftStage:(stage:DemoDraftStage)=>void;setAssetView:(stage:AssetViewStage,reason?:string)=>void;
 setInteractionMode:(mode:'use'|'arrange')=>void;setLens:(lens:'work'|'constellation')=>void;setPersona:(persona:'analyst'|'colleague')=>void;focusLiveObject:(id:string)=>void;
 startDemo:()=>void;endDemo:(takeOver?:boolean)=>void;restoreDemo:()=>void;returnToSavedWork:()=>void;openSavedSample:()=>void;hasSavedSample:boolean;
 workspace:Workspace;library:Partial<Record<Domain,Workspace>>;inspector:InspectorTarget|null;busy:boolean;activity:string;toast:string|null;dependencies:boolean;generation:number;focusObjectId:string|null;focusRequest:number;
 setInspector:(target:InspectorTarget|null)=>void;notify:(text:string)=>void;setDependencies:()=>void;
 begin:(domain:Domain,prompt:string,dataset?:Dataset,connections?:SourceConnection[])=>number;addObject:(kind:CanvasObject['kind'],token:number)=>void;setActivity:(text:string,token:number)=>void;finish:(token:number)=>void;
 updateLayout:(objects:CanvasObject[])=>void;setViewport:(viewport:Workspace['viewport'])=>void;save:()=>void;switchDomain:(domain:Domain)=>void;reset:()=>void;
 openLearning:(rowId?:string,subjectId?:string)=>void;explainWorkspace:()=>void;setObjectPlacement:(id:string,mode:PlacementMode)=>void;setObjectLayer:(id:string,direction:'front'|'back')=>void;toggleWorker:(id:string)=>void;removeContextObject:(id:string)=>void;
 propose:(candidate:Policy,instruction:string)=>void;testProposal:()=>void;approve:()=>void;reject:()=>void;rollback:(version:number)=>void;
 correctAsset:(rowId:string,patch:Partial<Asset>,note?:string)=>void;nextMonth:()=>void;setHideMatched:(value:boolean)=>void;
 handoffAction:(rowId:string,action:'retry'|'continue'|'reject'|'resolve',owner?:string)=>void;
 addIncident:(equipmentId:string,description:string,reporter:string)=>void;setEquipmentCondition:(id:string,condition:Equipment['condition'])=>void;
}
const initial=loadSaved();
function loadActiveSample(requireActive=true):Workspace|null{try{if(requireActive&&localStorage.getItem(SAMPLE_ACTIVE_KEY)!=='true')return null;const w=JSON.parse(localStorage.getItem(SAMPLE_STORAGE_KEY)||'null',decodeWorkspace) as Workspace|null;return w?.schemaVersion===1&&w.saveSlot==='sample'&&w.saved&&Array.isArray(w.objects)?w:null;}catch{return null;}}
const activeSample=loadActiveSample();
export const useWorkspace=create<Store>((set,get)=>{
 function commit(w:Workspace){
  if(w.saveSlot==='sample'&&!get().demoActive){let toast:string|undefined;try{if(w.saved){w={...w,savedAt:now()};localStorage.setItem(SAMPLE_STORAGE_KEY,JSON.stringify(w,encodeWorkspace));localStorage.setItem(SAMPLE_ACTIVE_KEY,'true');}}catch{w={...w,saved:false};toast='Could not save the sample workspace. It remains in this tab.';}set({workspace:w,hasSavedSample:w.saved||get().hasSavedSample,...(toast?{toast}:{})});return;}

  let library={...get().library,[w.domain]:w};let toast:string|null= null;
  if(w.saved){w={...w,savedAt:now()};library={...library,[w.domain]:w};try{if(get().demoActive){localStorage.setItem(DEMO_STORAGE_KEY,JSON.stringify(w,encodeWorkspace));}else{const previous=loadSaved().library;localStorage.setItem(STORAGE_KEY,JSON.stringify({...previous,...Object.fromEntries(Object.entries(library).filter(([,value])=>value?.saved)),_activeDomain:w.domain},encodeWorkspace));}}catch{toast='Storage is full or unavailable. Your latest changes are still in this tab; keep this tab open.';w={...w,saved:false};library={...library,[w.domain]:w};}}
  set({workspace:w,library,...(toast?{toast}:{})});
 }
 return {
 presentation:null,setPresentation:presentation=>set({presentation}),
 demoLearningFocus:null,setDemoLearningFocus:demoLearningFocus=>set({demoLearningFocus}),
 interactionMode:'use',lens:'work',persona:'analyst',demoActive:false,demoPaused:false,demoDraftStage:null,demoFollowCamera:true,hasSavedSample:!!loadActiveSample(false),
 setDemoFollowCamera:demoFollowCamera=>set({demoFollowCamera}),
 setDemoDraftStage:demoDraftStage=>set({demoDraftStage}),
 setAssetView:(stage,reason)=>{const w=get().workspace;if(w.domain!=='accounting'||!w.objects.some(o=>o.kind==='table'))return;const sizes={minimal:[440,260],comparison:[650,350],full:[650,390]} as const;
  const objects=w.objects.map(o=>o.kind!=='table'?o:{...o,configuration:{...o.configuration,assetView:stage},...(o.placementMode==='ai'?{width:sizes[stage][0],height:sizes[stage][1]}:{})});
  commit({...w,objects,events:[...w.events,event(w,'Adapted asset view',reason??`Asset view now uses ${stage} controls. Calculation and policy are unchanged.`,{workerId:'workspace-builder',workerType:'orchestrator',inputs:['table',stage],outputs:['table']})]});},
 setInteractionMode:interactionMode=>set({interactionMode}),setLens:lens=>set({lens,inspector:null}),setPersona:persona=>set({persona}),focusLiveObject:id=>{const object=get().workspace.objects.find(o=>o.id===id||o.kind===id);if(object)set(s=>({lens:'work',focusObjectId:object.id,focusRequest:s.focusRequest+1}));},
 startDemo:()=>{if(!get().demoActive)demoBackup=structuredClone({workspace:get().workspace,library:get().library});set(s=>({workspace:newWorkspace('accounting'),library:{},demoActive:true,demoPaused:false,demoDraftStage:null,demoLearningFocus:null,presentation:null,demoFollowCamera:true,generation:s.generation+1,busy:false,inspector:null,lens:'work',interactionMode:'use',persona:'analyst'}));},
 endDemo:(takeOver=false)=>{const backup=demoBackup;if(takeOver&&backup)sampleOriginBackup=backup;demoBackup=null;set(s=>({workspace:takeOver?{...s.workspace,title:s.workspace.title+' · sample',saveSlot:'sample' as const,sampleOriginDomain:backup?.workspace.domain??s.workspace.sampleOriginDomain??'accounting',saved:false,savedAt:null}:backup?.workspace??s.workspace,library:backup?.library??{},demoActive:false,demoPaused:false,demoDraftStage:null,demoLearningFocus:null,presentation:null,busy:false,generation:s.generation+1,inspector:null,lens:'work',interactionMode:'use',persona:'analyst',toast:takeOver?'Sample workspace is now temporary work in this tab. Keep workspace saves this sample separately from your original investigation.':null}));},
 returnToSavedWork:()=>{try{localStorage.removeItem(SAMPLE_ACTIVE_KEY);}catch{}const saved=loadSaved();const domain=get().workspace.sampleOriginDomain??saved.activeDomain??'accounting';const origin=sampleOriginBackup;sampleOriginBackup=null;set(s=>({workspace:origin?.workspace??saved.library[domain]??newWorkspace(domain),library:origin?.library??saved.library,inspector:null,presentation:null,lens:'work',interactionMode:'use',generation:s.generation+1}));},
 openSavedSample:()=>{const sample=loadActiveSample(false);if(!sample){set({toast:'No saved sample is available yet.'});return;}sampleOriginBackup=structuredClone({workspace:get().workspace,library:get().library});try{localStorage.setItem(SAMPLE_ACTIVE_KEY,'true');}catch{}set(s=>({workspace:sample,inspector:null,presentation:null,lens:'work',interactionMode:'use',generation:s.generation+1}));},
 restoreDemo:()=>{if(!get().demoActive)return;try{const raw=localStorage.getItem(DEMO_STORAGE_KEY);if(!raw)throw Error();const w=JSON.parse(raw,decodeWorkspace) as Workspace;if(w.schemaVersion!==1||!w.saved||!Array.isArray(w.objects))throw Error();set({workspace:w,inspector:null,lens:'work',persona:'colleague',toast:'Reopened the saved sample as an incoming colleague. Demo role only; no authenticated identity.'});}catch{set({toast:'No saved sample is available. Save this sample before reopening.'});}},
 workspace:activeSample||initial.library[initial.activeDomain||'accounting']||newWorkspace('accounting'),library:initial.library,inspector:null,busy:false,activity:'',toast:initial.error||null,dependencies:true,generation:0,focusObjectId:null,focusRequest:0,
 setInspector:inspector=>set({inspector}),notify:toast=>set({toast}),setDependencies:()=>set(s=>({dependencies:!s.dependencies})),
 begin:(domain,prompt,dataset,connections)=>{const token=get().generation+1;let w=newWorkspace(domain);if(get().workspace.saveSlot==='sample'&&!get().demoActive)w={...w,saveSlot:'sample',sampleOriginDomain:get().workspace.sampleOriginDomain,title:w.title+' · sample'};w.prompt=prompt;if(dataset)w.dataset=dataset;if(connections)w.sourceConnections=structuredClone(connections);w=replay(w,'Initial calculation');if(connections)w.events.push(event(w,'Connected sources',connections.map(c=>`${c.kind}: ${c.resource} · ${c.rowCount} rows · ${c.mode}`).join('; '),{inputs:connections.map(c=>c.resource),outputs:[w.dataset.id]}));commit(w);set({generation:token,busy:true,activity:'Understanding your data…',inspector:null,presentation:null});return token;},
 addObject:(kind,token)=>{if(get().generation!==token)return;const w=get().workspace;if(w.objects.some(o=>o.id===kind))return;const o=makeObject(kind,w.domain,w.runs.at(-1)?.id);let title='Created '+o.title.toLowerCase();let detail=`Created a functional ${o.type} object.`;if(kind==='source'){title='Mapped source fields';detail=w.domain==='accounting'?'Validated asset and ledger fields against the demo schema; original rows preserved.':'Mapped equipment IDs, condition, owners, and warranty dates.';}if(kind==='worker'){title='Executed calculation worker';detail=w.domain==='accounting'?'Straight-line computation completed with integer-cent rounding and the active policy.':'Compared warranty dates to 2026-09-30 and evaluated repair status.';}commit({...w,objects:[...w.objects,o],events:[...w.events,event(w,title,detail,{workerId:kind==='worker'?(w.domain==='accounting'?'depreciation-worker':'warranty-worker'):'workspace-builder',workerType:kind==='worker'?'deterministic':'orchestrator',outputs:[kind]})]});},
 setActivity:(activity,token)=>{if(get().generation===token)set({activity});},finish:token=>{if(get().generation===token)set({busy:false,activity:''});},
 updateLayout:objects=>{const w=get().workspace;commit({...w,objects:layoutUpdate(w,objects)});},setViewport:viewport=>{const w=get().workspace,v=w.viewport;if(Math.abs(v.x-viewport.x)<0.001&&Math.abs(v.y-viewport.y)<0.001&&Math.abs(v.zoom-viewport.zoom)<0.00001)return;commit({...w,viewport});},
 openLearning:(rowId,subjectId)=>{
  const w=get().workspace;
  const lens=buildLearning(w,rowId??subjectId);
  const anchor=w.objects.find((object)=>object.id===subjectId)
   ??(rowId?w.objects.find((object)=>object.kind==='table'):undefined)
   ??w.objects.find((object)=>object.kind==='context'||object.kind==='table')
   ??w.objects[0]
   ??makeObject('context',w.domain);
  const current=w.objects.find((object)=>object.kind==='learning');
  const base=makeObject('learning',w.domain,w.runs.at(-1)?.id);
  const width=current?.width??base.width;const height=current?.height??base.height;const mode=current?.placementMode??'ai';
  const position=mode==='ai'?findNearbyPosition(w.objects.filter((object)=>object.id!==current?.id),anchor,{width,height}):current?.position??findNearbyPosition(w.objects,anchor,{width,height});
  const object:CanvasObject={...base,id:current?.id??uid('learning'),width,height,position,zIndex:nextZIndex(w.objects),placementMode:mode,collapsed:false,configuration:{domain:w.domain,...(rowId?{rowId}:{}),subjectId:subjectId??anchor.id},dataRefs:Array.from(new Set([...lens.provenance.sourceRefs,w.dataset.id,`policy-v${w.policy.version}`,...(rowId?[rowId]:[])])),dependencies:[anchor.id]};
  const focus=rowId??subjectId??w.dataset.id;
  const objects=current===undefined?[...w.objects,object]:w.objects.map((item)=>item.id===current.id?object:item);
  commit({...w,objects,events:[...w.events,event(w,'Opened Learning Lens',`${lens.title}: ${lens.explanation[0]??`Context uses ${focus} and active policy v${w.policy.version}.`}`,{workerId:'learning-lens',workerType:'orchestrator',inputs:[...lens.provenance.sourceRefs,focus,`policy-v${w.policy.version}`],outputs:[object.id]})]});
  set({focusObjectId:object.id,focusRequest:get().focusRequest+1});
 },
 explainWorkspace:()=>{
  const w=get().workspace;
  const anchor=w.objects.find((object)=>object.kind==='context')??w.objects.find((object)=>object.kind==='table')??w.objects[0]??makeObject('context',w.domain);
  const overview=buildWorkspaceExplanation(w);
  const current=w.objects.find((item)=>item.kind==='overview');
  const base=makeObject('overview',w.domain,w.runs.at(-1)?.id);const width=current?.width??base.width;const height=current?.height??base.height;const mode=current?.placementMode??'ai';
  const position=mode==='ai'?findNearbyPosition(w.objects.filter((item)=>item.id!==current?.id),anchor,{width,height}):current?.position??findNearbyPosition(w.objects,anchor,{width,height});
  const object:CanvasObject={...base,id:current?.id??uid('overview'),width,height,position,zIndex:nextZIndex(w.objects),placementMode:mode,collapsed:false,configuration:{domain:w.domain,subjectId:anchor.id,datasetId:w.dataset.id,ruleVersion:w.policy.version},dataRefs:[w.dataset.id,`policy-v${w.policy.version}`,...w.runs.slice(-1).map((run)=>run.id)],dependencies:[anchor.id]};
  const eventDetail=`Derived ${overview.activeCapabilities.length} active capabilities, ${overview.attention.length} attention items, and ${overview.recentChanges.length} recent-change entries from current workspace state.`;
  const objects=current===undefined?[...w.objects,object]:w.objects.map((item)=>item.id===current.id?object:item);
  commit({...w,objects,events:[...w.events,event(w,'Explained this workspace',eventDetail,{workerId:'workspace-explainer',workerType:'orchestrator',inputs:[w.dataset.id,`policy-v${w.policy.version}`,...overview.objectRefs],outputs:[object.id]})]});
  set({focusObjectId:object.id,focusRequest:get().focusRequest+1});
 },
 setObjectPlacement:(id,mode)=>{const w=get().workspace;if(!w.objects.some((object)=>object.id===id))return;commit({...w,objects:w.objects.map((object)=>object.id===id?{...object,placementMode:mode,manuallyArranged:mode!=='ai'}:object)});},
 setObjectLayer:(id,direction)=>{const w=get().workspace;const target=w.objects.find((object)=>object.id===id);if(target===undefined)return;const next=direction==='front'?nextZIndex(w.objects):w.objects.reduce((minimum,object,index)=>Math.min(minimum,object.zIndex??index),0)-1;commit({...w,objects:w.objects.map((object)=>object.id===id?{...object,zIndex:next}:object)});},
 toggleWorker:(id)=>{const w=get().workspace;const target=w.objects.find((object)=>object.id===id&&object.kind==='worker');if(target===undefined)return;const expanding=target.collapsed===true;const configuration={...target.configuration};const compactPosition=configuration.compactPosition;const compactSize=configuration.compactSize;if(expanding){configuration.compactPosition={...target.position};configuration.compactSize={width:target.width,height:target.height};}else{delete configuration.compactPosition;delete configuration.compactSize;}
  const mode=target.placementMode??'ai';const position=expanding&&mode==='ai'?findNearbyPosition(w.objects.filter((object)=>object.id!==id),target,{width:target.width,height:EXPANDED_WORKER_HEIGHT}):!expanding&&mode==='ai'&&positionValue(compactPosition)?compactPosition:target.position;const size=!expanding&&sizeValue(compactSize)?compactSize:{width:target.width,height:expanding?EXPANDED_WORKER_HEIGHT:COMPACT_WORKER_HEIGHT};
  commit({...w,objects:w.objects.map((object)=>object.id===id?{...object,position,width:size.width,height:size.height,configuration,collapsed:!expanding,...(expanding?{zIndex:nextZIndex(w.objects)}:{})}:object)});set({focusObjectId:id,focusRequest:get().focusRequest+1});},
 removeContextObject:(id)=>{const w=get().workspace;const target=w.objects.find((object)=>object.id===id);if(target===undefined||!(target.kind==='learning'||target.kind==='overview'))return;commit({...w,objects:w.objects.filter((object)=>object.id!==id)});if(get().focusObjectId===id)set({focusObjectId:null});},
 save:()=>{commit({...get().workspace,saved:true});if(!get().toast?.startsWith('Storage'))set({toast:'Workspace saved on this device. Future changes save automatically.'});},
 switchDomain:domain=>{const current=get().workspace;const library=current.saveSlot==='sample'?get().library:{...get().library,[current.domain]:current};if(!get().demoActive){try{localStorage.removeItem(SAMPLE_ACTIVE_KEY);}catch{}}const w=library[domain]||newWorkspace(domain);set({workspace:w,library,inspector:null,presentation:null,busy:false,activity:'',generation:get().generation+1});},
 reset:()=>{const current=get().workspace;const domain=current.domain;commit({...newWorkspace(domain),...(current.saveSlot==='sample'?{saveSlot:'sample' as const,sampleOriginDomain:current.sampleOriginDomain}:{})});set({inspector:null,presentation:null,busy:false,activity:'',generation:get().generation+1});},
 propose:(input,instruction)=>{const w=get().workspace;const values=[input.defaultThreshold,input.laptop.threshold,input.laptop.usefulLifeMonths];if(values.some(v=>!Number.isFinite(v)||v<0)||!Number.isInteger(input.laptop.usefulLifeMonths)||input.laptop.usefulLifeMonths<1||input.laptop.usefulLifeMonths>600||!['in-service','following-month'].includes(input.laptop.start)){set({toast:'Use non-negative thresholds and a useful life of 1–600 whole months.'});return;}
 const invalidCategory=Object.entries(input.categoryRules??{}).some(([category,rule])=>!['Furniture','Equipment','Vehicle'].includes(category)||!rule||(rule.threshold!==undefined&&(!Number.isFinite(rule.threshold)||rule.threshold<0))||(rule.usefulLifeMonths!==undefined&&(!Number.isInteger(rule.usefulLifeMonths)||rule.usefulLifeMonths<1||rule.usefulLifeMonths>600))||(rule.start!==undefined&&!['in-service','following-month'].includes(rule.start)));if(invalidCategory){set({toast:'Use supported asset types, non-negative thresholds, and whole useful lives from 1 to 600 months.'});return;}
 const candidate={...structuredClone(input),laptop:{...input.laptop},version:Math.max(...w.versions.map(v=>v.version))+1,parentVersion:w.policy.version,createdAt:now(),source:instruction};
 const p:Proposal={id:uid('proposal'),before:structuredClone(w.policy),candidate,instruction,source:'human',status:'proposed',createdAt:now()};
 const objects=[...w.objects];for(const kind of ['proposal','evaluation'] as const){if(objects.some(o=>o.id===kind))continue;const base=makeObject(kind,w.domain);const anchor=kind==='proposal'?(objects.find(o=>o.id==='knowledge')??objects.find(o=>o.kind==='context'||o.kind==='table')):(objects.find(o=>o.id==='proposal')??objects.find(o=>o.id==='knowledge'));const fallback=anchor??makeObject('context',w.domain);objects.push(placedNear(objects,base,fallback));}
 commit({...w,objects,proposals:[...w.proposals,p],activeProposalId:p.id,events:[...w.events,event(w,'Human proposed a reusable rule',instruction,{workerType:'human',workerId:'local-human',humanAction:'propose',outputs:[p.id]})]});set({inspector:{type:'proposal'},toast:'Candidate created. The active policy is unchanged.'});},
 testProposal:()=>{const w=get().workspace;const p=w.proposals.find(p=>p.id===w.activeProposalId);if(!p||!['proposed','tested'].includes(p.status))return;if(p.before.version!==w.policy.version){set({toast:'The policy changed. Create a new proposal against the active version.'});return;}
 const evaluation={...evaluateProposal(w.dataset,p.before,p.candidate),ranAt:now()};const next={...p,evaluation,status:'tested' as const};commit({...w,proposals:w.proposals.map(x=>x.id===p.id?next:x),events:[...w.events,event(w,'Executed regression tests',`${evaluation.passed} passed; ${evaluation.failed} failed; ${evaluation.impacts.length} calculated outputs changed.`,{workerId:'policy-evaluator',inputs:[p.id,w.dataset.id],outputs:[`evaluation:${p.id}`],status:evaluation.failed?'failed':'completed',error:evaluation.failed?'Candidate failed verification':undefined})]});},
 approve:()=>{const w=get().workspace;const p=w.proposals.find(p=>p.id===w.activeProposalId);if(!p||p.status!=='tested'||!p.evaluation||p.evaluation.failed||p.before.version!==w.policy.version){set({toast:'Run passing tests against the current policy before approving.'});return;}
 const approvalRef=uid('approval');const approved={...p,status:'approved' as const,approvalRef};let next={...w,policy:structuredClone(p.candidate),versions:[...w.versions,p.candidate],proposals:w.proposals.map(x=>x.id===p.id?approved:x),events:[...w.events,event(w,'Human approved the rule',`Published policy v${p.candidate.version}.`,{workerType:'human',workerId:'local-human',humanAction:'approve',approvalRef,inputs:[p.id,`evaluation:${p.id}`],outputs:[`policy-v${p.candidate.version}`]})]};next=replay(next,'Replayed affected work',approvalRef,true);commit(next);set({toast:`Policy v${next.policy.version} is live. ${p.evaluation.impacts.length} results recalculated.`});},
 reject:()=>{const w=get().workspace;const p=w.proposals.find(p=>p.id===w.activeProposalId);if(!p||!['proposed','tested'].includes(p.status))return;commit({...w,proposals:w.proposals.map(x=>x.id===p.id?{...x,status:'rejected'}:x),events:[...w.events,event(w,'Proposal rejected','The active policy and calculations are unchanged.',{workerType:'human',humanAction:'reject',status:'rejected',inputs:[p.id]})]});set({toast:'Proposal rejected. Your current policy is unchanged.'});},
 rollback:version=>{const w=get().workspace;const previous=w.versions.find(v=>v.version===version);if(!previous)return;const approvalRef=uid('rollback');const restored={...structuredClone(previous),version:Math.max(...w.versions.map(v=>v.version))+1,parentVersion:w.policy.version,createdAt:now(),source:`Restore policy v${version}`};const next={...w,policy:restored,versions:[...w.versions,restored],events:[...w.events,event(w,`Restored the behavior of v${version}`,`Human approved rollback; preserved as new version v${restored.version}.`,{workerType:'human',humanAction:'rollback',approvalRef})]};commit(replay(next,'Recalculated after rollback',approvalRef,true));set({toast:`Version ${version} restored as v${restored.version}. History retained.`});},
 correctAsset:(rowId,patch,note)=>{const w=get().workspace;const matches=w.dataset.assets.filter(a=>a.rowId===rowId);if(matches.length!==1){set({toast:'This row identifier is ambiguous. Correct the source CSV identifiers and import again; no records were changed.'});return;}const asset=matches[0];const nextAsset={...asset,...patch,rowId:asset.rowId,assetId:asset.assetId};if([nextAsset.cost,nextAsset.recordedMonthlyDepreciation,nextAsset.accumulatedDepreciation].some(v=>!Number.isFinite(v)||v<0)){set({toast:'Amounts must be non-negative numbers.'});return;}
 const dataset={...w.dataset,assets:w.dataset.assets.map(a=>a.rowId===rowId?nextAsset:a)};const next={...invalidateTests(w),dataset,events:[...w.events,event(w,'Corrected one source record',`${asset.assetId}: ${Object.keys(patch).join(', ')}. Reusable policy unchanged.${note?.trim()?' Note: '+note.trim():''}`,{workerType:'human',workerId:'local-human',humanAction:'case-correction',inputs:[rowId],outputs:[rowId]})]};commit(replay(next,'Recalculated after record correction',undefined,true));set({toast:'Source record updated. Reusable policy unchanged. Pending tests must be rerun.'});},
 nextMonth:()=>{const w=get().workspace;if(w.dataset.source==='imported'){set({toast:'Import the next period’s asset register and ledger to run your own monthly data.'});return;}const [year,month]=w.dataset.period.split('-').map(Number);const period=`${month===12?year+1:year}-${String(month===12?1:month+1).padStart(2,'0')}`;commit(replay({...invalidateTests(w),dataset:createDataset(period),sourceConnections:undefined},`Monthly replay · ${period}`));set({toast:`Loaded synthetic data for ${period}. Your approved rules were reused.`});},
 setHideMatched:hideMatched=>commit({...get().workspace,preferences:{hideMatched}}),
 handoffAction:(rowId,action,owner)=>{let w=get().workspace;if(!w.result.rows.some(r=>r.asset.rowId===rowId)){set({toast:'The source row is not present in the active dataset. Reopen its historical run to inspect it.'});return;}const existing=w.handoffs.find(h=>h.rowId===rowId&&(!h.datasetId||h.datasetId===w.dataset.id))||{rowId,owner:'Finance manager',status:'waiting' as const,attempts:[]};if(action==='retry'||action==='resolve')w=replay(w,'Retried incomplete calculation');const row=w.result.rows.find(r=>r.asset.rowId===rowId);const blocked=Boolean(row?.findings.length);const status=action==='reject'?'rejected':action==='continue'?'in-progress':blocked?'waiting':'resolved';const h={...existing,datasetId:w.dataset.id,runId:w.runs.at(-1)?.id,owner:owner?.trim()||existing.owner,status:status as 'waiting'|'in-progress'|'resolved'|'rejected',attempts:[...existing.attempts,`${now()} · ${action}: ${blocked?'source evidence still needs review':'verification passed'}`]};commit({...w,handoffs:[...w.handoffs.filter(h=>h.rowId!==rowId||(h.datasetId!==undefined&&h.datasetId!==w.dataset.id)),h],events:[...w.events,event(w,`Handoff ${action}`,`${row?.asset.assetId}: ${h.status}; owner ${h.owner}.`,{workerType:'human',humanAction:action,status:blocked&&action!=='reject'?'needs-input':'completed',inputs:[rowId]})]});set({toast:blocked&&action==='resolve'?'Still needs review. Correct the evidence before resolving.':`Handoff ${h.status}. Context preserved.`});},
 addIncident:(equipmentId,description,reporter)=>{const w=get().workspace;if(!description.trim()||!reporter.trim()||!w.equipment.some(e=>e.id===equipmentId))return;const incident={id:uid('incident'),equipmentId,description:description.trim(),reporter:reporter.trim(),createdAt:now(),status:'open' as const};commit(replay({...w,incidents:[...w.incidents,incident],equipment:w.equipment.map(e=>e.id===equipmentId?{...e,condition:'needs-repair'}:e),events:[...w.events,event(w,'Incident reported',`${equipmentId}: ${description}`,{workerType:'human',workerId:'incident-intake',humanAction:'report',inputs:[equipmentId],outputs:[incident.id]})]},'Re-evaluated equipment after incident',undefined,true));set({toast:'Issue recorded. Maintenance priorities updated.'});},
 setEquipmentCondition:(id,condition)=>{const w=get().workspace;commit(replay({...w,equipment:w.equipment.map(e=>e.id===id?{...e,condition}:e),incidents:w.incidents.map(i=>i.equipmentId===id&&condition==='working'?{...i,status:'resolved'}:i),events:[...w.events,event(w,'Equipment status updated',`${id} → ${condition}`,{workerType:'human',workerId:'maintenance-owner',humanAction:'update',inputs:[id],outputs:['maintenance-priorities']})]},'Re-evaluated equipment after status change',undefined,true));},
 };
});
export const activeProposal=(w:Workspace)=>w.proposals.find(p=>p.id===w.activeProposalId);

