import {chromium,expect} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
const width=Number(process.argv.find(a=>a.startsWith('--width='))?.split('=')[1]||1024);
const height=Number(process.argv.find(a=>a.startsWith('--height='))?.split('=')[1]||768);
const dir=`test-results/surface-focus/${width}x${height}${process.argv.includes('--quick')?'/quick':''}`;await mkdir(dir,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});
const page=await browser.newPage({viewport:{width,height}}),errors=[],failures=[],samples=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
const player=page.getByTestId('demo-player');
async function sample(name){
 const data=await page.evaluate(()=>{
  const rect=el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
  const info=el=>{const s=getComputedStyle(el);return {selector:el.getAttribute('data-testid')||el.className,box:rect(el),fontSize:parseFloat(s.fontSize),lineHeight:s.lineHeight,clientWidth:el.clientWidth,scrollWidth:el.scrollWidth,clientHeight:el.clientHeight,scrollHeight:el.scrollHeight,overflowY:s.overflowY,border:s.borderColor,focusAccent:parseFloat(s.borderInlineStartWidth),shadow:s.boxShadow,outline:s.outline,outlineStyle:s.outlineStyle,outlineWidth:parseFloat(s.outlineWidth),opacity:s.opacity,text:el.innerText?.slice(0,150)};};
  const query=s=>[...document.querySelectorAll(s)].filter(el=>{const r=el.getBoundingClientRect();return r.width&&r.height&&getComputedStyle(el).visibility!=='hidden';}).map(info);
  return {viewport:{width:innerWidth,height:innerHeight},overflow:document.documentElement.scrollWidth>innerWidth,player:query('.demo-player'),request:query('.demo-request'),composer:query('.prompt-area'),dialog:query('[role="dialog"],.confirm-modal'),inspector:query('.inspector'),inspectorContent:query('.inspector__content'),focus:query('.construction-target'),focusedFields:query('[data-demo-focus-active="true"]'),context:query('.presentation-context'),phase:document.querySelector('[data-testid="demo-player"]')?.getAttribute('data-phase')};
 });
 samples.push({name,...data});
 if(data.overflow)failures.push(`${name}: page overflows horizontally`);
 for(const box of [...data.dialog,...data.inspector,...data.player])if(box.box.x<-.5||box.box.y<-.5||box.box.right>width+.5||box.box.bottom>height+.5)failures.push(`${name}: ${box.selector} is outside viewport`);
 for(const r of data.request){if(r.scrollHeight>r.clientHeight+1)failures.push(`${name}: typed request needs inner scrolling (${r.clientHeight}/${r.scrollHeight})`);if(r.fontSize<12)failures.push(`${name}: typed request font below12px (${r.fontSize})`);}
 const dock=data.player[0];for(const pane of [...data.dialog,...data.inspector])if(dock&&pane.box.bottom>dock.box.y-8)failures.push(`${name}: result pane overlaps playback dock`);
 if(data.phase==='reading'&&!data.focus.length&&!data.focusedFields.length&&name!=='connections')failures.push(`${name}: no persistent card/field focus in reading`);
 if(data.phase==='reading'&&data.focus.length&&!data.focus.some(x=>x.outlineStyle==='solid'&&x.outlineWidth>=2)&&!data.focusedFields.some(x=>x.focusAccent>=2))failures.push(`${name}: the referenced card or active draft field needs one persistent focus treatment`);
 if(name==='database-rows'&&!data.dialog.length)failures.push('Manual connection dialog missing');
 if(name==='database-rows'&&data.dialog[0]?.box.height<Math.min(460,height-32))failures.push('Manual source dialog reserves too much unused viewport space');
 await page.screenshot({path:`${dir}/${name}.png`});
}
async function reading(){await expect(player).toHaveAttribute('data-phase','reading',{timeout:45000});if(await page.getByLabel('Pause demo',{exact:true}).isVisible())await page.getByLabel('Pause demo',{exact:true}).click();await page.waitForTimeout(750);}
try{
 await page.goto('http://127.0.0.1:5173/');await page.waitForLoadState('networkidle');await sample('empty');
 if(!process.argv.includes('--demo-only')){
 await page.getByRole('button',{name:'เชื่อม Database หรือ Excel',exact:true}).click();await sample('database-dialog');
 await page.getByRole('button',{name:'Connect bundled snapshot',exact:true}).click();await page.getByRole('button',{name:'Continue to Excel',exact:true}).waitFor();await sample('database-rows');
 await page.getByRole('button',{name:'Continue to Excel',exact:true}).click();await sample('excel-dialog');
 await page.getByLabel('Close connections panel',{exact:true}).click();
 }
 await page.getByTestId('watch-demo').click();await page.getByLabel('Demo playback speed').selectOption('1');await reading();await sample('minimal');
 for(const scene of (process.argv.includes('--quick')?[]:['compare','why','teach','test','approve','experiment'])){
  await page.getByLabel('Next demo scene',{exact:true}).click();await expect(player).toHaveAttribute('data-scene',scene);await reading();await sample(scene);
 }
 await expect(page.getByTestId('demo-phase-label')).toContainText('หยุดชั่วคราว');
 await page.getByLabel('Close guided demo',{exact:true}).click();await expect(page.locator('.construction-target')).toHaveCount(0);
 await page.getByTestId('start-accounting').click();await page.getByTestId('object-knowledge').waitFor();await page.getByRole('button',{name:'Keep workspace',exact:true}).waitFor();
 await page.getByRole('textbox',{name:'Describe your work',exact:true}).fill('อยากเทียบค่าเสื่อมกับยอดบัญชี แล้วตรวจรายการที่ต่างกัน');await sample('manual-composer');
 await page.getByLabel('Fit to work',{exact:true}).click();await page.getByRole('button',{name:/Fixed asset register/}).click();await sample('manual-source');await page.getByLabel('Close inspector',{exact:true}).click();
 await page.getByRole('button',{name:'Teach a rule',exact:true}).click();await sample('manual-draft');await page.getByLabel('Close inspector',{exact:true}).click();
 await page.locator('.workspace-switcher > button').click();await page.getByRole('button',{name:'New workspace',exact:true}).click();await sample('confirm-modal');await page.getByRole('button',{name:'Stay here',exact:true}).click();
 await writeFile(`${dir}/report.json`,JSON.stringify({width,height,samples,failures,errors},null,2));console.log(JSON.stringify({width,height,failures,errors},null,2));expect(failures).toEqual([]);expect(errors).toEqual([]);
}catch(error){await writeFile(`${dir}/report.json`,JSON.stringify({width,height,samples,failures,errors,error:String(error)},null,2));throw error;}finally{await browser.close();}
