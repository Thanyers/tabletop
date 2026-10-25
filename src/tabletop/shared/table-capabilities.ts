import { GENERATIVE_LIMITS } from './generative-contracts';
import { MAX_COMPUTED_COLUMNS } from './computed-columns';
import { MAX_TABLE_SOURCES, TABLE_FILE_BYTES, TABLE_TOTAL_SOURCE_BYTES } from './table-source-limits';
import { generativeViewKindListSentence } from './view-kinds';

export interface CapabilityItem { id: string; title: string; detail: string }

/** Caps that match the server schemas; shown to users so they can plan within them (F019). */
export const TABLE_CAPABILITY_LIMITS = {
  collections: 6,
  fieldsPerCollection: 12,
  actions: 16,
  rowsPerCollection: 100,
  rowsPerTable: 200,
  files: MAX_TABLE_SOURCES,
  fileBytes: TABLE_FILE_BYTES,
  sourceBytes: TABLE_TOTAL_SOURCE_BYTES,
  computedColumns: MAX_COMPUTED_COLUMNS,
  canvasViews: GENERATIVE_LIMITS.canvasViews,
} as const;

/** What the table runtime supports today, and what it deliberately does not (F019). */
export const TABLE_CAPABILITIES: { supported: CapabilityItem[]; gaps: CapabilityItem[] } = {
  supported: [
    { id: 'collections', title: 'Collections and typed fields', detail: 'Text, number, boolean and list fields; up to 6 collections with 12 fields each.' },
    { id: 'actions', title: 'Actions with conditions and effects', detail: 'Owner/participant roles, optional turns, set/add effects and up to 12 created rows per action.' },
    { id: 'creates', title: 'Forms and buttons that add rows', detail: 'Typed creates validate on the server before anything is committed.' },
    { id: 'import', title: 'Import rows from CSV or Excel', detail: 'Owner previews CSV or the first Excel sheet, then appends or confirms replacement; all-or-nothing with typed checks.' },
    { id: 'computed', title: 'Computed columns', detail: 'Row formulas over number fields (+ − × ÷ field or number), up to 6 per table.' },
    { id: 'compute', title: 'Reusable calculations', detail: 'Typed inputs and outputs connect saved calculation modules to cards and other modules. Available engines depend on the host configuration.' },
    { id: 'canvas', title: 'Canvas views', detail: `${generativeViewKindListSentence()} descriptors; up to ${GENERATIVE_LIMITS.canvasViews} views, kept when rules evolve.` },
    { id: 'files', title: 'Shared source files', detail: 'Up to 4 UTF-8 files (32 KiB each, 64 KiB total) visible to invited members.' },
    { id: 'live', title: 'Live collaboration', detail: 'Shared card layout, live cursors, private chat answers and AI consent once per table.' },
  ],
  gaps: [
    { id: 'joins', title: 'Stored relations between collections', detail: 'There is no persistent relation field. Enabled calculation modules can join collection inputs and return a derived table.' },
    { id: 'schema', title: 'Destructive schema edits', detail: 'AI rule edits cannot remove collections, fields or invariants that hold data. Remove a collection or check by hand from the Rules card; fields cannot be removed.' },
    { id: 'media', title: 'Image, audio or 3D generation', detail: 'The provider returns data and canvas descriptors only.' },
    { id: 'simulation', title: 'Shared simulation clock', detail: 'Scene expressions update with state; there is no continuous real-time simulation.' },
    { id: 'capability-builder', title: 'Additional engines and packages', detail: 'Calculation modules use only the engines and offline libraries enabled by the host. They cannot install packages or call external services.' },
  ],
};

/** Compact payload for `/api/capabilities`; ids keep the response small. */
export function tableCapabilitySummary() {
  return {
    supported: TABLE_CAPABILITIES.supported.map((item) => item.id),
    gaps: TABLE_CAPABILITIES.gaps.map((item) => item.id),
    limits: TABLE_CAPABILITY_LIMITS,
  };
}
