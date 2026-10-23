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
import { GENERATIVE_LIMITS, type ControlsViewDescriptor } from '../../src/tabletop/shared/generative-contracts.js';
import { COMPUTE_GENERATION_POLICY } from '../../src/tabletop/shared/compute-runtime-profiles.js';

/**
 * F049: the exact dice control example embedded in the guide below.
 * The drafter may author `kind:"dice"` on a numeric parameter (client rolls it, visual-only)
 * or on a `roll` parameter (F060: the server rolls the program's roll spec and the card shows it).
 */
export const TABLE_DICE_EXAMPLE: ControlsViewDescriptor = {
  id: 'damage-die',
  kind: 'controls',
  title: 'Damage die',
  controls: [{
    id: 'damage-dice',
    kind: 'dice',
    label: 'Damage die',
    actionId: 'apply_damage',
    parameter: 'damage',
    faces: 6,
    count: 2,
    modifier: 1,
    inputs: {
      hero: { kind: 'record', collection: 'heroes', recordId: 'hero-1' },
      damage: { kind: 'control' },
    },
  }],
};
const TABLE_DICE_EXAMPLE_JSON = JSON.stringify(TABLE_DICE_EXAMPLE);

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

export const TABLE_SCHEMA_GUIDE = `TABLE-CHANGE COMPACT SCHEMA v1 (the app's validator is authoritative)

BUDGET: max_tokens=32768 for the single reply (reasoning tokens count toward it).
LIMITS: ${LIMITS}.
ID: /^[a-z][a-z0-9_-]{0,39}$/, never a JS builtin name (constructor, prototype, __proto__, toString, valueOf, hasOwnProperty, ...).
VALUE: string<=500 | number | boolean | null | string[] (<=32 items, each <=100 chars).
STRICT: every object below rejects unknown keys and requires exactly the keys listed; "?" marks an optional key. The root has exactly three keys; canvas is INSIDE program.

ROOT{kind:"table",program,initialRecords}
PROGRAM{version:1,title:<=100 chars,description,collections,actions,invariants,turnOrder,evidence,assumptions,canvas?,compute?}
COLLECTION{id,title,fields}
FIELD{id,label,type:text|number|boolean|list,required:boolean,min?,max?,choices?,default?}
  Only number fields take min/max (min<=max); only text fields take choices (1..32 strings, each<=100); default must satisfy type, choices and bounds.
ACTION{id,title,description,roles,parameters,conditions,effects,creates?,requireTurn:boolean,advanceTurn:boolean}
  roles = ("owner"|"participant")[1..2]; an action must set a field, create a row, or advanceTurn; requireTurn/advanceTurn need a non-empty turnOrder.
PARAM{id,label,type:text|number|boolean|record|roll,collection?,min?,max?,choices?,roll?}
  record params MUST have collection; only number params take min/max; only text params take choices.
  ROLL{groups:[{count:1..10,faces:2..100}] 1..4,modifier?:integer -1000..1000}
  A roll param carries exactly one roll spec (no collection/min/max/choices); total dice across groups <=20.
  The SERVER rolls it when a player presses roll; the client never sends that input. It is a number in
  OPERAND {input:ROLL_ID} (conditions/effects type-check against a number); at most ONE roll param per action.
  ATTACK EXAMPLE (damage_taken is a number field):
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

DERIVED: totals/shares/balances from rows go in a METRIC or CHART EXPR so they follow row changes.
  A CHART value runs per row as "row"; aggregates over other collections may filter on it.
  A no-input button saving fixed rows needs a condition refusing a 2nd press.

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
  The host moves that axis from "from" to "to" at speed scene units/s and resets at "to" (loop default true);
  that axis's geometry is ignored while moving; speed>0.
DRAG{actionId,xParameter,yParameter?,inputs:BINDINGS}
CONTROL (each: id,label,actionId,inputs:BINDINGS) =
  button{kind:"button"} | form{kind:"form"} | slider{kind:"slider",parameter,min,max,step?,value?:EXPR}
  | toggle{kind:"toggle",parameter,value?:EXPR} | select{kind:"select",parameter,options:[{label,value:string|number|boolean} 1..32],value?:EXPR}
  | dice{kind:"dice",parameter,faces:2..100,count:1..10,modifier?:integer -1000..1000}
BINDINGS: {PARAM_ID: {kind:"control"} | {kind:"literal",value:VALUE} | {kind:"expression",value:EXPR} | {kind:"record",collection:COLLECTION_ID,recordId:ID}}
  Every action parameter must be covered; the parameter a slider/toggle/select/dice edits binds {kind:"control"}.
DICE: dice must bind one number PARAM or one roll PARAM (faces/count whole numbers in range; modifier optional whole number).
  Number PARAM: the client rolls count d faces + modifier (visual-only) and fills it for other cards.
  Roll PARAM: faces/count are only validated display defaults; the SERVER rolls the parameter's roll spec, the card
  shows those faces and total, and the action sends no value.
  EXAMPLE (one controls view; the same action also has a form on another view covering every input):
  ${TABLE_DICE_EXAMPLE_JSON}`;

export const TABLE_COMPUTE_SCHEMA_GUIDE = `${COMPUTE_GENERATION_POLICY}

COMPUTE (optional inside PROGRAM): {version:1,modules:MODULE[<=12]}
MODULE{id,name,description,runtime:"javascript"|"python",version:positive integer,source:string<=24576,inputs:INPUT_PORT[<=8],outputs:OUTPUT_PORT[1..8]}
INPUT_PORT{id,label,type:"text"|"number"|"boolean"|"text-list"|"table",binding:INPUT_BINDING}
INPUT_BINDING = {kind:"literal",value:scalar} | {kind:"collection",collectionId:COLLECTION_ID}
  | {kind:"source",sourceId:SOURCE_ID} | {kind:"result",moduleId:MODULE_ID,outputId:OUTPUT_ID}
  | {kind:"actor",property:"role"|"seat"} | {kind:"provenance",property:"dataRevision"|"sourceIds"}
OUTPUT_PORT{id,label,type:"text"|"number"|"boolean"|"text-list"|"table",columns?:COLUMN[],collectionId?:COLLECTION_ID}
COLUMN{id,label,type:"text"|"number"|"boolean"|"list"}
Only table outputs declare columns (required) and an optional existing collectionId (its fields must exactly match).
A collection binding passes {columns:[COLUMN],rows:[{FIELD_ID:VALUE}]} as inputs.PORT_ID. Source binding passes UTF-8 text.
Literal bindings are scalar. Result bindings must match the upstream declared output type. Dependencies must be acyclic.
Generated code returns {OUTPUT_ID: scalar or {columns:[COLUMN],rows:[{FIELD_ID:VALUE}]}}; use exact declared IDs and types.
The host runs modules after activation or bound input changes and validates outputs. Linked collection cards display derived output without overwriting source rows.
For a metric or scalar expression, use {op:"computeResult",moduleId:MODULE_ID,outputId:OUTPUT_ID}. This reads a current validated text/number/boolean output; a pending or stale result is null. Bind table consumers to the declared collectionId or a result input port. Do not bake a sample result into a literal.
Program actions may be [] when at least one compute module is present. Collections remain required; declared output collections start empty.
Keep compute code, definitions and connections when editing unrelated parts of an existing table.`;
