import { useEffect, useRef, useState } from 'react';
import { Check, Focus, MousePointer2, Pause, Play, RotateCcw, SkipBack, SkipForward, X } from 'lucide-react';
import { TEACHING_PROMPT, useWorkspace } from '../state/store';
import type { DemoDraftStage, InspectorTarget, Workspace } from '../state/types';
import type { Dataset } from '../domain/types';
import type { SourceConnection } from '../domain/connections';
import './demo-story.css';
import './demo-stages.css';
import DemoAttention, {type DemoCueId} from './DemoAttention';

import { storyScenes, detailScenes, type DemoTour } from './demo-scenes';
type Snapshot={workspace:Workspace;library:ReturnType<typeof useWorkspace.getState>['library'];inspector:InspectorTarget|null;lens:'work'|'constellation';persona:'analyst'|'colleague';demoDraftStage:DemoDraftStage;demoLearningFocus:ReturnType<typeof useWorkspace.getState>['demoLearningFocus']};
type Phase='typing'|'building'|'reading'|'complete'|'error';
type DemoStage='typing'|'thinking'|'editing'|'placing'|'reading';
const STAGE_STATUS:Record<DemoStage,string>={typing:'กำลังพิมพ์',thinking:'กำลังคิด',editing:'กำลังเตรียมแก้',placing:'กำลังวาง',reading:'พร้อมดูผล'};
const SCENE_CUES:Partial<Record<(typeof storyScenes)[number]['action'],DemoCueId>>={minimal:'source',compare:'table-compare',why:'fa001-ledger',teach:'draft-threshold',threshold:'draft-threshold',schedule:'draft-life',test:'evaluation',approve:'approval-proof',experiment:'experiment-proof',knowledge:'knowledge',handoff:'handoff',continue:'overview'};
const DEMO_STAGES: {id:DemoStage;label:string}[]=[
 {id:'typing',label:'พิมพ์'},
 {id:'thinking',label:'คิด'},
 {id:'editing',label:'แก้ไข'},
 {id:'placing',label:'วาง'},
 {id:'reading',label:'ดูผล'},
];
export default function DemoPlayer({prompt,setPrompt,focus,restoreCamera,connectSources,prepareSources,getSources,closeSources,resetSources,onTakeOver}:{prompt:string;setPrompt:(text:string)=>void;focus:(ids:string[],withInspector?:boolean)=>void|Promise<void>;restoreCamera:(viewport:Workspace['viewport'])=>void;connectSources:(kind:'database'|'excel'|'ready')=>Promise<void>;prepareSources:()=>Promise<void>;getSources:()=>{dataset:Dataset;connections:SourceConnection[]}|undefined;closeSources:()=>void;resetSources:()=>void;onTakeOver:()=>void}){
 const [index,setIndex]=useState(0),[paused,setPaused]=useState(false),[speed,setSpeed]=useState(1),[phase,setPhase]=useState<Phase>('typing'),[stage,setStage]=useState<DemoStage>('typing'),[error,setError]=useState<string|null>(null),[beat,setBeat]=useState('');
 const pausedRef=useRef(false),speedRef=useRef(1),advance=useRef(false),snapshots=useRef<Snapshot[]>([]),done=useRef(false),lastFocus=useRef<{ids:string[];inspector:boolean}>({ids:[],inspector:false});
 const [tour,setTour]=useState<DemoTour>('story');const scenes=tour==='story'?storyScenes:detailScenes;
 const [cue,setCue]=useState<DemoCueId|null>(null);
 const follows=useWorkspace(s=>s.demoFollowCamera),scene=scenes[index];pausedRef.current=paused;speedRef.current=speed;
 const requestRef=useRef<HTMLParagraphElement>(null),beatId=useRef(0);
 useEffect(()=>{if(phase==='typing'&&requestRef.current)requestRef.current.scrollTop=requestRef.current.scrollHeight;},[prompt,phase]);
 useEffect(()=>{useWorkspace.setState({demoPaused:paused});},[paused]);
 useEffect(()=>{
  let cancelled=false;advance.current=false;done.current=false;setPhase('typing');setStage('typing');setError(null);setBeat('');setCue(null);useWorkspace.getState().setPresentation(null);
  const st=useWorkspace.getState();if(!snapshots.current[index])snapshots.current[index]=structuredClone({workspace:st.workspace,library:st.library,inspector:st.inspector,lens:st.lens,persona:st.persona,demoDraftStage:st.demoDraftStage,demoLearningFocus:st.demoLearningFocus});
  const state=()=>useWorkspace.getState();
  if(scene.action==='connect'||(tour==='story'&&index===0))resetSources();else closeSources();
  const short=tour==='story';
  async function wait(ms:number,skippable=false,minReal=0){let elapsed=0,real=0;while(elapsed<ms||real<minReal){if(cancelled)return false;await new Promise<void>(r=>setTimeout(r,40));if(!pausedRef.current){elapsed+=40*speedRef.current;real+=40;}if(skippable&&advance.current&&!pausedRef.current)break;}return !cancelled;}
  async function reveal(label:string,ids:string[],mutate:()=>void|Promise<void>,withInspector=false,beforeEdit?:()=>boolean|void|Promise<boolean|void>){
   const id=++beatId.current;lastFocus.current={ids,inspector:withInspector};
   setStage('thinking');setBeat('กำลังจัดลำดับขั้นตอนจากคำขอ');
   if(!await wait(short?420:750,false,short?160:280))return false;
   setStage('editing');setBeat(beforeEdit?'กำลังอ่านข้อมูลที่เชื่อมไว้':'กำลังเตรียมส่วนที่ขอแก้ไข');
   if(beforeEdit){const ready=await beforeEdit();if(ready===false||cancelled)return false;if(!await wait(1))return false;}
   state().setPresentation({id,ids,label,phase:'skeleton'});
   if(!await wait(short?220:400,false,short?160:320))return false;
   setStage('placing');setBeat('กำลังวางผลลัพธ์และจัดมุมมอง');
   if(state().demoFollowCamera&&ids.length)await focus(ids,withInspector);
   if(cancelled)return false;
   if(!await wait(1))return false;
   await mutate();if(cancelled)return false;
   state().setPresentation({id,ids,label,phase:'compose'});
   if(!await wait(120))return false;
   if(state().demoFollowCamera&&ids.length)await focus(ids,withInspector);
   if(cancelled)return false;
   if(!await wait(short?420:750,false,short?320:560))return false;
   state().setPresentation({id,ids,label,phase:'settled'});setStage('reading');setBeat(label);
   if(!await wait(short?160:700,false,short?120:500))return false;
   return true;
  }
  async function play(){
   setPrompt('');
   let typed=0;while(typed<scene.text.length){if(!await wait(1,true,40))return;if(advance.current){setPrompt(scene.text);break;}typed=Math.min(scene.text.length,typed+40*speedRef.current/(short?34:45));setPrompt(scene.text.slice(0,Math.floor(typed)));}
   setCue(SCENE_CUES[scene.action]??null);
   if(!await wait(short?120:450,true))return;advance.current=false;setStage('thinking');setBeat('กำลังจัดลำดับขั้นตอนจากคำขอ');setPhase('building');
   if(scene.action==='connect'){
    if(!await reveal('เลือกฐานข้อมูลตัวอย่าง · เปิด accounting.fixed_assets',[],()=>connectSources('database')))return;
    if(!await reveal('อ่าน Excel จริง · เลือกชีต GL postings และดูฟิลด์',[],()=>connectSources('excel')))return;
    if(!await reveal('พร้อมใช้ · เชื่อมด้วย assetId และเลือกเดือนจาก Excel',[],()=>connectSources('ready')))return;
   } else if(scene.action==='minimal'){
    let token:number|undefined;
    const activeToken=()=>{if(token===undefined)throw Error('ยังไม่ได้เริ่มงานตัวอย่าง');return token;};
    if(short){
     if(!await reveal('ตารางแรกพร้อมแล้ว · 96 รายการ',['context','source','worker','table'],()=>{
      const current=activeToken();state().addObject('context',current);state().addObject('source',current);state().addObject('worker',current);state().addObject('table',current);
      state().setAssetView('minimal','Started with a two-column asset view from the first request.');state().finish(current);
     },false,async()=>{
      await prepareSources();if(!await wait(1))return false;
      const sources=getSources();if(!sources)throw Error('ยังอ่านแหล่งข้อมูลไม่ครบ เดโมหยุดก่อนสร้างตาราง');
      token=state().begin('accounting',scene.text,sources.dataset,sources.connections);return true;
     }))return;
    }else{
     if(!await reveal('รับคำถามแล้ว',['context'],()=>state().addObject('context',activeToken()),false,()=>{
      const sources=getSources();if(!sources)throw Error('ยังอ่านแหล่งข้อมูลไม่ครบ เดโมหยุดก่อนสร้างตาราง');
      token=state().begin('accounting',scene.text,sources.dataset,sources.connections);
     }))return;
     if(!await reveal('ทะเบียนตัวอย่างกับ Excel พร้อมแล้ว',['source'],()=>state().addObject('source',activeToken())))return;
     if(!await reveal('คำนวณด้วยกฎปัจจุบันแล้ว',['worker'],()=>state().addObject('worker',activeToken())))return;
     if(!await reveal('ตารางแรกพร้อมแล้ว · 96 รายการ',['table'],()=>{const current=activeToken();state().addObject('table',current);state().setAssetView('minimal','Started with a two-column asset view from the first request.');}))return;
     state().finish(activeToken());
    }
   } else if(scene.action==='compare'){
    if(!await reveal('เพิ่มยอดบัญชีและส่วนต่างแล้ว',['table'],()=>state().setAssetView('comparison','Added ledger comparison to the existing asset view at the user’s request.')))return;
   } else if(scene.action==='overview'){
    if(!await reveal('เพิ่มการค้นหาและกรองประเภทในตารางเดิม',['table'],()=>state().setAssetView('full','Added search and category filtering to the existing view.')))return;
    if(!await reveal('เพิ่มภาพรวม · รวมผลจากแถวที่คำนวณจริง',['table','dashboard'],()=>state().addObject('dashboard',state().generation)))return;
    if(!await reveal('แยกรายการที่ต้องตรวจ · ไม่ซ่อนส่วนต่างที่เหลือ',['dashboard','exceptions'],()=>state().addObject('exceptions',state().generation)))return;
   } else if(scene.action==='why'){
    if(!await reveal('ราคาต่ำกว่าเกณฑ์เดิม จึงคำนวณได้ 0',['learning'],()=>{state().setInspector(null);state().setDemoLearningFocus('why');state().openLearning('ROW-001','table');setCue('fa001-calculated');}))return;
   } else if(scene.action==='teach'){
    if(!await reveal('ร่างกฎ Laptop พร้อมแล้ว · ยังไม่เปลี่ยนกฎจริง',['table'],async()=>{
     state().setDemoLearningFocus(null);state().setDemoDraftStage('threshold');state().setInspector({type:'teach',instruction:scene.text});setCue('draft-threshold');
     if(!await wait(220,false,160))return;
     state().setDemoDraftStage('threshold-set');setBeat('ร่างเกณฑ์ราคา 15,000 บาท');
     if(!await wait(650,false,320))return;
     state().setDemoDraftStage('schedule');setCue('draft-life');
     if(!await wait(220,false,160))return;
     state().setDemoDraftStage('life-set');setBeat('เติมอายุใช้งาน 36 เดือน');
     if(!await wait(650,false,320))return;
     state().setDemoDraftStage('start');setCue('draft-start');
     if(!await wait(200,false,160))return;
     state().setDemoDraftStage('schedule-set');setBeat('เริ่มเดือนพร้อมใช้งาน · ร่างครบจากคำขอเดียว');
     if(!await wait(750,false,360))return;
    },true))return;
   } else if(scene.action==='threshold'){
    if(!await reveal('สร้างช่องเดียวก่อน · เกณฑ์ราคาของ Laptop',['table'],()=>{state().setDemoLearningFocus(null);state().setDemoDraftStage('threshold');state().setInspector({type:'teach',instruction:scene.text});},true))return;
    if(!await reveal('ใส่เกณฑ์ที่เพิ่งสอน · 20,000 → 15,000',['table'],()=>state().setDemoDraftStage('threshold-set'),true))return;
   } else if(scene.action==='schedule'){
    if(!await reveal('เพิ่มช่องอายุใช้งาน · ใช้ Draft เดิม',['table'],()=>state().setDemoDraftStage('schedule'),true))return;
    if(!await reveal('ตั้งอายุใช้งาน · 60 → 36 เดือน',['table'],()=>state().setDemoDraftStage('life-set'),true))return;
    if(!await reveal('เพิ่มตัวเลือกเดือนเริ่มคิด · เก็บ 36 เดือนไว้',['table'],()=>state().setDemoDraftStage('start'),true))return;
    if(!await reveal('เติมรายละเอียด · 36 เดือน / เดือนพร้อมใช้งาน',['table'],()=>state().setDemoDraftStage('schedule-set'),true))return;
   } else if(scene.action==='types'){
    if(!await reveal('เพิ่มแท็บประเภท · ค่าของ Laptop ยังอยู่ครบ',['table'],()=>state().setDemoDraftStage('categories'),true))return;
   } else if(scene.action==='list'){
    if(!await reveal('สร้างหน้ารายการ Preview · กฎจริงยังไม่เปลี่ยน',['table'],()=>state().setDemoDraftStage('preview'),true))return;
   } else if(scene.action==='browse'){
    if(!await reveal('เพิ่มการค้นหา ตัวกรอง และรายละเอียดใน Preview เดิม',['table'],()=>state().setDemoDraftStage('browse'),true))return;
   } else if(scene.action==='test'){
    const candidate=structuredClone(state().workspace.policy);candidate.laptop={threshold:15000,usefulLifeMonths:36,start:'in-service'};
    if(short){
     if(!await reveal('ทดสอบข้อกำหนดและรายการเดิมแล้ว',['proposal','evaluation'],async()=>{state().setDemoDraftStage(null);state().propose(candidate,TEACHING_PROMPT);if(!await wait(320,false,200))return;state().testProposal();},true))return;
    }else{
     if(!await reveal('สร้างข้อเสนอ · ยังไม่มีผลทดสอบและยังไม่อนุมัติ',['proposal'],()=>{state().setDemoDraftStage(null);state().propose(candidate,TEACHING_PROMPT);},true))return;
     if(!await reveal('ทดสอบข้อกำหนดและรายการเดิมแล้ว',['proposal','evaluation'],()=>state().testProposal(),true))return;
    }
    const evaluation=state().workspace.proposals.find(p=>p.id===state().workspace.activeProposalId)?.evaluation;
    setBeat(evaluation?`ผ่าน ${evaluation.passed} เคส · ไม่ผ่าน ${evaluation.failed} เคส`:'ยังไม่มีผลทดสอบ');
   } else if(scene.action==='approve'){
    const p=state().workspace.proposals.find(p=>p.id===state().workspace.activeProposalId);
    if(!p?.evaluation||p.evaluation.failed)throw Error('ผลทดสอบยังไม่ผ่าน เดโมหยุดก่อนการอนุมัติ');
    if(short){
     if(!await reveal('FA-001 เปลี่ยนจาก 0 เป็น 500 บาทแล้ว',['learning'],()=>{state().setInspector(null);state().approve();state().addObject('dashboard',state().generation);state().addObject('exceptions',state().generation);state().addObject('knowledge',state().generation);state().setDemoLearningFocus('approved');state().openLearning('ROW-001','table');}))return;
    }else{
     if(!await reveal('อนุมัติแล้ว · คำนวณใหม่ในตารางเดิม',['table'],()=>{state().setInspector(null);state().approve();state().addObject('knowledge',state().generation);}))return;
     state().setDemoLearningFocus('approved');
     if(!await reveal('FA-001 ตรงกับทะเบียนแล้ว',['learning'],()=>state().openLearning('ROW-001','table')))return;
    }
   } else if(scene.action==='experiment'){
    if(!await reveal('ผลจริงยังไม่เปลี่ยน · ปรับสมมติฐานเพื่อดูผลทดลอง',['learning'],()=>{state().setInspector(null);state().setDemoLearningFocus('experiment');state().openLearning('ROW-001','table');}))return;
   } else if(scene.action==='knowledge'){
    if(!await reveal('เชื่อมที่มา คำสอน ผลทดสอบ และผลลัพธ์',[],()=>state().setLens('constellation')))return;
   } else if(scene.action==='handoff'){
    if(!await reveal('กลับมางานค้าง · ส่งต่อ FA-009 พร้อมหลักฐาน',['exceptions'],()=>{state().setDemoLearningFocus(null);state().setLens('work');state().handoffAction('ROW-009','continue','Incoming colleague · fictional');state().setInspector({type:'handoff',rowId:'ROW-009'});},true))return;
   } else if(scene.action==='continue'){
    if(!await reveal('บันทึกแล้ว · เปิด snapshot เดิมให้ผู้รับงานต่อ',['overview'],()=>{state().setInspector(null);state().setDemoLearningFocus(null);state().save();if(!state().workspace.saved)throw Error('บันทึกตัวอย่างไม่ได้ จึงยังเปิด snapshot ต่อไม่ได้');state().restoreDemo();state().explainWorkspace();}))return;
   }
   if(cancelled)return;setPhase('reading');done.current=true;
   if(!await wait(scene.hold,true))return;
   if(index<scenes.length-1){done.current=false;setPhase('typing');setIndex(i=>i+1);}else{setPaused(true);setPhase('complete');}
  }
  void play().catch(e=>{if(!cancelled){setError(e instanceof Error?e.message:String(e));setPaused(true);setStage('reading');setPhase('error');}});
  return()=>{cancelled=true;};
 // Callbacks read the current store; workspace changes must not restart a scene.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[index,tour]);
 function changeTour(value:DemoTour){useWorkspace.getState().startDemo();snapshots.current=[];done.current=false;setPrompt('');setTour(value);setIndex(0);setPhase('typing');setStage('typing');setPaused(false);}
 function goBack(){if(index===0)return;const saved=snapshots.current[index-1];if(saved){useWorkspace.setState(s=>({...structuredClone(saved),presentation:null,busy:false,generation:s.generation+1}));restoreCamera(saved.workspace.viewport);}setPrompt('');done.current=false;setPhase('typing');setStage('typing');setIndex(i=>i-1);}
 function goNext(){if(done.current&&index<scenes.length-1){done.current=false;setPhase('typing');setIndex(i=>i+1);}else{advance.current=true;}setPaused(false);}
 function exit(takeOver=false){if(takeOver)onTakeOver();setPrompt('');useWorkspace.getState().endDemo(takeOver);}
 function toggleFollow(){useWorkspace.getState().setDemoFollowCamera(!follows);if(!follows&&lastFocus.current.ids.length)focus(lastFocus.current.ids,lastFocus.current.inspector);}
 return <><section className="demo-player" data-testid="demo-player" data-tour={tour} data-phase={phase} data-stage={stage} data-scene={scene.action} aria-label="Guided demo player">
  <div className="demo-player-label"><span data-testid="demo-phase-label">{index+1}/{scenes.length} · {phase==='complete'?'ครบลูปแล้ว':phase==='error'?'หยุดเพื่อดูปัญหา':paused?'หยุดชั่วคราว':STAGE_STATUS[stage]}</span><strong>{scene.title}</strong><select className="demo-tour-select" aria-label="Demo story" value={tour} onChange={e=>changeTour(e.target.value as DemoTour)}><option value="story">เรื่องหลัก · อัตโนมัติ</option><option value="details">ดูทุกขั้นตอน</option></select></div>
  <div className="demo-player-controls"><button aria-label="Previous demo scene" disabled={index===0||phase==='building'} onClick={goBack}><SkipBack size={15}/></button><button aria-label={paused?'Resume demo':'Pause demo'} onClick={()=>setPaused(!paused)}>{paused?<Play size={15}/>:<Pause size={15}/>}</button><button aria-label="Next demo scene" disabled={phase==='building'||phase==='complete'||!!error} onClick={goNext}><SkipForward size={15}/></button><select aria-label="Demo playback speed" value={speed} onChange={e=>setSpeed(Number(e.target.value))}><option value={1}>1×</option><option value={2}>2×</option><option value={4}>4×</option><option value={16}>16×</option></select><button className="demo-follow" aria-label="Follow growing workspace" aria-pressed={follows} onClick={toggleFollow} title={follows?'กล้องกำลังตามสิ่งที่เปลี่ยน':'กดให้กล้องกลับมาตามงาน'}><Focus size={14}/><span>{follows?'กล้องตามงาน':'ตามกล้อง'}</span></button><button className="demo-take-over" onClick={()=>exit(true)}><MousePointer2 size={13}/>ลองเอง</button>{phase==='complete'&&<button aria-label="Replay demo" onClick={()=>{useWorkspace.getState().startDemo();snapshots.current=[];done.current=false;setPhase('typing');setIndex(0);setPaused(false);}}><RotateCcw size={15}/></button>}<button aria-label="Close guided demo" onClick={()=>exit()}><X size={15}/></button></div>
  <ol className="demo-stage-rail" data-testid="demo-stage-rail" aria-label="Demo stages">
   {DEMO_STAGES.map((item,itemIndex)=>{const currentIndex=DEMO_STAGES.findIndex(candidate=>candidate.id===stage);const status=itemIndex<currentIndex?'complete':itemIndex===currentIndex?'current':'next';return <li key={item.id} role="listitem" data-demo-stage={item.id} data-stage-state={status} aria-current={status==='current'?'step':undefined} aria-label={`${item.label} · ${status}`}><span className="demo-stage-rail__marker">{status==='complete'?<Check size={11}/>:itemIndex+1}</span><span className="demo-stage-rail__label">{item.label}</span></li>;})}
  </ol>
  <div className="demo-request-block" data-testid="demo-request-block"><span className="demo-message-label">คำขอของคุณ</span><p ref={requestRef} className="demo-request" aria-label="Demo typed request">{prompt||'กำลังเรียบเรียงคำถาม…'}{phase==='typing'&&<i aria-hidden="true"/>}</p></div>
  <div className="demo-beat" data-testid="demo-bot-status" role="status" aria-live="polite"><span className={`demo-beat-dot phase-${phase}`}/><strong className="demo-beat__speaker">ผู้ช่วยเดโม</strong><span className="demo-beat__message">{error??(beat||scene.caption)}</span></div>
  <div className="demo-progress"><i style={{width:`${(index+1)/scenes.length*100}%`}}/></div><span className="demo-isolation-note">{!follows&&'กล้องหยุดตาม · '}ข้อมูลสมมติ · เก็บแยกจากงานของคุณ</span>
 </section><DemoAttention cue={cue}/></>;
}
