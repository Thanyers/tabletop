/**
 * F031: compact prompt guide that replaces the 36 KB JSON Schema dump.
 * Hand-written prompt artifact only — the zod schemas stay authoritative.
 *
 * F047: the numeric limits are interpolated from `TABLE_LIMITS` and `GENERATIVE_LIMITS`, so the guide
 * cannot advertise one number while the validator enforces another. `manifestNodes` was the drift
 * that motivated this: the validator rejected a canvas the guide said nothing about.
 * Seat names come from the shared seat list for the same reason.
 */
import { MAX_TABLE_MEMBER_SEATS } from '../../src/tabletop/shared/contracts.js';
import { TABLE_LIMITS } from '../../src/tabletop/domain/table.js';
import { GENERATIVE_LIMITS } from '../../src/tabletop/shared/generative-contracts.js';

const LIMITS = [
  `collections<=${TABLE_LIMITS.collections}`,
  `fields<=${TABLE_LIMITS.fieldsPerCollection} per collection`,
  `actions<=${TABLE_LIMITS.actions}`,
  `parameters<=${TABLE_LIMITS.parametersPerAction} per action`,
  `creates<=${TABLE_LIMITS.createsPerAction} per action`,
  `conditions<=${TABLE_LIMITS.conditionsPerAction} per action`,
  `effects<=${TABLE_LIMITS.effectsPerAction} per action`,
  `invariants<=${TABLE_LIMITS.invariants} (fields<=${TABLE_LIMITS.invariantFields} each)`,
  `turnOrder<=${TABLE_LIMITS.turnOrder} seats`,
  `evidence<=${TABLE_LIMITS.evidence}`,
  `assumptions<=${TABLE_LIMITS.assumptions}`,
  `views<=${GENERATIVE_LIMITS.canvasViews}`,
  `canvas manifest nodes (2 + collections + actions + views)<=${GENERATIVE_LIMITS.manifestNodes}`,
  `expression depth<=${GENERATIVE_LIMITS.expressionDepth}`,
  `expression nodes<=${GENERATIVE_LIMITS.expressionNodes}`,
  `expression array items<=${GENERATIVE_LIMITS.arrayItems}`,
  `scene elements<=${GENERATIVE_LIMITS.sceneElements}`,
  `polygon points 3..${GENERATIVE_LIMITS.scenePoints}`,
  `controls<=${GENERATIVE_LIMITS.controlsPerView} per view`,
  `rows<=${TABLE_LIMITS.rowsPerCollection} per collection and <=${TABLE_LIMITS.rowsTotal} total`,
  'evidence quote<=500',
  `numbers finite with |n|<=${GENERATIVE_LIMITS.numberMagnitude}`,
].join('; ');

