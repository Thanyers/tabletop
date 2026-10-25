import type { CanvasObject, Domain, ObjectKind } from './types';
const layout: Record<ObjectKind, [number, number, number, number, string, CanvasObject['type']]> = {
 context:[55,-15,540,100,'The question','knowledge'], source:[-310,235,260,300,'Source material','source'],
 worker:[620,16,270,100,'Calculation worker','worker'], table:[0,140,650,390,'Asset reconciliation','view'],
 dashboard:[730,185,350,350,'Monthly overview','view'], exceptions:[120,570,570,205,'Needs your attention','decision'],
 knowledge:[770,610,320,205,'Working knowledge','knowledge'], proposal:[400,860,520,260,'A new way to work','knowledge'],
 evaluation:[970,860,430,260,'Verification bench','decision'], intake:[1130,0,300,190,'Report an issue','view'],
 learning:[0,0,440,600,'Learning lens','trace'], overview:[0,0,520,600,'Workspace overview','trace'],
};
export const OBJECT_SEQUENCE: ObjectKind[]=['context','source','worker','table','dashboard','exceptions','knowledge'];
export function makeObject(kind:ObjectKind,domain:Domain,runId?:string):CanvasObject{
 const [x,y,width,height,title,type]=layout[kind];
 const titles=domain==='maintenance'?{table:'Equipment inventory',worker:'Warranty worker',dashboard:'Equipment health',exceptions:'Maintenance priorities'}:{};
 const dependencies:Partial<Record<ObjectKind,string[]>>={worker:['source','knowledge'],table:['worker'],dashboard:['table'],exceptions:['table'],proposal:['knowledge'],evaluation:['proposal','source'],intake:['source']};
 return {id:kind,type,kind,title:titles[kind as keyof typeof titles]||title,position:{x,y},width,height,status:'ready',configuration:{domain},dataRefs:[domain==='accounting'?'asset-register':'equipment-register'],dependencies:dependencies[kind]||[],version:1,origin:'system',executionRef:runId,zIndex:Object.keys(layout).indexOf(kind),placementMode:'ai',collapsed:kind==='worker'};
}

export interface ObjectSize { width: number; height: number }

function overlapsWithGap(left: CanvasObject['position'] & ObjectSize, right: CanvasObject, gap: number): boolean {
 return left.x < right.position.x + right.width + gap
  && left.x + left.width + gap > right.position.x
  && left.y < right.position.y + right.height + gap
  && left.y + left.height + gap > right.position.y;
}

export function findNearbyPosition(
 objects: readonly CanvasObject[],
 anchor: CanvasObject,
 size: ObjectSize,
 gap = 24,
): { x: number; y: number } {
 const occupied = objects.some((object) => object.id === anchor.id) ? objects : [...objects, anchor];
 const centerAligned = {
  x: anchor.position.x + (anchor.width - size.width) / 2,
  y: anchor.position.y + (anchor.height - size.height) / 2,
 };
 const horizontalStep = size.width + gap;
 const verticalStep = size.height + gap;
 const maxRing = Math.max(8, occupied.length * 2 + 4);
 for (let ring = 1; ring <= maxRing; ring += 1) {
  const offsets: Array<{ x: number; y: number }> = [];
  for (let gridY = -ring; gridY <= ring; gridY += 1) {
   for (let gridX = -ring; gridX <= ring; gridX += 1) {
    if (Math.max(Math.abs(gridX), Math.abs(gridY)) === ring) offsets.push({ x: gridX, y: gridY });
   }
  }
  offsets.sort((left, right) => Math.hypot(left.x, left.y) - Math.hypot(right.x, right.y));
  for (const offset of offsets) {
   const position = { x: centerAligned.x + offset.x * horizontalStep, y: centerAligned.y + offset.y * verticalStep };
   const candidate = { ...position, ...size };
   if (!occupied.some((object) => overlapsWithGap(candidate, object, gap))) return position;
  }
 }
 const rightmost = occupied.reduce((right, object) => Math.max(right, object.position.x + object.width), anchor.position.x + anchor.width);
 return { x: rightmost + gap, y: anchor.position.y };
}
