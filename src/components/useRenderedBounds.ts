import {useLayoutEffect,useMemo,useState,type RefObject} from 'react';
import {useReactFlow} from '@xyflow/react';
import type {CanvasObject} from '../state/types';
import type {RoutingRect} from '../state/edge-routing';

// CSS can still be moving a card after its canonical position/size has changed.
// Route against the rendered rectangle, without persisting animation geometry.
export function useRenderedBounds(root:RefObject<HTMLDivElement|null>,objects:readonly CanvasObject[]):RoutingRect[]{
 const flow=useReactFlow();
 const [measured,setMeasured]=useState<RoutingRect[]>([]);
 useLayoutEffect(()=>{
  const canvas=root.current;if(!canvas)return;
  let frame=0,until=performance.now()+850,last=0,disposed=false;
  const read=(now:number)=>{
   if(disposed)return;
   if(now-last>=30){
    last=now;const area=canvas.getBoundingClientRect(),view=flow.getViewport();
    const elements=new Map(Array.from(canvas.querySelectorAll<HTMLElement>('.react-flow__node')).map(el=>[el.dataset.id,el]));
    const next=objects.map(object=>{
     const box=elements.get(object.id)?.getBoundingClientRect();
     return box&&box.width>0&&box.height>0?{id:object.id,x:(box.left-area.left-view.x)/view.zoom,y:(box.top-area.top-view.y)/view.zoom,width:box.width/view.zoom,height:box.height/view.zoom}:{id:object.id,x:object.position.x,y:object.position.y,width:object.width,height:object.height};
    });
    setMeasured(previous=>previous.length===next.length&&previous.every((a,i)=>a.id===next[i].id&&Math.abs(a.x-next[i].x)<.3&&Math.abs(a.y-next[i].y)<.3&&Math.abs(a.width-next[i].width)<.3&&Math.abs(a.height-next[i].height)<.3)?previous:next);
   }
   frame=now<until?requestAnimationFrame(read):0;
  };
  const schedule=()=>{until=performance.now()+850;if(!frame)frame=requestAnimationFrame(read);};
  const observer=new ResizeObserver(schedule);
  canvas.querySelectorAll('.react-flow__node').forEach(el=>observer.observe(el));
  read(performance.now());
  return()=>{disposed=true;cancelAnimationFrame(frame);observer.disconnect();};
 },[root,objects,flow]);
 return useMemo(()=>objects.map(object=>measured.find(rect=>rect.id===object.id)??{id:object.id,x:object.position.x,y:object.position.y,width:object.width,height:object.height}),[objects,measured]);
}
