import {chromium,expect} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';

const dir='test-results/edge-clearance';await mkdir(dir,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});
const page=await browser.newPage({viewport:{width:1600,height:1000}}),errors=[],checks=[];
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
async function clearance(){return page.evaluate(async()=>{
 const moduleUrl=performance.getEntriesByType('resource').find(e=>e.name.includes('/src/state/store.ts'))?.name;
 const {useWorkspace}=await import(moduleUrl),objects=useWorkspace.getState().workspace.objects;
 const links=new Map(objects.flatMap(o=>o.dependencies.map(source=>[source+'-'+o.id,{source,target:o.id}])));
 const boxes=[...document.querySelectorAll('.react-flow__node')].map(el=>({id:el.getAttribute('data-id'),box:el.getBoundingClientRect()}));
 const collisions=[],labels=[],paths=[...document.querySelectorAll('.canvas-area .react-flow__edge')];let renderedPaths=0;
 for(const edge of paths){const id=edge.getAttribute('data-id'),link=links.get(id),path=edge.querySelector('.react-flow__edge-path');if(!link||!path)continue;
  renderedPaths++;const matrix=path.getScreenCTM();if(!matrix)continue;const length=path.getTotalLength(),blocked=new Set();
  for(let i=0;i<=length;i+=3){const p=path.getPointAtLength(i),point=new DOMPoint(p.x,p.y).matrixTransform(matrix);for(const {id:other,box:b}of boxes){if(other===link.source||other===link.target)continue;if(point.x>b.left+1&&point.x<b.right-1&&point.y>b.top+1&&point.y<b.bottom-1)blocked.add(other);}}
  if(blocked.size)collisions.push({edge:id,cards:[...blocked]});
  for(const label of edge.querySelectorAll('.canvas-edge-label,.react-flow__edge-textbg')){const b=label.getBoundingClientRect();if(!b.width||!b.height)continue;for(const {id:other,box:c}of boxes){if(b.left<c.right&&b.right>c.left&&b.top<c.bottom&&b.bottom>c.top)labels.push({edge:id,card:other});}}
 }
 for(const label of document.querySelectorAll('.canvas-area .canvas-edge-label')){const b=label.getBoundingClientRect();for(const {id:other,box:c}of boxes){if(b.left<c.right&&b.right>c.left&&b.top<c.bottom&&b.bottom>c.top)labels.push({edge:label.getAttribute('data-edge-id'),card:other});}}
 return {edgeCount:paths.length,renderedPaths,collisions,labels};
});}
const mark=t=>{checks.push(t);console.log('PASS '+t);};
try{
 await page.goto('http://127.0.0.1:5173/');await page.waitForLoadState('networkidle');await page.getByTestId('start-accounting').click();await page.getByTestId('object-knowledge').waitFor({timeout:30000});await page.waitForTimeout(1000);await page.getByLabel('Fit to work',{exact:true}).click();await page.waitForTimeout(750);
 let result=await clearance();await page.screenshot({path:`${dir}/01-workspace.png`});await writeFile(`${dir}/baseline-or-result.json`,JSON.stringify(result,null,2));expect(result.renderedPaths).toBe(5);expect(result.collisions,'Arrows must not pass behind unrelated cards').toEqual([]);expect(result.labels,'Relation labels must clear cards').toEqual([]);mark('All real Work dependency paths and labels clear unrelated cards');
 await page.getByLabel('Arrange workspace',{exact:true}).click();const table=page.getByTestId('object-table'),box=await table.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+18);await page.mouse.down();await page.mouse.move(box.x+box.width/2+20,box.y+26,{steps:12});await page.mouse.up();await page.waitForTimeout(1000);result=await clearance();expect(result.renderedPaths).toBe(5);expect(result.collisions).toEqual([]);expect(result.labels).toEqual([]);await page.screenshot({path:`${dir}/02-moved.png`});mark('Routing recomputes after a card is dragged without crossing other cards');
 await page.getByRole('button',{name:'Done',exact:true}).click();await page.getByLabel('Learning Lens',{exact:true}).click();await page.waitForTimeout(1000);result=await clearance();expect(result.collisions).toEqual([]);expect(result.labels).toEqual([]);mark('A newly opened contextual card is included in obstacle routing');
 expect(errors).toEqual([]);await writeFile(`${dir}/report.json`,JSON.stringify({checks,errors,result},null,2));
}catch(e){await page.screenshot({path:`${dir}/failure.png`});await writeFile(`${dir}/report.json`,JSON.stringify({checks,errors,failure:String(e)},null,2));throw e;}finally{await browser.close();}
