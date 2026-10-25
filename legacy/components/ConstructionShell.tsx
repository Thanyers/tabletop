import { Sparkles } from 'lucide-react';
import type { CanvasObject } from '../state/types';

export default function ConstructionShell({object,label}:{object:CanvasObject;label:string}){
 const table=object.kind==='table'||object.kind==='exceptions';
 return <div className={`construction-shell construction-shell--${object.kind}`} aria-label={`กำลังสร้าง ${object.title}`}>
  <header><Sparkles size={15}/><strong>{object.title}</strong><span>กำลังวางโครง</span></header>
  <div className="construction-shell__body">
   <p>{label}</p>
   {table?<div className="construction-shell__table">{Array.from({length:4},(_,i)=><div key={i}><i/><i/><i/></div>)}</div>:object.kind==='dashboard'?<><div className="construction-shell__metrics"><i/><i/><i/></div><div className="construction-shell__chart">{[35,65,45,80,55].map((h,i)=><i key={i} style={{height:`${h}%`}}/>)}</div></>:<div className="construction-shell__lines"><i/><i/><i/><i/></div>}
  </div>
 </div>;
}
