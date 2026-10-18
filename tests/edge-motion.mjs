import {chromium,expect} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
const dir='test-results/edge-motion';await mkdir(dir,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true}),page=await browser.newPage({viewport:{width:1600,height:900}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
try{
 await page.goto('http://127.0.0.1:5173/');await page.waitForLoadState('networkidle');
 await page.evaluate(()=>{
  window.__edgeMotion={frames:0,pathSamples:0,violations:[],done:false};
  const found=new Set(),start=performance.now();
  function sample(){
   const result=window.__edgeMotion,player=document.querySelector('[data-testid="demo-player"]'),scene=player?.getAttribute('data-scene'),stage=player?.getAttribute('data-stage');
   const boxes=[...document.querySelectorAll('.canvas-area .react-flow__node')].map(el=>({id:el.getAttribute('data-id'),box:el.getBoundingClientRect()}));
   for(const edge of document.querySelectorAll('.canvas-area .react-flow__edge')){
    const id=edge.getAttribute('data-id'),path=edge.querySelector('.canvas-edge__path');if(!path)continue;
    const source=boxes.find(a=>boxes.some(b=>a.id+'-'+b.id===id)),target=source&&boxes.find(b=>source.id+'-'+b.id===id);if(!source||!target)continue;
    const matrix=path.getScreenCTM();if(!matrix)continue;result.pathSamples++;
    for(let d=0,length=path.getTotalLength();d<=length;d+=8){const p=path.getPointAtLength(d),point=new DOMPoint(p.x,p.y).matrixTransform(matrix);for(const other of boxes){if(other.id===source.id||other.id===target.id)continue;const b=other.box;if(point.x>b.left+1&&point.x<b.right-1&&point.y>b.top+1&&point.y<b.bottom-1){const key=id+'/'+other.id+'/'+scene+'/'+stage;if(!found.has(key)){found.add(key);result.violations.push({edge:id,card:other.id,scene,stage,at:Math.round(performance.now()-start)});}}}}
   }
   result.frames++;
   if(scene==='why'&&player?.getAttribute('data-phase')==='reading'||performance.now()-start>35000){result.done=true;return;}
   requestAnimationFrame(sample);
  }
  requestAnimationFrame(sample);
 });
 await page.getByTestId('watch-demo').click();await page.getByLabel('Demo playback speed').selectOption('16');await page.waitForFunction(()=>window.__edgeMotion?.done,{},{timeout:40000});await page.getByLabel('Pause demo',{exact:true}).click();
 const result=await page.evaluate(()=>window.__edgeMotion);await page.screenshot({path:`${dir}/why.png`});await writeFile(`${dir}/report.json`,JSON.stringify({result,errors},null,2));expect(result.pathSamples).toBeGreaterThan(20);expect(result.violations).toEqual([]);expect(errors).toEqual([]);console.log('PASS Dependency paths clear actual moving cards throughout creation, comparison growth and explanation placement');console.log('PASS No browser errors while sampling the animated route journey');
}finally{await browser.close();}
