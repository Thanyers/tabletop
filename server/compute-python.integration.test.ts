import { describe, expect, it } from 'vitest';
import { createNodeComputeRunner } from './compute-runner.js';
import { validateComputeOutputs, type ComputeModule, type ComputeRunnerRequest } from '../src/tabletop/shared/table-compute.js';

const module: ComputeModule = {
  id: 'sales-summary', name: 'Prepare sales report', description: 'Clean sales rows and summarize each branch.',
  version: 1, runtime: 'python', runtimeProfile: 'tabletop-compute-1',
  source: `import pandas as pd
def compute(inputs):
    df = pd.DataFrame(inputs["orders"]["rows"])
    df["branch"] = df["branch"].str.strip()
    df["amount"] = pd.to_numeric(df["amount"], errors="raise")
    df["quantity"] = pd.to_numeric(df["quantity"], errors="raise")
    df = df.drop_duplicates(subset=["order_id"])
    df = df[df["quantity"] > 0]
    df["gross"] = df["amount"] * df["quantity"]
    df["net"] = (df["gross"] * (1-inputs["discount"])).round(2)
    grouped = df.groupby("branch", as_index=False)["net"].sum().sort_values("branch")
    return {"total": float(grouped["net"].sum()), "summary": {"columns":[{"id":"branch","label":"Branch","type":"text"},{"id":"net","label":"Net sales","type":"number"}], "rows":grouped.to_dict(orient="records")}}
`,
  inputs: [], outputs: [
    { id: 'total', label: 'Total', type: 'number' },
    { id: 'summary', label: 'Sales by branch', type: 'table', columns: [{ id: 'branch', label: 'Branch', type: 'text' }, { id: 'net', label: 'Net sales', type: 'number' }] },
  ],
};

function request(amount: number): ComputeRunnerRequest {
  return { moduleId: module.id, moduleVersion: module.version, runtime: module.runtime, runtimeProfile: 'tabletop-compute-1', source: module.source, outputs: module.outputs,
    inputs: {
      discount: { type: 'number', value: 0.1 },
      orders: { type: 'table', value: { columns: [
        { id: 'order_id', label: 'Order', type: 'text' }, { id: 'branch', label: 'Branch', type: 'text' },
        { id: 'amount', label: 'Amount', type: 'number' }, { id: 'quantity', label: 'Quantity', type: 'number' },
      ], rows: [ { order_id: 'a', branch: ' BKK ', amount, quantity: 2 }, { order_id: 'b', branch: 'CNX', amount: 50, quantity: 1 } ] } },
    },
  };
}

describe.runIf(process.env.TABLETOP_COMPUTE_DOCKER_TEST === '1')('real isolated Python image', () => {
  it('reuses the same pandas program for two datasets and validates typed table/scalar outputs', async () => {
    const runner = createNodeComputeRunner();
    const first = validateComputeOutputs(module, await runner.run(request(100)));
    const second = validateComputeOutputs(module, await runner.run(request(200)));
    expect(first.outputs.total).toBe(225);
    expect(second.outputs.total).toBe(405);
    expect(first.outputs.summary).toMatchObject({ rows: [{ branch: 'BKK', net: 180 }, { branch: 'CNX', net: 45 }] });
  }, 60_000);
  it('has standard workbook libraries ready without runtime installation', async () => {
    const result = await createNodeComputeRunner().run({ ...request(1), source: `import io, pandas as pd, numpy as np, scipy, openpyxl
def compute(inputs):
    buffer = io.BytesIO()
    pd.DataFrame({"value":[7,8]}).to_excel(buffer, index=False, engine="openpyxl")
    buffer.seek(0)
    return {"total":float(pd.read_excel(buffer, engine="openpyxl")["value"].sum())}
`, outputs: [module.outputs[0]] });
    expect(result.outputs.total).toBe(15);
  });
  it('has no network or host credential environment', async () => {
    const result = await createNodeComputeRunner().run({ ...request(1), source: `import os, socket
def compute(inputs):
    assert not os.environ.get("DEEPSEEK_KEY")
    try:
        socket.create_connection(("1.1.1.1",443), timeout=1)
        return {"total":0}
    except OSError:
        return {"total":1}
`, outputs: [module.outputs[0]] });
    expect(result.outputs.total).toBe(1);
  });
  it('discards noisy generated output while retaining the typed return value', async () => {
    const result = await createNodeComputeRunner().run({ ...request(1), source: `def compute(inputs):
    for i in range(64): print("x" * 1000000)
    return {"total":7}
`, outputs: [module.outputs[0]] });
    expect(result.outputs.total).toBe(7);
  });
});
