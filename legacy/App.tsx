import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ReactFlow, ReactFlowProvider, Background, BackgroundVariant, useReactFlow, type NodeChange, type ReactFlowProps } from '@xyflow/react';
import { ArrowDownToLine, ArrowRight, ArrowUp, ArrowUpRight, Camera, CameraOff, Check, ChevronDown, CircleHelp, CornerDownLeft, FileSpreadsheet, Focus, GitBranch, Hand, History, LayoutGrid, LoaderCircle, Maximize2, Minus, MousePointer2, Paperclip, Plus, RotateCcw, Save, Sparkles, Wrench, X, Eye, BookOpen, Pin, Layers, Grid2X2 } from 'lucide-react';
import CanvasCard, { periodName } from './components/CanvasCard';
import Inspector from './components/Inspector';
import KnowledgeConstellation from './components/KnowledgeConstellation';
import DemoPlayer from './components/DemoPlayer';
import ConnectionsPanel, { type ConnectionDraft } from './components/ConnectionsPanel';
import { loadDemoDatabase, loadDemoWorkbook, readLedgerWorkbook, type SourceConnection } from './domain/connections';
import { ACCOUNTING_PROMPT, MAINTENANCE_PROMPT, activeProposal, useWorkspace } from './state/store';
import type { Domain, DraftImport } from './state/types';
import { OBJECT_SEQUENCE } from './state/objects';
import { parseAssetCSV, parseLedgerCSV } from './domain/csv';
import type { Dataset } from './domain/types';
import { presentedObjects, type StageBounds } from './state/presentation';
import { routeConnections } from '../src/tabletop/shared/edge-routing';
import CanvasEdge from '../src/tabletop/ui/CanvasEdge';
import {useRenderedBounds} from './components/useRenderedBounds';
import TrioExperience, {type TrioController} from './trio/TrioExperience';
import {TrioDemoPicker,TrioDemoControls} from './trio/TrioDemoControls';
import {useTrioCanvas,trioNodeTypes} from './trio/TrioCanvas';
import TrioConstellation from './trio/TrioConstellation';
import TrioManualDock from './trio/TrioManualDock';
import type {StoryStep} from './trio/types';
import { canvasObjectCount, canvasObjectForStep } from './trio/narrativeFocus';
import './trio/canvas-restoration.css';
import { componentLabNodeTypes, localLabAvailable, useComponentLab } from './lab/useComponentLab';
const nodeTypes={canvasObject:CanvasCard,...trioNodeTypes,...componentLabNodeTypes};
const edgeTypes={canvasConnection:CanvasEdge};
function relationLabel(source:string,target:string):string{
 if(target==='worker')return source==='knowledge'?'ใช้กฎ':'อ่านข้อมูล';
 if(target==='table')return 'ผลคำนวณ';
 if(target==='dashboard')return 'สรุปยอด';
 if(target==='exceptions')return 'รายการตรวจ';
 if(target==='proposal')return 'ร่างจากกฎเดิม';
 if(target==='evaluation')return source==='proposal'?'ทดสอบข้อเสนอ':'ข้อมูลทดสอบ';
 if(target==='learning')return 'อธิบายผล';
 if(target==='overview')return 'บริบทงาน';
 return 'ข้อมูลที่เกี่ยวข้อง';
}
const wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
const emptyConnections=():ConnectionDraft=>({database:null,workbook:null});
function measureStage(canvas:HTMLDivElement|null,withInspector:boolean):StageBounds{
 const area=canvas?.getBoundingClientRect()??{left:0,top:76,width:innerWidth,height:innerHeight-260,bottom:innerHeight-184};
 const box=(selector:string)=>{const el=document.querySelector<HTMLElement>(selector);return el&&getComputedStyle(el).display!=='none'?el.getBoundingClientRect():null;};
 const toolbar=box('.canvas-toolbar'),caption=box('.canvas-caption'),dock=box('.demo-player')??box('.prompt-area'),inspector=box('.inspector');
 const left=Math.max(area.left+16,toolbar&&toolbar.width?toolbar.right+14:area.left+16);
 const top=Math.max(area.top+20,caption&&caption.height?caption.bottom+18:area.top+20);
 const right=withInspector&&innerWidth>760?Math.min(area.left+area.width-18,inspector?.left??innerWidth-470):area.left+area.width-18;
 const bottom=Math.min(area.bottom-14,dock?dock.top-16:area.bottom-14);
 return {left:left-area.left,top:top-area.top,width:Math.max(230,right-left),height:Math.max(160,bottom-top)};
}
export default function App(){return new URLSearchParams(location.search).get('legacy')==='1'?<ReactFlowProvider><WorkspaceApp/></ReactFlowProvider>:<TrioExperience renderWorkspace={trio=><ReactFlowProvider><WorkspaceApp trio={trio}/></ReactFlowProvider>}/>;}
function WorkspaceApp({trio}:{trio?:TrioController}){
 const state=useWorkspace();const w=state.workspace;const flow=useReactFlow();
 const [selected,setSelected]=useState<string|null>(null);const [hand,setHand]=useState(false);const [snap,setSnap]=useState(false);const [menu,setMenu]=useState(false);const [resetConfirm,setResetConfirm]=useState(false);
 const [prompt,setPrompt]=useState('');const [draft,setDraft]=useState<DraftImport>({});const [dragging,setDragging]=useState(false);const [zoom,setZoom]=useState(1);
 const [demoPickerOpen,setDemoPickerOpen]=useState(false);
 const openLabContext=useCallback(()=>{trio?.takeOver();state.setLens('work');state.setInteractionMode('use');setTrioFollow(false);},[trio?.takeOver,state.setLens,state.setInteractionMode]);
 const lab=useComponentLab({visible:state.lens==='work'&&state.interactionMode==='use',onOpen:openLabContext,seedBpm:trio?.snapshot?.caseId==='music'?trio.snapshot.active.music.chorusBpm:100});
 const trioActive=Boolean(trio?.snapshot&&trio.stageProps);
 const [trioFollow,setTrioFollow]=useState(true),[trioFocus,setTrioFocus]=useState<StoryStep|null>(null),[trioFocusVersion,setTrioFocusVersion]=useState(0);
 const focusObject=useCallback((step:StoryStep|null)=>{const snapshot=trio?.snapshot;if(!step||!snapshot)return step;return canvasObjectForStep(snapshot.caseId,step,Boolean(snapshot.caseId==='quest'&&snapshot.active.quest.encounter));},[trio?.snapshot]);
 const focusTrio=(step:StoryStep|null=null)=>{state.setLens('work');setTrioFollow(true);setTrioFocus(focusObject(step));setTrioFocusVersion(v=>v+1);};
 const inspectTrio=useCallback((step?:StoryStep)=>{trio?.stageProps?.onInspect?.(step);if(step!==undefined){state.setLens('work');setTrioFollow(true);setTrioFocus(focusObject(step));setTrioFocusVersion(value=>value+1);}else if(trioFollow){state.setLens('work');setTrioFocus(null);setTrioFocusVersion(value=>value+1);}},[trio?.stageProps?.onInspect,trioFollow,state.setLens,focusObject]);
 const showTrioKnowledge=()=>{if(trio?.player.guided&&!trio.player.paused&&trio.player.phase!=='complete')trio.togglePause();state.setLens('constellation');};
 useEffect(()=>{if(trioActive){state.setLens('work');state.setInspector(null);state.setInteractionMode('use');setHand(false);setTrioFollow(true);setTrioFocus(null);}},[trio?.surfaceSession]);
 useEffect(()=>{setTrioFocus(null);},[trio?.player.step]);
 useEffect(()=>{if(!trio?.player.paused)setTrioFocus(null);},[trio?.player.paused]);
 const wasTrio=useRef(false);
 useEffect(()=>{const active=Boolean(trio?.snapshot);if(wasTrio.current&&!active)void flow.setViewport(useWorkspace.getState().workspace.viewport,{duration:0});wasTrio.current=active;},[Boolean(trio?.snapshot),flow]);
 const [connections,setConnections]=useState<ConnectionDraft>(emptyConnections);
 const connectionsRef=useRef(connections),sourceRequest=useRef(0),sourcesBeforeDemo=useRef<ConnectionDraft|null>(null);
 const [sourcePanel,setSourcePanel]=useState<'database'|'excel'|'ready'|null>(null),[sourceBusy,setSourceBusy]=useState(false),[sourceError,setSourceError]=useState<string|null>(null);
 const updateConnections=(next:ConnectionDraft)=>{connectionsRef.current=next;setConnections(next);};
 const closeSources=()=>{sourceRequest.current++;setSourcePanel(null);setSourceBusy(false);setSourceError(null);};
 const connectedData=()=>{
  const {database,workbook}=connectionsRef.current;if(!database||!workbook||database.connection.period!==workbook.connection.period)return undefined;
  return {dataset:{id:workbook.connection.id==='local-ledger-workbook'?`connected-${Date.now()}`:'northstar-2026-09',name:workbook.connection.id==='local-ledger-workbook'?'Demo assets + selected local ledger':'Northstar · database snapshot + Excel',period:workbook.ledger[0].period,assets:database.assets,ledger:workbook.ledger,source:workbook.connection.id==='local-ledger-workbook'?'imported' as const:'synthetic' as const},connections:[database.connection,workbook.connection]};
 };
 async function connectSources(kind:'database'|'excel'|'ready'){
  const request=++sourceRequest.current,guided=useWorkspace.getState().demoActive;
  setSourcePanel(kind);setSourceError(null);setSourceBusy(kind!=='ready');
  try{
   if(kind==='ready'){if(!connectedData())throw Error('เชื่อมทะเบียนและ Excel ให้ครบก่อน');return;}
   const result=kind==='database'?await loadDemoDatabase():await loadDemoWorkbook();
   if(request!==sourceRequest.current||(guided&&!useWorkspace.getState().demoActive))return;
   updateConnections({...connectionsRef.current,...(kind==='database'?{database:result as Awaited<ReturnType<typeof loadDemoDatabase>>}:{workbook:result as Awaited<ReturnType<typeof loadDemoWorkbook>>})});
  }catch(e){if(request===sourceRequest.current){setSourceError(e instanceof Error?e.message:'อ่านข้อมูลไม่ได้');throw e;}}
  finally{if(request===sourceRequest.current)setSourceBusy(false);}
 }
 async function prepareDemoSources(){
  const request=++sourceRequest.current,generation=useWorkspace.getState().generation;setSourceError(null);
  const [database,workbook]=await Promise.all([loadDemoDatabase(),loadDemoWorkbook()]);
  if(request!==sourceRequest.current||!useWorkspace.getState().demoActive||generation!==useWorkspace.getState().generation)return;
  if(database.connection.period!==workbook.connection.period)throw Error('เดือนทะเบียนและ Excel ไม่ตรงกัน');
  updateConnections({database,workbook});
 }
 async function readWorkbook(file:File){
  const request=++sourceRequest.current;setSourceBusy(true);setSourceError(null);
  try{if(file.size>5_000_000)throw Error('เลือกไฟล์ Excel ไม่เกิน 5 MB');const ledger=await readLedgerWorkbook(file);const expected=connectionsRef.current.database?.connection.period;if(!expected||ledger[0].period!==expected)throw Error(`เดือนใน Excel (${ledger[0].period}) ไม่ตรงกับทะเบียนตัวอย่าง (${expected??'ยังไม่เชื่อม'}) เลือก Excel เดือนเดียวกับทะเบียน`);if(request!==sourceRequest.current||useWorkspace.getState().demoActive)return;
   updateConnections({...connectionsRef.current,workbook:{ledger,connection:{id:'local-ledger-workbook',kind:'excel',name:'Selected local workbook',resource:`${file.name} · GL postings`,rowCount:ledger.length,period:ledger[0].period,fields:['id','assetId','period','account','amount'].map(field=>({source:field,target:field})),mode:'local-file'}}});
  }catch(e){if(request===sourceRequest.current)setSourceError(e instanceof Error?e.message:'อ่าน Excel ไม่ได้');}finally{if(request===sourceRequest.current)setSourceBusy(false);}
 }
 const fileRef=useRef<HTMLInputElement>(null);const canvasRef=useRef<HTMLDivElement>(null);const importedBeforeDemo=useRef<DraftImport|null>(null);
 const trioCanvas=useTrioCanvas(trioActive&&trio?.stageProps?{...trio.stageProps,lens:state.lens,onInspect:inspectTrio,interactionMode:state.interactionMode,hand,snap,dependencies:state.dependencies,followCamera:trioFollow,onManualPan:()=>setTrioFollow(false),focusStep:trioFocus,focusVersion:trioFocusVersion,onViewportChange:setZoom,onLayoutChange:trio.onCanvasLayoutChange}:null,canvasRef);
 const {canvasProps:trioCanvasProps,children:trioPanels,...trioFlow}=trioCanvas;
 // The active adapter controls its own complete node set; inactive returns no overrides.
 const trioFlowProps=trioFlow as ReactFlowProps;
 const [stageBounds,setStageBounds]=useState<StageBounds>({left:64,top:40,width:Math.max(240,innerWidth-100),height:Math.max(180,innerHeight-310)});
 const [dockHeight,setDockHeight]=useState(180);
 useLayoutEffect(()=>{
  const measure=()=>{const next=measureStage(canvasRef.current,!!useWorkspace.getState().inspector);setStageBounds(prior=>Object.keys(next).every(k=>Math.abs(prior[k as keyof StageBounds]-next[k as keyof StageBounds])<1)?prior:next);const height=document.querySelector('.demo-player')?.getBoundingClientRect().height;if(height)setDockHeight(height);};
  measure();const observer=new ResizeObserver(measure);for(const selector of ['.canvas-area','.demo-player','.inspector','.workspace-bar']){const el=document.querySelector(selector);if(el)observer.observe(el);}window.addEventListener('resize',measure);return()=>{observer.disconnect();window.removeEventListener('resize',measure);};
 },[state.demoActive,state.inspector?.type,trioActive,trio?.player.guided]);
 const startGuided=()=>{if(trio){setDemoPickerOpen(true);return;}importedBeforeDemo.current=structuredClone(draft);sourcesBeforeDemo.current=structuredClone(connectionsRef.current);closeSources();updateConnections(emptyConnections());setDraft({});setPrompt('');state.startDemo();};
 useEffect(()=>{if(!state.demoActive&&sourcesBeforeDemo.current){closeSources();updateConnections(sourcesBeforeDemo.current);sourcesBeforeDemo.current=null;}},[state.demoActive]);
 useEffect(()=>{if(!state.demoActive&&importedBeforeDemo.current){setDraft(importedBeforeDemo.current);importedBeforeDemo.current=null;}},[state.demoActive]);const priorDomain=useRef(w.domain);const ready=w.objects.length>0||trioActive||lab.open;const p=activeProposal(w);
 const fit=useCallback(()=>{if(trioActive)setTrioFollow(false);flow.fitView({padding:0.07,minZoom:0.25,maxZoom:1,duration:450});},[flow,trioActive]);
 const displayObjects=useMemo(()=>presentedObjects(w.objects,state.presentation,w.domain,stageBounds,state.demoActive),[w.objects,state.presentation,w.domain,stageBounds,state.demoActive]);
 const nodes=useMemo(()=>displayObjects.map(object=>({id:object.id,type:'canvasObject',position:object.position,data:{object},className:state.presentation&&!state.presentation.ids.some(id=>id===object.id||id===object.kind)?'presentation-context':'',style:{width:object.width,height:object.height},zIndex:object.zIndex??0,draggable:state.interactionMode==='arrange'&&object.placementMode!=='pinned'&&!hand,selected:selected===object.id,dragHandle:'.card-drag-handle',connectable:false,deletable:false})),[displayObjects,selected,hand,state.interactionMode,state.demoActive,state.presentation]);
 const selectedObject=w.objects.find(o=>o.id===selected);
 const focusObjects=useCallback(async(ids:string[],withInspector=false)=>{
 const current=useWorkspace.getState(),stage=measureStage(canvasRef.current,withInspector||!!current.inspector);setStageBounds(stage);
  let objects=presentedObjects(current.workspace.objects,current.presentation,current.workspace.domain,stage,current.demoActive).filter(o=>ids.includes(o.id)||ids.includes(o.kind));if(!objects.length)return;
  const latest=ids.at(-1);setSelected((objects.find(o=>o.id===latest||o.kind===latest)??objects.at(-1)!).id);
  const availableWidth=stage.width,availableHeight=stage.height,padding=12;
  const bounds=()=>{const left=Math.min(...objects.map(o=>o.position.x)),top=Math.min(...objects.map(o=>o.position.y));return {left,top,width:Math.max(...objects.map(o=>o.position.x+o.width))-left,height:Math.max(...objects.map(o=>o.position.y+o.height))-top};};
  let target=bounds();
  const scale=()=>Math.min(1.05,(availableWidth-2*padding)/target.width,(availableHeight-2*padding)/target.height);
  if(scale()<0.8&&objects.length>1){const latest=ids.at(-1);objects=[objects.find(o=>o.id===latest||o.kind===latest)??objects.at(-1)!];target=bounds();}
  const zoom=Math.max(0.25,scale()),duration=window.matchMedia('(prefers-reduced-motion: reduce)').matches?0:550;
  const next={x:stage.left+(availableWidth-target.width*zoom)/2-target.left*zoom,y:stage.top+(availableHeight-target.height*zoom)/2-target.top*zoom,zoom};
  const prior=flow.getViewport();if(Math.abs(next.x-prior.x)<1&&Math.abs(next.y-prior.y)<1&&Math.abs(next.zoom-prior.zoom)<.005)return;
  await flow.setViewport(next,{duration});
 },[flow]);
 useEffect(()=>{
  let timer:ReturnType<typeof setTimeout>|undefined;
  const refocus=()=>{clearTimeout(timer);timer=setTimeout(()=>{const current=useWorkspace.getState();if(current.demoActive&&current.demoFollowCamera&&current.presentation?.ids.length)void focusObjects(current.presentation.ids,!!current.inspector);},120);};
  window.addEventListener('resize',refocus);return()=>{clearTimeout(timer);window.removeEventListener('resize',refocus);};
 },[focusObjects]);
 const priorDemo=useRef(state.demoActive);
 useEffect(()=>{if(priorDemo.current!==state.demoActive){priorDemo.current=state.demoActive;void flow.setViewport(useWorkspace.getState().workspace.viewport,{duration:0});setSelected(null);}},[state.demoActive,flow]);
 useEffect(()=>{if(!state.focusObjectId||(state.demoActive&&(!state.demoFollowCamera||state.presentation?.phase!=='settled')))return;setSelected(state.focusObjectId);const timer=setTimeout(()=>{const current=useWorkspace.getState();if(!current.demoActive||current.demoFollowCamera)focusObjects([state.focusObjectId!]);},100);return()=>clearTimeout(timer);},[state.focusRequest,state.demoActive]);
 const connectionLinks=useMemo(()=>displayObjects.flatMap(object=>object.dependencies.flatMap(source=>{
  const from=displayObjects.find(other=>other.id===source);
  return from?[{id:source+'-'+object.id,source,target:object.id,label:relationLabel(from.kind,object.kind)}]:[];
 })),[displayObjects]);
 const renderedBounds=useRenderedBounds(canvasRef,displayObjects);
 const obstacleBounds=useMemo(()=>renderedBounds.map(rect=>{
  const target=displayObjects.find(object=>object.id===rect.id)!;
  const x=Math.min(rect.x,target.position.x),y=Math.min(rect.y,target.position.y);
  return {id:rect.id,x,y,width:Math.max(rect.x+rect.width,target.position.x+target.width)-x,height:Math.max(rect.y+rect.height,target.position.y+target.height)-y};
 }),[renderedBounds,displayObjects]);
 const routes=useMemo(()=>routeConnections(renderedBounds,connectionLinks,{obstacleBounds}),[renderedBounds,connectionLinks,obstacleBounds]);
 const edges=useMemo(()=>state.dependencies||state.demoActive?routes.map(route=>{
  const link=connectionLinks.find(item=>item.id===route.id)!;
  const target=displayObjects.find(object=>object.id===link.target);
  const active=!!state.presentation?.ids.some(id=>id===target?.id||id===target?.kind);
  return {...link,type:'canvasConnection',sourceHandle:route.sourceHandleId,targetHandle:route.targetHandleId,hidden:route.hidden,data:{route,active,dimmed:state.demoActive&&!active,moving:active&&state.presentation?.phase!=='settled'&&!state.demoPaused}};
 }):[],[state.dependencies,state.demoActive,state.demoPaused,state.presentation,displayObjects,connectionLinks,routes]);
 useEffect(()=>{if(!state.toast)return;const timer=setTimeout(()=>useWorkspace.setState({toast:null}),6500);return()=>clearTimeout(timer);},[state.toast]);
 useEffect(()=>{if(priorDomain.current!==w.domain){priorDomain.current=w.domain;setPrompt('');setSelected(null);setDraft({});if(w.objects.length)setTimeout(()=>flow.setViewport(w.viewport),100);}},[w.domain,w.objects.length,w.viewport,flow]);
 useEffect(()=>{if(w.saved&&w.objects.length)setTimeout(()=>flow.setViewport(w.viewport),150);},[]); // Restore once, preserving the saved camera.
 useEffect(()=>{if(!p||p.status!=='proposed'||state.demoActive)return;const timer=setTimeout(()=>focusObjects(['proposal','evaluation'],true),120);return()=>clearTimeout(timer);},[p?.id]);
 useEffect(()=>{if(p?.status!=='approved'||state.demoActive)return;state.setInspector(null);const timer=setTimeout(()=>flow.fitView({nodes:w.objects.filter(o=>!['proposal','evaluation'].includes(o.kind)).map(o=>({id:o.id})),padding:.07,maxZoom:1,duration:700}),80);return()=>clearTimeout(timer);},[p?.status]);
 useEffect(()=>{const handler=(e:KeyboardEvent)=>{if((e.target as HTMLElement)?.closest('input,textarea,select'))return;if(e.key.toLowerCase()==='f')fit();if(e.key==='Escape')state.setInspector(null);if(e.key==='+'||e.key==='=')flow.zoomIn({duration:200});if(e.key==='-')flow.zoomOut({duration:200});};window.addEventListener('keydown',handler);return()=>window.removeEventListener('keydown',handler);},[fit,flow,state.setInspector]);
 const onNodesChange=useCallback((changes:NodeChange[])=>{if(useWorkspace.getState().interactionMode!=='arrange')return;const meaningful=changes.filter(c=>c.type==='position'||c.type==='dimensions');if(!meaningful.length)return;const current=useWorkspace.getState().workspace.objects;let changed=false;const next=current.map(o=>{let n=o;for(const c of meaningful){if(c.id!==o.id||o.placementMode==='pinned')continue;if(c.type==='position'&&c.position&&(c.position.x!==n.position.x||c.position.y!==n.position.y)){n={...n,position:c.position,manuallyArranged:true,placementMode:'user'};changed=true;}if(c.type==='dimensions'&&c.dimensions&&c.resizing){n={...n,width:c.dimensions.width,height:c.dimensions.height,manuallyArranged:true,placementMode:'user'};changed=true;}}return n;});if(changed)useWorkspace.getState().updateLayout(next);},[]);
 async function run(domain:Domain,text?:string,connected?:{dataset:Dataset;connections:SourceConnection[]}){
  if(state.busy)return;let dataset:Dataset|undefined;
  if(!connected&&domain==='accounting'&&!useWorkspace.getState().demoActive&&(draft.assets||draft.ledger)){if(!draft.assets||!draft.ledger){state.notify('Add both an asset register CSV and a general ledger CSV before starting, or clear the import to use demo data.');return;}dataset={id:`import-${Date.now()}`,name:'Local imported records',period:draft.period!,assets:draft.assets,ledger:draft.ledger,source:'imported'};}
  const token=state.begin(domain,text?.trim()||(domain==='accounting'?ACCOUNTING_PROMPT:MAINTENANCE_PROMPT),connected?.dataset??dataset,connected?.connections);setPrompt('');setSelected(null);
  const steps=domain==='accounting'?OBJECT_SEQUENCE:[...OBJECT_SEQUENCE.filter(x=>x!=='knowledge'),'intake'] as typeof OBJECT_SEQUENCE;
  const activities=domain==='accounting'?['Understanding your question…','Found an asset register and general ledger.','Creating depreciation validation.','Building your investigation view.','Turning the results into a live overview.','Bringing the exceptions into focus.','Your workspace is ready. Make it yours.']:['Understanding your question…','Reading the equipment inventory.','Checking warranty dates and condition.','Creating an equipment workspace.','Summarizing maintenance priorities.','Highlighting equipment that needs attention.','Adding an incident intake form.'];
  for(let i=0;i<steps.length;i++){
   if(useWorkspace.getState().generation!==token)return;const id=Date.now()+i;state.setActivity(activities[i],token);state.setPresentation({id,ids:[steps[i]],label:activities[i],phase:'skeleton'});await wait(80);
   if(useWorkspace.getState().generation!==token)return;await focusObjects([steps[i]]);await wait(320);
   if(useWorkspace.getState().generation!==token)return;state.addObject(steps[i],token);state.setPresentation({id,ids:[steps[i]],label:activities[i],phase:'compose'});await wait(520);
   if(useWorkspace.getState().generation!==token)return;state.setPresentation({id,ids:[steps[i]],label:activities[i],phase:'settled'});await wait(250);
  }
  if(useWorkspace.getState().generation!==token)return;state.finish(token);state.setPresentation(null);setTimeout(fit,150);
 }
 function submitPrompt(){
  if(!prompt.trim())return;
  if(ready){if(/constellation|กลุ่มดาว|ความรู้/i.test(prompt)){state.setLens('constellation');setPrompt('');return;}if(/ทำไม|why|explain/i.test(prompt)){const requested=prompt.match(/FA-\d+/i)?.[0];const row=requested?w.result.rows.find(r=>r.asset.assetId.toLowerCase()===requested.toLowerCase()):undefined;if(requested&&!row){state.notify('No matching asset exists in the active dataset. Search the asset list or open recorded history.');return;}state.openLearning(row?.asset.rowId,selected||'table');setPrompt('');return;}if(/หน้ารวม|หน้ารายการ|asset list/i.test(prompt)){state.focusLiveObject('table');setPrompt('');return;}if(/laptop|แล็ปท็อป|สินทรัพย์|ค่าเสื่อม|rule|policy|กฎ|ประเภท|ตั้งค่า|settings/i.test(prompt)){state.setInspector({type:'teach',instruction:prompt});state.notify('Review the scope and policy values before creating a change proposal.');}else if(/maintenance|equipment|อุปกรณ์|ซ่อม/i.test(prompt)){state.switchDomain('maintenance');}else{state.setInspector({type:'help'});state.notify('Demo mode supports the accounting and equipment scenarios shown here.');}return;}
  if(/maintenance|equipment|อุปกรณ์|ซ่อม|ประกัน/i.test(prompt)){run('maintenance',prompt);return;}
  if(/asset|depreciation|ledger|account|ค่าเสื่อม|สินทรัพย์|บัญชี/i.test(prompt)||draft.assets){run('accounting',prompt);return;}
  state.notify('This local demo understands accounting and equipment maintenance. Choose a scenario below to begin.');
 }
 async function importFiles(files:FileList|File[]){
  if(useWorkspace.getState().demoActive){state.notify('Guided demo uses only its fictional seed. Close it or take over before importing your own data.');return;}
  if(ready){state.notify('Start a new workspace before importing another dataset.');return;}
  let next={...draft};try{for(const file of Array.from(files)){if(!file.name.toLowerCase().endsWith('.csv'))throw new Error('Use the supplied CSV schema. For Excel, use Connect database or Excel. PDF is not supported.');if(file.size>2_000_000)throw new Error('Each CSV must be smaller than 2 MB.');const text=await file.text();const first=text.split(/\r?\n/)[0];if(first.includes('inServiceDate')){next={...next,assets:parseAssetCSV(text),assetFilename:file.name};}else if(first.includes('period')&&first.includes('amount')){const ledger=parseLedgerCSV(text);const periods=[...new Set(ledger.map(l=>l.period))];if(periods.length!==1)throw new Error('The ledger CSV must contain exactly one reporting period.');next={...next,ledger,ledgerFilename:file.name,period:periods[0]};}else throw new Error('CSV columns do not match the asset or general ledger schema. Download the sample files for column names.');}setDraft(next);state.notify('CSV validated. Add both files, then start the accounting workspace.');}catch(error){state.notify(error instanceof Error?error.message:'Unable to read this file.');}
 }
 const priorCalculation=useRef({id:w.runs.at(-1)?.id,domain:w.domain,datasetId:w.dataset.id,demo:state.demoActive});
 useEffect(()=>{const previous=priorCalculation.current,id=w.runs.at(-1)?.id;priorCalculation.current={id,domain:w.domain,datasetId:w.dataset.id,demo:state.demoActive};if(!id||previous.id===id||!previous.id||previous.demo!==state.demoActive||previous.domain!==w.domain||previous.datasetId!==w.dataset.id||state.demoActive||state.busy||!w.objects.length)return;
  const pulseId=Date.now();state.setPresentation({id:pulseId,ids:['table','dashboard','exceptions'],label:'อัปเดตผลจากรอบคำนวณใหม่',phase:'compose'});const timer=setTimeout(()=>{if(useWorkspace.getState().presentation?.id===pulseId)useWorkspace.getState().setPresentation(null);},1600);return()=>clearTimeout(timer);
 },[w.runs.at(-1)?.id,state.demoActive]);
 const step=!ready?0:p?.status==='approved'?3:p?2:1;
 return <main data-presentation-phase={state.presentation?.phase} className={`app ${trioActive?'canvas-demo':''} ${ready?'has-work':'is-empty'} ${state.inspector&&!trioActive?'has-inspector':''} mode-${state.interactionMode} ${state.lens==='constellation'?'is-constellation':''} ${state.demoActive||(trioActive&&trio?.player.guided)?'is-guided-demo':''} ${state.presentation?'is-presenting':''}`} style={{'--demo-dock-height':`${dockHeight}px`} as CSSProperties} onDragOver={e=>{if(e.dataTransfer.types.includes('Files')){e.preventDefault();setDragging(true);}}} onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget as HTMLElement))setDragging(false);}} onDrop={e=>{e.preventDefault();setDragging(false);importFiles(e.dataTransfer.files);}}>
  <header className="workspace-bar">
   <div className="brand"><div className="brand-symbol"><i/><i/><i/><i/></div><span>procedural<span className="brand-period">.</span></span></div><span className="bar-separator"/>
   <div className="workspace-switcher"><button onClick={()=>setMenu(!menu)}>{lab.open?'สร้างเครื่องมือใหม่':trioActive?trio?.story?.title:ready?w.title:'Untitled workspace'}<ChevronDown size={13}/></button>{menu&&<><button className="menu-dismiss" aria-label="Close workspace menu" onClick={()=>setMenu(false)}/><div className="workspace-menu"><span className="eyebrow">YOUR WORKSPACES</span>{trioActive&&<button onClick={()=>{trio?.backToStories();state.setLens('work');setMenu(false);}}><ArrowRight size={15}/>กลับไป Canvas เดิม</button>}<button onClick={()=>{trio?.backToStories();state.switchDomain('accounting');setMenu(false);}}><FileSpreadsheet size={17}/><span>Northstar · monthly close<small>{state.library.accounting?.saved?'Saved on this device':'Accounting demo'}</small></span></button><button onClick={()=>{trio?.backToStories();state.switchDomain('maintenance');setMenu(false);}}><Wrench size={17}/><span>Northstar · equipment care<small>{state.library.maintenance?.saved?'Saved on this device':'A second kind of work'}</small></span></button>{w.saveSlot!=='sample'&&<button disabled={!state.hasSavedSample} onClick={()=>{trio?.backToStories();state.openSavedSample();setMenu(false);}}>Open saved sample workspace</button>}{w.saveSlot==='sample'&&<button onClick={()=>{trio?.backToStories();state.returnToSavedWork();setMenu(false);}}>Open original saved workspace</button>}{trio?.savedCases.map(id=><button key={id} onClick={()=>{trio.openSaved(id);state.setLens('work');setMenu(false);}}><BookOpen size={15}/>เปิดงานที่บันทึกไว้ · {trio.stories.find(s=>s.id===id)?.shortTitle}</button>)}<hr/><button onClick={()=>{setResetConfirm(true);setMenu(false);}}><Plus size={17}/>New workspace</button></div></>}</div>
   <div className="top-actions"><div className="lens-switch" aria-label="Workspace lenses"><button aria-pressed={state.lens==='work'} onClick={()=>state.setLens('work')}>Work</button><button disabled={!ready} onClick={()=>{if(trioActive){focusTrio((trio?.snapshot?.level??0)>=4?'teach':'notice');return;}state.setLens('work');state.openLearning(undefined,selected||'table');}}>Learn</button><button disabled={!ready} aria-pressed={state.lens==='constellation'} onClick={()=>trioActive?showTrioKnowledge():state.setLens('constellation')}>Constellation</button></div><div className="interaction-switch" aria-label="Workspace interaction mode"><button aria-label="Use workspace" aria-pressed={state.interactionMode==='use'} onClick={()=>state.setInteractionMode('use')}>Use</button><button aria-label="Arrange workspace" aria-pressed={state.interactionMode==='arrange'} onClick={()=>{if(trioActive){trio?.takeOver();setTrioFollow(false);}state.setInteractionMode('arrange');}}>Arrange</button></div><button className="watch-demo-top" disabled={state.demoActive||state.busy} onClick={startGuided}>{trioActive?'เลือกเดโม':'Watch demo'}</button>{localLabAvailable()&&<button className="watch-demo-top" onClick={lab.launch} data-testid="open-component-lab">ลองสร้างจริง</button>}<button className="demo-badge" onClick={()=>state.setInspector({type:'help'})}><span/> Demo mode <CircleHelp size={12}/></button><button className="icon-button history-top" title="Execution history" aria-label="Execution history" disabled={!ready} onClick={()=>trioActive?showTrioKnowledge():state.setInspector({type:'history'})}><History size={17}/></button><button aria-label={trioActive?'Save workspace':w.saved?'Saved':'Keep workspace'} className={`save-button ${w.saved&&!trioActive?'is-saved':''}`} disabled={!ready||state.busy||lab.open} onClick={()=>{if(trioActive){trio?.takeOver();trio?.saveWorkspace();}else state.save();}}>{w.saved&&!trioActive?<Check size={14}/>:<Save size={14}/>}<span>{w.saved&&!trioActive?'Saved':'Keep workspace'}</span></button></div>
  </header>
  <div {...trioCanvasProps} className={`canvas-area ${trioActive?'trio-canvas':''}`} ref={canvasRef}><ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} onNodesChange={onNodesChange} onNodeClick={(_,node)=>setSelected(node.id)} onNodeDragStart={(_,node)=>setSelected(node.id)} onPaneClick={()=>{setSelected(null);setMenu(false);}} onNodeDoubleClick={(_,node)=>flow.fitView({nodes:[node],padding:0.35,maxZoom:1.25,duration:350})} nodesDraggable={state.interactionMode==='arrange'&&!hand} nodesConnectable={false} elementsSelectable={!hand} panOnDrag panOnScroll selectionOnDrag={false} snapToGrid={snap} snapGrid={[22,22]} elevateNodesOnSelect={false} zoomOnDoubleClick={false} minZoom={0.25} maxZoom={1.6} defaultViewport={w.viewport} onMoveStart={event=>{if(event&&useWorkspace.getState().demoActive)state.setDemoFollowCamera(false);}} onMoveEnd={(_,viewport)=>{setZoom(viewport.zoom);state.setViewport(viewport);}} deleteKeyCode={null} attributionPosition="bottom-right" {...lab.extend(trioActive?trioFlowProps:{nodes,edges,onNodesChange})}><Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#d6dce5"/>{trioPanels}</ReactFlow></div>
  {!ready&&!state.presentation&&<section className="empty-workspace"><div className="welcome-label"><span className="tiny-spark">✳</span> YOUR SOFTWARE, ALIVE.</div><h1>Bring a problem.<br/><span>Watch a workspace grow.</span></h1><p>Describe a problem. Work with the solution.<br/>Teach it as you go.</p>{trio?<TrioDemoPicker controller={trio} onSelect={()=>{state.setLens('work');state.setInteractionMode('use');setDemoPickerOpen(false);}}/>:<div className="starter-options"><button className="guided-starter" data-testid="watch-demo" onClick={startGuided}><Sparkles size={18}/><span><strong>Watch the workspace grow</strong><small>เล่นเรื่องหลักต่อเนื่อง · เลือกดูทุกขั้นตอนได้</small></span><ArrowRight size={19}/></button><button className="primary-starter" data-testid="start-accounting" onClick={()=>run('accounting')}><span className="starter-icon"><FileSpreadsheet size={22}/></span><span><strong>Try accounting demo</strong><small>Find the difference. Teach a better rule.</small></span><ArrowUpRight size={21}/></button><button className="secondary-starter" onClick={()=>run('maintenance')}><Wrench size={16}/>Or explore equipment care<ArrowRight size={15}/></button></div>}<button className="connect-starter" disabled={state.demoActive} onClick={()=>{closeSources();setSourcePanel('database');}}>เชื่อม Database หรือ Excel <ArrowRight size={14}/></button><div className="demo-materials"><span>Ready on your desk</span><span><FileSpreadsheet size={12}/>Asset register</span><span><FileSpreadsheet size={12}/>General ledger</span><span><GitBranch size={12}/>Policy</span></div><div className="welcome-footnote">Entirely fictional data. Real calculations. No API key.</div></section>}
  {ready&&!lab.open&&<div className="canvas-caption"><span className="workspace-stamp">{trioActive?trio?.story?.shortTitle:w.domain==='accounting'?'MONTHLY CLOSE':'EQUIPMENT CARE'}</span><span>{trioActive?'ข้อมูลตัวอย่าง · ยังไม่เชื่อม AI':w.domain==='accounting'?periodName(w.dataset.period):'September 2026'}</span><span className="caption-dot">·</span><span>{trio?.snapshot?canvasObjectCount(trio.snapshot.caseId,trio.snapshot.level,Boolean(trio.snapshot.caseId==='quest'&&trio.snapshot.active.quest.encounter)):w.objects.length} living objects</span></div>}
  {ready&&!trioActive&&!lab.open&&<div className="stage-indicator"><span className={step===1?'current':'complete'}><span>{step>1?<Check size={10}/>:'1'}</span>Create</span><i/><span className={step===1?'current':step>1?'complete':''}><span>{step>1?<Check size={10}/>:'2'}</span>Investigate</span><i/><span className={step>=2?'current':''}><span>{step===3?<Check size={10}/>:'3'}</span>Evolve</span></div>}
  <nav className="canvas-toolbar" aria-label="Canvas tools"><button className={!hand?'active':''} title="Select objects" aria-label="Select objects" onClick={()=>setHand(false)}><MousePointer2 size={18}/></button><button className={hand?'active':''} title="Pan canvas" aria-label="Pan canvas" onClick={()=>setHand(true)}><Hand size={18}/></button><span/><button title="Fit to work (F)" aria-label="Fit to work" onClick={fit} disabled={!ready}><Focus size={18}/></button><button className={state.dependencies?'active':''} title="Show dependencies" aria-label="Show dependencies" onClick={state.setDependencies} disabled={!ready}><GitBranch size={18}/></button><button title="Learning Lens" aria-label="Learning Lens" disabled={!ready||state.busy} onClick={()=>{if(trioActive){focusTrio((trio?.snapshot?.level??0)>=4?'teach':'notice');return;}state.openLearning(undefined,selected||'table');state.setInspector(null);}}><Eye size={18}/></button><button className={snap?'active':''} title={snap?'Turn snapping off':'Turn snapping on'} aria-label="Toggle snapping" aria-pressed={snap} disabled={state.interactionMode!=='arrange'} onClick={()=>setSnap(!snap)}><Grid2X2 size={18}/></button><span/><button title="Demo guide" aria-label="Demo guide" onClick={()=>state.setInspector({type:'help'})}><CircleHelp size={18}/></button></nav>
  {selectedObject&&!state.busy&&!trioActive&&<div className="object-controls" aria-label="Selected object controls"><span>{selectedObject.title}</span><button title="Focus selected object" aria-label="Focus selected object" onClick={()=>focusObjects([selectedObject.id])}><Focus size={14}/></button>{state.interactionMode==='arrange'&&<><button title={selectedObject.placementMode==='pinned'?'Unpin object':'Pin object'} aria-label={selectedObject.placementMode==='pinned'?'Unpin object':'Pin object'} className={selectedObject.placementMode==='pinned'?'active':''} onClick={()=>state.setObjectPlacement(selectedObject.id,selectedObject.placementMode==='pinned'?'user':'pinned')}><Pin size={14}/></button><button title="Bring to front" aria-label="Bring to front" onClick={()=>state.setObjectLayer(selectedObject.id,'front')}><Layers size={14}/></button><button title="Send backward" aria-label="Send backward" onClick={()=>state.setObjectLayer(selectedObject.id,'back')}><ArrowDownToLine size={14}/></button></>}{['learning','overview'].includes(selectedObject.kind)&&<button title="Close explanation" aria-label="Close explanation" onClick={()=>{state.removeContextObject(selectedObject.id);setSelected(null);}}><X size={14}/></button>}</div>}
  {state.busy&&<div className="worker-bubble" role="status"><span className="worker-avatar"><Sparkles size={17}/></span><span>{state.activity}</span><span className="thinking-dots"><i/><i/><i/></span></div>}
  {ready&&!trioActive&&!lab.open&&!state.busy&&w.domain==='accounting'&&!w.saved&&!state.inspector&&<div className="keep-suggestion"><span><Sparkles size={14}/> Useful next month, too?</span><button onClick={state.save}>Keep this workspace <ArrowUpRight size={13}/></button></div>}
  <div className="bottom-left"><span className="canvas-location"><LayoutGrid size={13}/><span>{ready?'Your working desk':'A little room for possibility'}</span></span><div className="zoom-control"><button aria-label="Zoom out" onClick={()=>flow.zoomOut({duration:200})}><Minus size={14}/></button><span>{Math.round(zoom*100)}%</span><button aria-label="Zoom in" onClick={()=>flow.zoomIn({duration:200})}><Plus size={14}/></button></div></div>
  {!trioActive&&!lab.open&&<div className="prompt-area">{(draft.assets||draft.ledger)&&!ready&&<div className="import-summary"><FileSpreadsheet size={15}/><span>{draft.assetFilename||'Add asset CSV'} + {draft.ledgerFilename||'Add ledger CSV'}</span><button aria-label="Clear imported files" onClick={()=>setDraft({})}><X size={13}/></button></div>}
   {ready&&!state.busy&&<div className="dock-suggestions"><button onClick={()=>{state.explainWorkspace();state.setInspector(null);}}><BookOpen size={12}/>Explain this workspace</button>{w.domain==='accounting'?<><button onClick={()=>state.setInspector({type:'teach'})}><Sparkles size={12}/>Teach a rule</button><button onClick={()=>state.setInspector({type:'history'})}><History size={12}/>Follow the lineage</button>{w.saved&&<button onClick={state.nextMonth}><RotateCcw size={12}/>Run next month</button>}</>:<button onClick={()=>state.setInspector({type:'intake'})}><Plus size={12}/>Report an issue</button>}</div>}
   <form className="prompt-dock" onSubmit={e=>{e.preventDefault();submitPrompt();}}><span className="dock-spark"><Sparkles size={20}/></span><textarea rows={state.demoActive?3:1} aria-label="Describe your work" value={prompt} onChange={e=>setPrompt(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();submitPrompt();}}} placeholder={ready?'What should we improve together?':'What would you like to work on?'} disabled={state.busy||state.demoActive}/><input ref={fileRef} type="file" accept=".csv" multiple hidden onChange={e=>{if(e.target.files)importFiles(e.target.files);e.target.value='';}}/><button type="button" className="attach-button" title="Add asset and ledger CSVs" aria-label="Add CSV files" onClick={()=>fileRef.current?.click()} disabled={ready||state.busy||state.demoActive}><Paperclip size={18}/></button><button type="submit" className="send-button" aria-label="Start from your question" disabled={!prompt.trim()||state.busy}>{state.busy?<LoaderCircle size={18} className="spin"/>:<ArrowUp size={19}/>}</button></form><div className="dock-caption"><span>{ready?'Your expertise becomes executable software.':'Describe a problem, drop CSVs, or try a prepared workspace.'}</span><span><CornerDownLeft size={10}/> to begin</span></div>
  </div>}
  <div className="bottom-right"><button onClick={()=>state.setInspector({type:'help'})}>Your software, alive. <span>✳</span></button></div>
  {state.lens==='constellation'&&!trioActive&&<KnowledgeConstellation workspace={w} initialWorkObject={selected} onExplain={()=>{state.setLens('work');state.explainWorkspace();}} onNavigate={node=>{state.setLens('work');state.focusLiveObject(node.workObjectId||'table');if((node.runId!==undefined&&node.runId!==w.runs.at(-1)?.id)||node.id.startsWith('exception:handoff:legacy:')||(node.datasetId!==undefined&&node.datasetId!==w.dataset.id)||(node.ruleVersion!==undefined&&node.ruleVersion!==w.policy.version)||node.detail.some(line=>line.startsWith('Historical run:')))state.setInspector({type:'history'});else if(node.rowId)state.setInspector({type:'asset',rowId:node.rowId});else if(node.category==='rule')state.setInspector({type:'policy'});else if(node.category==='test'||node.category==='person')state.setInspector({type:'history'});}}/>}
  {trioActive&&trio?.snapshot&&state.lens==='constellation'&&<TrioConstellation key={trio.snapshot.caseId} snapshot={trio.snapshot} onNavigate={focusTrio} onExplain={()=>focusTrio('teach')}/>}
  {state.lens==='work'&&(!trioActive||state.inspector?.type==='help')&&<Inspector/>}
  {trioActive&&!lab.open&&state.lens==='work'&&<button className="canvas-follow-resume" aria-label="Follow interactions" aria-pressed={trioFollow} title={trioFollow?'กล้องจะตามส่วนที่กำลังเปลี่ยน · กดเพื่อหยุดตาม':'กดเพื่อให้กล้องตามส่วนที่กำลังเปลี่ยน'} onClick={()=>trioFollow?setTrioFollow(false):focusTrio()}>{trioFollow?<Camera size={14}/>:<CameraOff size={14}/>}<span>กล้องตามงาน</span><strong>{trioFollow?'เปิด':'ปิด'}</strong></button>}
  {trioActive&&!lab.open&&trio&&(trio.player.guided?<TrioDemoControls controller={trio}/>:<TrioManualDock controller={trio} onFocus={focusTrio} onKnowledge={showTrioKnowledge}/>)}
  {trioActive&&(trio?.messages.save??trio?.messages.storage)&&<div className="toast" role="status">{trio?.messages.save??trio?.messages.storage}</div>}
  {state.interactionMode==='arrange'&&<div className="arrange-notice">Arrange · ลากและย่อขยายวัตถุได้<button onClick={()=>state.setInteractionMode('use')}>Done</button></div>}
  {ready&&!trioActive&&!lab.open&&!state.demoActive&&<label className="demo-role">Demo role<select aria-label="Fictional demo role" value={state.persona} onChange={e=>{state.setPersona(e.target.value as 'analyst'|'colleague');if(e.target.value==='colleague'){state.setLens('work');state.explainWorkspace();}}}><option value="analyst">Analyst</option><option value="colleague">Incoming colleague</option></select><small>Fictional role · identity unverified</small></label>}
  {sourcePanel&&<ConnectionsPanel draft={connections} active={sourcePanel} busy={sourceBusy} error={sourceError} guided={state.demoActive} onSelect={setSourcePanel} onConnect={kind=>{void connectSources(kind).catch(()=>{});}} onFile={file=>{void readWorkbook(file);}} onStart={()=>{const source=connectedData();if(source){closeSources();void run('accounting',prompt||undefined,source);}}} onClose={closeSources}/>}
  {state.demoActive&&<DemoPlayer prompt={prompt} onTakeOver={()=>{useWorkspace.setState(s=>({workspace:{...s.workspace,objects:presentedObjects(s.workspace.objects,null,s.workspace.domain,stageBounds,true)}}));}} resetSources={()=>{closeSources();updateConnections(emptyConnections());}} connectSources={connectSources} prepareSources={prepareDemoSources} getSources={connectedData} closeSources={closeSources} setPrompt={setPrompt} focus={focusObjects} restoreCamera={viewport=>{void flow.setViewport(viewport,{duration:0});}}/>} 
  {state.toast&&<div className="toast" role="status"><span>{state.toast}</span><button aria-label="Dismiss notification" onClick={()=>useWorkspace.setState({toast:null})}><X size={15}/></button></div>}
  {dragging&&<div className="drop-overlay"><ArrowDownToLine size={36}/><h2>Bring your data to the desk.</h2><p>Drop an asset register and general ledger CSV.</p><span>Up to 2 MB each · use the sample column names</span></div>}
  {demoPickerOpen&&trio&&<div className="modal-backdrop canvas-demo-picker-modal" role="presentation" onClick={e=>{if(e.target===e.currentTarget)setDemoPickerOpen(false);}}><section role="dialog" aria-modal="true" aria-label="เลือกเดโมบน Canvas" className="canvas-demo-picker-panel"><button className="icon-button canvas-demo-picker-close" aria-label="ปิดตัวเลือกเดโม" onClick={()=>setDemoPickerOpen(false)}><X size={18}/></button><TrioDemoPicker controller={trio} onSelect={()=>{state.setInteractionMode('use');setDemoPickerOpen(false);}}/></section></div>}
  {resetConfirm&&<div className="modal-backdrop"><div className="confirm-modal"><span className="tag green"><Maximize2 size={12}/>A fresh canvas</span><h2>Make room for the next problem.</h2><p>This clears the current desk. A previously saved workspace remains available after refreshing. Keep current changes first if you need them.</p><div><button className="button secondary" onClick={()=>setResetConfirm(false)}>Stay here</button><button className="button teal" onClick={()=>{trio?.backToStories();state.reset();setResetConfirm(false);setDraft({});setPrompt('');}}>Start fresh <ArrowRight size={14}/></button></div></div></div>}
 </main>;
}


