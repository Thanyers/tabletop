import { forwardRef, useEffect, useLayoutEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { frameDocument, validState } from './frameProtocol';
import type { GeneratedComponent, LabState } from './types';

export type GeneratedFrameHandle = { invoke: (action: string, args: unknown[]) => Promise<unknown> };
type Props = { artifact: GeneratedComponent; state: LabState; visible: boolean; onState: (state: LabState) => void; onReady: () => void; onError: (error: string) => void; title?: string };

const GeneratedFrame = forwardRef<GeneratedFrameHandle, Props>(function GeneratedFrame(props, ref) {
  const [height,setHeight]=useState(320);
  const frame = useRef<HTMLIFrameElement>(null), latest = useRef(props);latest.current = props;
  const pending = useRef(new Map<string,{resolve:(v:unknown)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}>());
  const channel = useMemo(()=>crypto.randomUUID(),[props.artifact]);
  // State updates travel over the bridge, never remount the running component.
  const document = useMemo(()=>frameDocument(props.artifact,latest.current.state,channel),[props.artifact,channel]);
  const send = (message: Record<string,unknown>) => frame.current?.contentWindow?.postMessage({channel,...message},'*');
  useImperativeHandle(ref,()=>({invoke:(action,args)=>new Promise((resolve,reject)=>{
    const requestId=crypto.randomUUID();const timer=setTimeout(()=>{pending.current.delete(requestId);reject(new Error('เครื่องมือไม่ตอบกลับ'))},2000);
    pending.current.set(requestId,{resolve,reject,timer});send({type:'invoke',action,args,requestId});
  })}),[channel]);
  // Subscribe before a fast srcDoc can post its initial ready handshake.
  useLayoutEffect(()=>{
    let ready=false;const timeout=setTimeout(()=>{if(!ready)latest.current.onError('เครื่องมือยังเปิดใช้งานไม่ได้ภายในเวลาที่กำหนด')},8000);
    const receive=(event:MessageEvent)=>{
      if(event.source!==frame.current?.contentWindow||event.data?.channel!==channel)return;
      const message=event.data;
      if(message.type==='size' && Number.isFinite(message.height))setHeight(Math.max(180,Math.min(3000,Math.ceil(message.height))));
      if(message.type==='ready'){ready=true;clearTimeout(timeout);send({type:'state',state:latest.current.state});send({type:'visibility',visible:latest.current.visible});latest.current.onReady();}
      if(message.type==='state'){if(validState(message.state))latest.current.onState(message.state);else latest.current.onError('เครื่องมือส่งข้อมูลที่ไม่ตรงข้อตกลง');}
      if(message.type==='error')latest.current.onError(String(message.error).slice(0,200));
      if(message.type==='result'){const wait=pending.current.get(message.requestId);if(wait){clearTimeout(wait.timer);pending.current.delete(message.requestId);if(message.error)wait.reject(new Error(String(message.error)));else wait.resolve(message.result);}}
    };
    window.addEventListener('message',receive);
    return()=>{clearTimeout(timeout);window.removeEventListener('message',receive);for(const wait of pending.current.values()){clearTimeout(wait.timer);wait.reject(new Error('เปลี่ยนรุ่นเครื่องมือแล้ว'));}pending.current.clear();};
  },[channel]);
  useEffect(()=>{send({type:'state',state:props.state})},[props.state,channel]);
  useEffect(()=>{send({type:'visibility',visible:props.visible})},[props.visible,channel]);
  return <iframe ref={frame} title={props.title??props.artifact.title} style={{height}} className="generated-component-frame nodrag nowheel nopan" sandbox="allow-scripts" allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'" srcDoc={document}/>;
});
export default GeneratedFrame;
