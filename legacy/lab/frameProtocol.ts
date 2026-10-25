import type { GeneratedComponent, LabState } from './types';

export function validState(value: unknown): value is LabState {
  if (!value || typeof value !== 'object') return false;
  const { settings: s, history: h } = value as LabState;
  return !!s && Number.isFinite(s.bpm) && s.bpm >= 30 && s.bpm <= 240
    && Number.isFinite(s.toleranceMs) && s.toleranceMs >= 10 && s.toleranceMs <= 1000
    && typeof s.splitHands === 'boolean' && typeof s.appearance === 'string' && s.appearance.length <= 200
    && Array.isArray(h) && h.length <= 500 && h.every(t => t && typeof t.id === 'string' && t.id.length < 100
      && ['left','right','both'].includes(t.hand) && Number.isFinite(t.offsetMs) && Math.abs(t.offsetMs) <= 10000 && Number.isFinite(t.at));
}

// This rejects accidental contract violations. The iframe/CSP are separate
// browser boundaries; this string check is not a general JavaScript sandbox.
export function validateArtifact(a: GeneratedComponent): string | null {
  if (!a || !['title','explanation','html','css','js'].every(k => typeof a[k as keyof GeneratedComponent] === 'string')) return 'รูปแบบเครื่องมือไม่ครบ';
  if (a.html.length + a.css.length + a.js.length > 140000) return 'เครื่องมือมีขนาดเกินขอบเขตรอบทดลอง';
  if (!validState({ settings: a.settings, history: [] })) return 'ค่าตั้งต้นไม่ถูกต้อง';
  if (/<\/?(?:script|style|iframe|object|embed|form|meta|link|base|frame|foreignObject)\b/i.test(a.html)
      || /\s(?:on[\w-]+|src|href|xlink:href|srcset|action|formaction|poster)\s*=/i.test(a.html)) return 'มีส่วน HTML ที่รอบทดลองยังไม่รองรับ';
  if (/<\/style|@import|url\s*\(/i.test(a.css) || /url\s*\(/i.test(a.html)) return 'เครื่องมือต้องใช้ภาพและรูปทรงภายในตัวเอง';
  if (/<\/script/i.test(a.js) || /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|localStorage|sessionStorage|indexedDB|parent|top|opener|location|navigator|Worker|SharedWorker|importScripts|eval|Function|AudioContext|webkitAudioContext)\b|\bimport\s*(?:\(|[{'"*])/.test(a.js)) return 'โค้ดขอความสามารถนอกขอบเขตการทดลอง';
  return null;
}

export function frameDocument(artifact: GeneratedComponent, state: LabState, channel: string) {
  const error = validateArtifact(artifact);
  if (error) throw new Error(error);
  const nonce = channel.replace(/[^a-z0-9]/gi, '');
  const safe = (x: unknown) => JSON.stringify(x).replace(/</g, '\\u003c');
  return `<!doctype html><html lang="th"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; media-src 'none'; font-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; object-src 'none'"><style>*{box-sizing:border-box}html,body{margin:0;background:#fff;color:#202638;font-family:system-ui,sans-serif}body{padding:0;overflow-x:hidden}button,input{font:inherit}button{touch-action:manipulation}#root{display:flow-root;min-width:0;overflow-wrap:anywhere}button:focus-visible{outline:3px solid #4e6ae8;outline-offset:2px}@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}${artifact.css}</style></head><body><div id="root">${artifact.html}</div><script nonce="${nonce}">
(()=>{'use strict';
 const channel=${safe(channel)};let current=${safe(state)},visible=true,actions={};
 const stateListeners=new Set(),visibilityListeners=new Set();
 const send=(type,payload)=>parent.postMessage({channel,type,...payload},'*');
 const fail=e=>send('error',{error:String(e?.message||e).slice(0,200)});
 const copy=x=>JSON.parse(JSON.stringify(x));
 const freeze=x=>{if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x)}return x};
 const interval=window.setInterval.bind(window),timeout=window.setTimeout.bind(window),raf=window.requestAnimationFrame.bind(window);
 const intervals=new Set(),timeouts=new Set(),frames=new Set();
 window.setInterval=(fn,ms,...args)=>{const id=interval(fn,Math.max(16,ms||0),...args);intervals.add(id);return id};
 window.setTimeout=(fn,ms,...args)=>{const id=timeout(()=>{timeouts.delete(id);fn(...args)},ms);timeouts.add(id);return id};
 window.requestAnimationFrame=fn=>{const id=raf(t=>{frames.delete(id);fn(t)});frames.add(id);return id};
 const stop=()=>{try{actions.stop?.()}catch(e){fail(e)}intervals.forEach(clearInterval);timeouts.forEach(clearTimeout);frames.forEach(cancelAnimationFrame);intervals.clear();timeouts.clear();frames.clear()};
 const api={get state(){return freeze(copy(current))},get visible(){return visible},
  setState(next){const encoded=JSON.stringify(next);if(encoded.length>120000)throw Error('State too large');current=JSON.parse(encoded);send('state',{state:current});stateListeners.forEach(fn=>fn(api.state))},
  onState(fn){stateListeners.add(fn);return()=>stateListeners.delete(fn)},
  onVisibility(fn){visibilityListeners.add(fn);return()=>visibilityListeners.delete(fn)},
  expose(next){actions=next},reportError:fail,
  ready(){if(!['start','stop','tap','classify'].every(k=>typeof actions[k]==='function'))throw Error('Missing rhythm actions');send('ready',{})}
 };
 window.addEventListener('error',e=>fail(e.error||e.message));window.addEventListener('unhandledrejection',e=>fail(e.reason));
 window.addEventListener('message',async event=>{if(event.source!==parent||event.data?.channel!==channel)return;const m=event.data;
  if(m.type==='state'){current=copy(m.state);stateListeners.forEach(fn=>fn(api.state));}
  if(m.type==='visibility'){visible=!!m.visible;if(!visible)stop();visibilityListeners.forEach(fn=>fn(visible));}
  if(m.type==='invoke'){try{if(!['start','stop','tap','classify'].includes(m.action)||typeof actions[m.action]!=='function')throw Error('Unknown action');const result=await actions[m.action](...(m.args||[]));send('result',{requestId:m.requestId,result:result??null});}catch(e){send('result',{requestId:m.requestId,error:String(e?.message||e).slice(0,200)})}}
 });
 document.addEventListener('click',e=>{if(e.target.closest?.('a'))e.preventDefault()});
 const reportSize=()=>send('size',{height:Math.ceil(document.getElementById('root').getBoundingClientRect().height)});
 const sizeObserver=new ResizeObserver(reportSize);sizeObserver.observe(document.getElementById('root'));reportSize();
 try{((root,api)=>{${artifact.js}\n})(document.getElementById('root'),api)}catch(e){fail(e)}
})();</script></body></html>`;
}
