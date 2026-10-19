import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const dir=process.env.DEMO_TIMING_DIR||'test-results/viewer-final';await mkdir(dir,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});
const page=await browser.newPage({viewport:{width:1600,height:900}});
const report={purpose:'Final presentation measurement of built app, uninterrupted 1x, no scene skips',viewport:{width:1600,height:900},events:[],scenes:[],errors:[],firstTableMs:null,firstTableSettledMs:null};
page.on('pageerror',e=>report.errors.push(e.message));
page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
const persist=()=>writeFile(`${dir}/report.json`,JSON.stringify(report,null,2));
async function metrics(){return page.evaluate(()=>{
 const visible=(el)=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>0&&r.height>0&&r.right>0&&r.left<innerWidth&&r.bottom>0&&r.top<innerHeight&&s.visibility!=='hidden'&&s.display!=='none';};
 const regions=[['player','.demo-player'],['inspector','.inspector'],['learning','[data-testid="object-learning"]'],['knowledge','[data-testid="knowledge-constellation"]']];
 const areas={};
 for(const [name,selector]of regions){const root=document.querySelector(selector);if(!root||!visible(root))continue;let visibleChars=0,smallChars=0;const snippets=[];const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let t;while(t=walker.nextNode()){const text=t.textContent.trim();if(!text||!visible(t.parentElement))continue;const range=document.createRange();range.selectNodeContents(t);const r=range.getBoundingClientRect();let ok=r.width>0&&r.height>0&&r.right>0&&r.left<innerWidth&&r.bottom>0&&r.top<innerHeight;for(let p=t.parentElement;p&&ok;p=p.parentElement){const s=getComputedStyle(p);if(s.overflowX!=='visible'||s.overflowY!=='visible'){const b=p.getBoundingClientRect();if(r.bottom<=b.top||r.top>=b.bottom||r.right<=b.left||r.left>=b.right)ok=false;}}if(ok){visibleChars+=text.length;if(parseFloat(getComputedStyle(t.parentElement).fontSize)<12)smallChars+=text.length;snippets.push(text);}}
 const b=root.getBoundingClientRect();areas[name]={visibleChars,smallChars,text:snippets.join(' | '),box:{x:b.x,y:b.y,width:b.width,height:b.height}};
 }
 return {areas,horizontalOverflow:document.documentElement.scrollWidth>innerWidth,tableColumns:document.querySelectorAll('[data-testid="object-table"] th').length,objects:document.querySelectorAll('.canvas-area .canvas-card').length};
 });}
try{
 await page.goto('http://127.0.0.1:4173/');await page.waitForLoadState('networkidle');
 await page.screenshot({path:`${dir}/00-start.png`});
 const start=performance.now();await page.getByRole('button',{name:'Watch demo',exact:true}).click();
 let previous='',harness=false;const seen=new Set();
 while(performance.now()-start<600000){
  const data=await page.evaluate(()=>{const p=document.querySelector('[data-testid="demo-player"]');return {scene:p?.getAttribute('data-scene'),phase:p?.getAttribute('data-phase'),stage:p?.getAttribute('data-stage'),table:!!document.querySelector('[data-testid="object-table"] tbody tr'),tablePhase:document.querySelector('[data-testid="object-table"]')?.getAttribute('data-construction-phase'),beat:document.querySelector('.demo-beat')?.textContent};});
  const elapsed=Math.round(performance.now()-start),key=`${data.scene}/${data.phase}/${data.stage}`;
  if(key!==previous){previous=key;report.events.push({elapsed,...data});console.log(`${(elapsed/1000).toFixed(1)}s ${key}`);await persist();}
  if(data.table&&report.firstTableMs===null){report.firstTableMs=elapsed;await page.screenshot({path:`${dir}/01-first-table.png`});await persist();}
  if(data.table&&data.tablePhase==='settled'&&report.firstTableSettledMs===null){report.firstTableSettledMs=elapsed;await persist();}
  if(data.phase==='reading'&&!seen.has(data.scene)){
   seen.add(data.scene);await page.waitForTimeout(650);const current=await metrics();report.scenes.push({scene:data.scene,elapsed,...current});
   await page.screenshot({path:`${dir}/${String(seen.size).padStart(2,'0')}-${data.scene}.png`});
   if(data.scene==='why'&&!harness){const html=await page.evaluate(()=>{const styles=[...document.styleSheets].map(s=>{try{return [...s.cssRules].map(r=>r.cssText).join('\n');}catch{return '';}}).join('\n');return '<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><base href="http://127.0.0.1:4173/"><style>'+styles+'</style></head><body>'+document.body.innerHTML.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'')+'</body></html>';});await writeFile(`${dir}/why-rendered.html`,html);harness=true;}
   await persist();
  }
  if(data.phase==='complete'){report.completedMs=elapsed;break;}
  if(data.phase==='error')throw Error(data.beat);
  await page.waitForTimeout(180);
 }
 if(!report.completedMs)throw Error('Playback did not complete within 10 minutes');
 await persist();console.log(JSON.stringify({firstTableMs:report.firstTableMs,firstTableSettledMs:report.firstTableSettledMs,completedMs:report.completedMs,scenes:report.scenes.length,errors:report.errors}));
}catch(error){report.failure=String(error);await persist();await page.screenshot({path:`dir/failure.png`.replace('dir',dir)});throw error;}finally{await browser.close();}
