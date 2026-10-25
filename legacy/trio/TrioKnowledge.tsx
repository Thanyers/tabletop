import {useLayoutEffect, useRef, useState} from 'react';
import {ArrowUpRight, BookOpen, GitBranch, X} from 'lucide-react';
import type {EvidenceEvent, TrioSnapshot} from './types';
import './trio-knowledge.css';

const labels: Record<EvidenceEvent['kind'],string>={source:'ข้อมูลตั้งต้น',instruction:'สิ่งที่สอน',test:'ตัวอย่างที่ตรวจ',approval:'การอนุมัติ',run:'ผลที่ใช้จริง',simulation:'การทดลอง',handoff:'การส่งต่อ'};
const sources={shipping:[['รายการพัสดุ','/data/shipping-orders.csv'],['สัญญาตัวอย่าง','/data/shipping-contract.json']],quest:[['บันทึกลองเล่น','/data/quest-playtest.csv']],music:[['บันทึกคนซ้อม','/data/music-rehearsal.csv']]};
const timeLabel=(at:string)=>Number.isFinite(Date.parse(at))?new Intl.DateTimeFormat('th-TH',{hour:'2-digit',minute:'2-digit',second:'2-digit',timeZone:'Asia/Bangkok'}).format(new Date(at)):'ไม่พบเวลาที่อ่านได้';

export default function TrioKnowledge({snapshot}:{snapshot:TrioSnapshot}){
 const dialog=useRef<HTMLDialogElement>(null),canvas=useRef<HTMLDivElement>(null);
 const [open,setOpen]=useState(false),[selected,setSelected]=useState<string|null>(null),[paths,setPaths]=useState<{id:string;path:string;active:boolean}[]>([]);
 const events=snapshot.events;
 useLayoutEffect(()=>{
  if(!open)return;
  const area=canvas.current;if(!area)return;
  const measure=()=>{
   const outer=area.getBoundingClientRect();
   const entries=[...area.querySelectorAll<HTMLElement>('[data-event-id]')];
   const boxes=new Map(entries.map(el=>{const r=el.getBoundingClientRect();return [el.dataset.eventId,{y:r.top-outer.top+r.height/2,x:r.left-outer.left}];}));
   const next=events.flatMap((event,i)=>event.references.flatMap((source,j)=>{
    const a=boxes.get(source),b=boxes.get(event.id);if(!a||!b)return[];
    const lane=12+((i+j)%4)*8;
    return[{id:`${source}-${event.id}-${j}`,active:event.id===selected||source===selected,path:`M ${a.x-4} ${a.y} H ${lane+6} Q ${lane} ${a.y} ${lane} ${a.y+6} V ${b.y-6} Q ${lane} ${b.y} ${lane+6} ${b.y} H ${b.x-5}`}];
   }));setPaths(next);
  };
  const observer=new ResizeObserver(measure);observer.observe(area);measure();return()=>observer.disconnect();
 },[open,events,selected]);
 const close=()=>{dialog.current?.close();setOpen(false);};
 const show=()=>{setOpen(true);dialog.current?.showModal();};
 const focus=(id:string)=>{
  setSelected(id);
  const item=canvas.current?.querySelector<HTMLElement>(`[data-event-id="${CSS.escape(id)}"]`);
  item?.scrollIntoView({block:'nearest',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
 };
 return <>
  <button type="button" className="trio-knowledge-toggle" aria-label="Open work knowledge" onClick={show}><GitBranch size={15}/><span>ที่มาของงาน</span></button>
  <dialog ref={dialog} className={`trio-knowledge trio-knowledge--${snapshot.caseId}`} aria-labelledby="trio-knowledge-title" onClose={()=>setOpen(false)} onClick={e=>{if(e.target===e.currentTarget)close();}}>
   <div className="trio-knowledge__surface">
    <header><span><BookOpen size={18}/><strong id="trio-knowledge-title">จำได้ว่าเปลี่ยนเพราะอะไร</strong></span><button aria-label="Close work knowledge" onClick={close}><X size={18}/></button></header>
    <p className="trio-knowledge__intro">ตามจากคำสอน ไปถึงตัวอย่างที่ตรวจและผลที่ใช้จริง เส้นแต่ละเส้นคือการอ้างอิงที่บันทึกไว้ในงานนี้</p>
    <div className="trio-knowledge__sources">{sources[snapshot.caseId].map(([label,url])=><a key={url} href={url} target="_blank" rel="noreferrer">{label}<ArrowUpRight size={12}/></a>)}</div>
    <div className="trio-knowledge__scroll">
     {!events.length?<div className="trio-knowledge__empty">เริ่มจากคำขอแรก แล้วที่มาของงานจะค่อย ๆ เพิ่มตรงนี้</div>:<div className="trio-knowledge__map" ref={canvas}>
      <svg aria-hidden="true" className="trio-knowledge__edges"><defs><marker id="trio-knowledge-arrow" viewBox="0 0 7 7" refX="6" refY="3.5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0 L7 3.5 L0 7" fill="currentColor"/></marker></defs>{paths.map(p=><path key={p.id} d={p.path} className={p.active?'is-active':''} markerEnd="url(#trio-knowledge-arrow)"/>)}</svg>
      {events.map(event=><article key={event.id} data-event-id={event.id} className={selected===event.id?'is-selected':''}>
       <div className="trio-knowledge__meta"><span>{labels[event.kind]}</span><span>v{event.version}</span></div><button className="trio-knowledge__event" onClick={()=>setSelected(selected===event.id?null:event.id)} aria-expanded={selected===event.id}>{event.title}</button>
       {selected===event.id&&<div className="trio-knowledge__detail"><p>{event.detail.replace(/ · Fingerprint .*/, '')}</p><time>{timeLabel(event.at)}</time><div>{event.references.map(ref=>{const original=events.find(e=>e.id===ref);return original?<button key={ref} onClick={()=>focus(ref)}>จาก{labels[original.kind]}<ArrowUpRight size={11}/></button>:<span key={ref}>ยังไม่พบหลักฐานต้นทาง</span>;})}</div></div>}
      </article>)}
     </div>}
    </div>
    <footer>บันทึกของเดโมในเบราว์เซอร์นี้ · บทบาทผู้อนุมัติเป็นตัวอย่าง</footer>
   </div>
  </dialog>
 </>;
}
