import { useCallback, useEffect, useMemo, useState } from 'react';
import { getViewportForBounds, Handle, Position, useReactFlow, type Node, type NodeProps, type ReactFlowProps } from '@xyflow/react';
import ComponentLab from './ComponentLab';

type LabNode = Node<{ visible: boolean; onClose: () => void; seedBpm: number }, 'componentLab'>;
function ComponentLabNode({ data }: NodeProps<LabNode>) {
  return <div className="component-lab-node"><Handle type="target" position={Position.Left}/><ComponentLab visible={data.visible} onClose={data.onClose} seedBpm={data.seedBpm}/></div>;
}
export const componentLabNodeTypes = { componentLab: ComponentLabNode };
export const localLabAvailable = () => ['localhost','127.0.0.1','[::1]'].includes(location.hostname);

export function useComponentLab({visible,onOpen,seedBpm=100}:{visible:boolean;onOpen:()=>void;seedBpm?:number}) {
  const flow=useReactFlow();
  const [open,setOpen]=useState(()=>localLabAvailable()&&new URLSearchParams(location.search).get('componentLab')==='1');
  const [position,setPosition]=useState({x:120,y:100});
  const [screen,setScreen]=useState({width:innerWidth,height:innerHeight});
  useEffect(()=>{const resized=()=>setScreen({width:innerWidth,height:innerHeight});window.addEventListener('resize',resized);return()=>window.removeEventListener('resize',resized);},[]);
  const close=useCallback(()=>setOpen(false),[]);
  const launch=useCallback(()=>{
    onOpen();
    const source=flow.getNodes().find(n=>n.id.includes('minimal'));
    setPosition(source?{x:source.position.x+(source.measured?.width??520)+120,y:source.position.y}:{x:120,y:100});
    setOpen(true);
  },[flow,onOpen]);
  useEffect(()=>{
    if(!open)return;
    const frame=()=>{
      const element=document.querySelector<HTMLElement>('[data-id="component-lab"]');
      const current=flow.getNode('component-lab');
      const canvas=element?.closest('.react-flow')?.getBoundingClientRect();
      if(element&&current&&canvas)void flow.setViewport(getViewportForBounds({x:current.position.x,y:current.position.y,width:element.offsetWidth,height:element.offsetHeight},canvas.width,canvas.height,0.25,1,0.08),{duration:250});
    };
    const timer=setTimeout(frame,350);
    return()=>clearTimeout(timer);
  },[open,flow,screen]);
  const node=useMemo<LabNode>(()=>({id:'component-lab',type:'componentLab',position,
    data:{visible:open&&visible,onClose:close,seedBpm},style:{width:Math.max(270,Math.min(700,screen.width-40))},
    dragHandle:'.component-lab__drag',deletable:false,connectable:false}),[position,open,visible,close,seedBpm,screen.width]);
  const extend=useCallback((base:ReactFlowProps):ReactFlowProps=>{
    if(!open)return base;
    const source=base.nodes?.find(n=>n.id.includes('minimal'));
    return {...base,nodes:[...(base.nodes??[]),node],edges:[...(base.edges??[]),...(source?[{id:'component-lab-source',source:source.id,target:node.id,label:`เริ่มจาก ${seedBpm} BPM`,type:'smoothstep',style:{stroke:'#8575c7',strokeWidth:2}}]:[])],
      onNodesChange:changes=>{for(const c of changes)if(c.type==='position'&&c.id===node.id&&c.position)setPosition(c.position);base.onNodesChange?.(changes.filter(c=>!('id' in c)||c.id!==node.id));}};
  },[node,open,seedBpm]);
  return {open,launch,close,extend};
}