export const TABLE_SCHEMA_GUIDE = `TABLE-CHANGE COMPACT SCHEMA v1 (hand-written prompt guide; the app's zod validator is authoritative)

BUDGET: max_tokens=32768 for the single reply (reasoning tokens count toward it).
LIMITS: ${LIMITS}.
ID: /^[a-z][a-z0-9_-]{0,39}$/, never a JS builtin name (constructor, prototype, __proto__, toString, valueOf, hasOwnProperty, ...).
VALUE: string<=500 | number | boolean | null | string[] (<=32 items, each <=100 chars).
STRICT: every object below rejects unknown keys and requires exactly the keys listed; "?" marks an optional key. The root has exactly three keys; canvas is INSIDE program.

ROOT{kind:"table",program,initialRecords}
PROGRAM{version:1,title:<=100 chars,description,collections,actions,invariants,turnOrder,evidence,assumptions,canvas?}
COLLECTION{id,title,fields}
FIELD{id,label,type:text|number|boolean|list,required:boolean,min?,max?,choices?,default?}
  Only number fields take min/max (min<=max); only text fields take choices (1..32 strings, each<=100); default must satisfy type, choices and bounds.
ACTION{id,title,description,roles,parameters,conditions,effects,creates?,requireTurn:boolean,advanceTurn:boolean}
  roles = ("owner"|"participant")[1..2]; an action must set a field, create a row, or advanceTurn; requireTurn/advanceTurn need a non-empty turnOrder.
PARAM{id,label,type:text|number|boolean|record|roll,collection?,min?,max?,choices?,roll?}
  record params MUST have collection; only number params take min/max; only text params take choices.
  ROLL{groups:[{count:1..10,faces:2..100}] 1..4,modifier?:integer -1000..1000}
  A roll param carries exactly one roll spec (no collection/min/max/choices); total dice across groups <=20.
  The SERVER rolls it: a player presses the roll button, the server returns the dice, and the action input
  for that parameter is NOT sent by the client. A roll behaves as a number in OPERAND {input:ROLL_ID};
  at most ONE roll param per action. Both sides of a condition/effect still type-check against that number.
  ATTACK EXAMPLE (one roll param; monsters.damage_taken must be a number field; damage feeds it additively):
  ACTION{id:"attack",title:"Attack",description:"Roll damage against one monster",roles:["owner","participant"],
    parameters:[{id:"target",label:"Target",type:"record",collection:"monsters"},
                {id:"damage",label:"Damage roll",type:"roll",roll:{groups:[{count:2,faces:6}],modifier:3}}],
    conditions:[],effects:[{record:"target",field:"damage_taken",op:"add",value:{input:"damage"}}],
    requireTurn:false,advanceTurn:false}
CONDITION{left:OPERAND,op:eq|neq|lt|lte|gt|gte|contains,right:OPERAND,message}
EFFECT{record:PARAM_ID,field:FIELD_ID,op:set|add,value:OPERAND}
CREATE{collection:COLLECTION_ID,values:{FIELD_ID:OPERAND}}
INVARIANT{id,collection,fields:[FIELD_ID 1..6],message}
EVIDENCE{sourceId:string<=100,quote:string<=500}
ROW{id,values:{FIELD_ID:VALUE}}
RECORDS: {COLLECTION_ID:[ROW<=100]}
TURNORDER: ("host"|"member-1"|...|"member-${MAX_TABLE_MEMBER_SEATS}")[<=${TABLE_LIMITS.turnOrder}]

OPERAND (ONLY in condition.left/right, effect.value and create.values; never a raw AST):
  {literal:VALUE} | {input:PARAM_ID} | {record:PARAM_ID,field:FIELD_ID} | {system:"actor"|"seat"|"turn"} | {expression:EXPR}

EXPR (typed data-only AST; used inside {expression}, view values, control values and scene geometry):
  {op:"literal",value} | {op:"input",id} | {op:"selectedField",parameter,field} | {op:"recordField",collection,recordId,field}
  | {op:"system",value:actor|seat|turn} | {op:"variable",name} | {op:"field",record,field} | {op:"collection",id}
  | {op:"if",test,then,otherwise} | {op:"math",fn,args} | {op:"compare",fn,left,right} | {op:"logic",fn,values} | {op:"not",value}
  | {op:"map",source,as,value} | {op:"filter",source,as,where} | {op:"reduce",source,as,accumulator,initial,value}
  | {op:"aggregate",source,fn,as?,where?,value?}
  math.fn = add|subtract|multiply|divide|remainder|power|min|max|abs|sqrt|sin|cos|tan|asin|acos|atan|floor|ceil|round;
  compare.fn = eq|neq|lt|lte|gt|gte|contains; logic.fn = and|or; aggregate.fn = count|sum|mean|min|max.
  args/values = EXPR[1..200]. ARITY: add/subtract/multiply/divide/remainder/power exactly 2; abs/sqrt/sin/cos/tan/asin/acos/atan/floor/ceil/round exactly 1; min/max >=2.
  EXPR literal list arrays may hold up to 200 items.

CANVAS{version:1,views:VIEW[<=12]}
VIEW = SCENE | CHART | METRIC | CONTROLS; every view is {id,kind,title,relatedTo?{views?:ID[<=12],collections?:ID[<=6]}}.
SCENE{id,kind:"scene",title,width:number>0<=4096,height:number>0<=4096,elements:PRIM[<=128]}
CHART{id,kind:"chart",title,chart:bar|line|scatter,collection:COLLECTION_ID,categoryField:FIELD_ID,value:EXPR,color?:PAINT}
METRIC{id,kind:"metric",title,value:EXPR,format?:number|percent|text}
CONTROLS{id,kind:"controls",title,controls:CONTROL[<=24]}
PRIM (every primitive also has id, optional fill?/stroke?:PAINT, optional drag?) =
  rect{shape:"rect",x,y,width,height,rx?} | circle{shape:"circle",cx,cy,r} | line{shape:"line",x1,y1,x2,y2}
  | polygon{shape:"polygon",points:[{x,y} 3..64]} | text{shape:"text",x,y,text:string|EXPR,fontSize?}
  Geometry values are number or EXPR (raw, never {expression:...}); PAINT = "none" or "#" + 3..8 hex digits.
MOTION (optional on rect/circle/text only; never together with drag):
  {axis:"x"|"y",from:number|EXPR,to:number|EXPR,speed:number|EXPR,loop?:boolean}
  The host animates the axis from from to to at speed scene units per second and resets at to (loop default true);
  geometry on that axis is ignored while motion is present. speed must be >0. Use it for a car that keeps driving a track.
DRAG{actionId,xParameter,yParameter?,inputs:BINDINGS}
CONTROL (each: id,label,actionId,inputs:BINDINGS) =
  button{kind:"button"} | form{kind:"form"} | slider{kind:"slider",parameter,min,max,step?,value?:EXPR}
  | toggle{kind:"toggle",parameter,value?:EXPR} | select{kind:"select",parameter,options:[{label,value:string|number|boolean} 1..32],value?:EXPR}
BINDINGS: {PARAM_ID: {kind:"control"} | {kind:"literal",value:VALUE} | {kind:"expression",value:EXPR} | {kind:"record",collection:COLLECTION_ID,recordId:ID}}
  Every action parameter must be covered; the parameter a slider/toggle/select edits binds {kind:"control"}.`;
