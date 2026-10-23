/** The generator chooses only runtimes and packages that the execution image supplies. */
export const COMPUTE_RUNTIME_PROFILE = 'tabletop-compute-1';
export const COMPUTE_EXECUTION_TIMEOUT_MS = 30_000;
export const COMPUTE_WIRE_BYTES = 512 * 1024;
export interface ComputeRuntimeCapabilities {
  profile: typeof COMPUTE_RUNTIME_PROFILE;
  runtimes: Array<'javascript' | 'python'>;
  pythonLibraries: string[];
}
export const COMPUTE_RUNTIME_PROFILES = {
  javascript: { name: 'JavaScript', libraries: ['ECMAScript standard library'], entrypoint: 'export default function compute(inputs) { return { outputId: value }; }' },
  python: { name: 'Python', libraries: ['Python standard library', 'pandas 2.3.3', 'numpy 2.3.4', 'scipy 1.16.3', 'openpyxl 3.1.5', 'python-dateutil 2.9.0.post0'], entrypoint: 'def compute(inputs):\n    return {"outputId": value}' },
} as const;

export const COMPUTE_GENERATION_POLICY = `REUSABLE COMPUTE (${COMPUTE_RUNTIME_PROFILE}):
The request's computeCapabilities lists the engines actually enabled on this host. Choose ONLY one of those runtimes; if capabilities are absent use expressions only. A runtime listed below is a possible engine, not evidence that it is enabled. Choose the smallest suitable engine by operations, dependencies and expected workload, not a row-count guess alone.
1. Use existing bounded EXPR/formulas for arithmetic, conditions, simple map/filter/reduce/aggregate. They update without a code runner.
2. Use javascript for custom lightweight algorithms, game logic and transformations needing only standard ECMAScript. No npm imports.
3. Use python for multi-step tabular cleaning, joins, grouped analysis, statistics or workbook preparation. Available offline: ${COMPUTE_RUNTIME_PROFILES.python.libraries.join(', ')}.
The execution image has those packages preinstalled. Never pip/npm install at run time, fetch dependencies, access credentials or call external services. Do not invent support for other runtimes or libraries.
Generate reusable code once; later input changes run the accepted code without asking AI. Keep module IDs, versions and port IDs stable when editing unaffected behavior. A module may have helper functions and multiple named outputs used by several cards.
JavaScript entrypoint: ${COMPUTE_RUNTIME_PROFILES.javascript.entrypoint}
Python entrypoint: ${COMPUTE_RUNTIME_PROFILES.python.entrypoint}
Both return an object keyed by declared output IDs. Return plain finite JSON values; pandas DataFrames become {columns:[{id,label,type}],rows:df.to_dict(orient="records")}. Never return HTML or executable output.
Declare every input's type and explicit binding to real collection/source/literal/upstream output. Numeric input must be numeric; never silently treat a missing value as zero. Do not invent collection/field/module IDs.
Declare every output's type and table column schema. Existing target collections must match that schema. Wire downstream consumers by stable output IDs; never copy a sample answer into a metric as if it were computed.
Avoid ambient clock, randomness and hidden mutable state. Actor/seat and input provenance must come from declared host bindings. Treat one run as stateless; room persistence belongs to the host.
Explain name, purpose, input sources, output destinations and runtime choice in language a non-programmer can understand. Do not claim tests or execution succeeded before host evidence exists.`;
