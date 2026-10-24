import assert from 'node:assert/strict';
import test from 'node:test';
import { collectChangedPaths, parseNameStatusZ, selectIntegrationGates } from './integration-gate-plan.mjs';

const baseSha = '1'.repeat(40);
const headSha = '2'.repeat(40);

test('selects the Worker startup gate for Worker, provider, shared contract, and runtime paths', () => {
  for (const [file, ui] of [
    ['cloudflare/index.ts', false],
    ['server/providers/deepseek.ts', false],
    ['src/tabletop/shared/contracts.ts', true],
    ['src/tabletop/domain/table.ts', true],
    ['src/tabletop/runtime/generative/evaluator.ts', false],
  ]) {
    assert.deepEqual(selectIntegrationGates([file]), {
      worker: true, ui, compute: false, compute_container: false,
    }, file);
  }
});

test('selects the focused F066 browser harness for composer and reference-routing paths', () => {
  for (const file of [
    'src/tabletop/ui/TableChat.tsx',
    'src/tabletop/ui/canvas-object-finder.ts',
    'src/tabletop/shared/table-contracts.ts',
    'tests/ui/f066-rules-browser.mjs',
  ]) {
    assert.equal(selectIntegrationGates([file]).ui, true, file);
  }
});

test('selects compute tests for compute code and Docker image paths', () => {
  for (const file of [
    'compute/Dockerfile',
    'server/table-compute-orchestrator.ts',
    'src/tabletop/shared/computed-formula.ts',
    'cloudflare/compute-runner.ts',
  ]) {
    assert.equal(selectIntegrationGates([file]).compute, true, file);
  }
  assert.deepEqual(selectIntegrationGates(['cloudflare/compute-runner.ts']), {
    worker: true, ui: false, compute: true, compute_container: false,
  });
  assert.equal(selectIntegrationGates(['compute/Dockerfile']).compute_container, true);
});

test('keeps ordinary documentation changes on the existing fast-check path', () => {
  assert.deepEqual(selectIntegrationGates(['docs/INTEGRATION_GATES.md', 'README.md']), {
    worker: false, ui: false, compute: false, compute_container: false,
  });
});

test('defaults unknown application paths and gate-plumbing changes to every added gate', () => {
  assert.deepEqual(selectIntegrationGates(['src/App.tsx']), {
    worker: true, ui: true, compute: true, compute_container: true,
  });
  assert.deepEqual(selectIntegrationGates(['.github/workflows/validate.yml']), {
    worker: true, ui: true, compute: true, compute_container: true,
  });
  assert.deepEqual(selectIntegrationGates(['scripts/integration-gate-plan.mjs']), {
    worker: true, ui: true, compute: true, compute_container: true,
  });
});

test('deletions remain selectable from their old path', () => {
  const paths = parseNameStatusZ(`D\0cloudflare/room.ts\0`);
  assert.deepEqual(paths, ['cloudflare/room.ts']);
  assert.deepEqual(selectIntegrationGates(paths), { worker: true, ui: false, compute: false, compute_container: false });
});

test('renames retain both old and new paths for gate selection', () => {
  const paths = parseNameStatusZ(`R100\0docs/old-name.md\0src/tabletop/ui/TableChat.tsx\0`);
  assert.deepEqual(paths, ['docs/old-name.md', 'src/tabletop/ui/TableChat.tsx']);
  assert.equal(selectIntegrationGates(paths).ui, true);

  const movedOut = parseNameStatusZ(`R100\0src/tabletop/shared/table-compute.ts\0docs/table-compute.md\0`);
  assert.deepEqual(selectIntegrationGates(movedOut), { worker: true, ui: true, compute: true, compute_container: false });
});

test('fails safe to all gates when the selector has no explicit usable paths', () => {
  for (const paths of [undefined, null, [], ['']]) {
    assert.deepEqual(selectIntegrationGates(paths), { worker: true, ui: true, compute: true, compute_container: true });
  }
});

test('rejects malformed git name-status output instead of treating it as an empty change', () => {
  assert.throws(() => parseNameStatusZ('R100\0only-one-name\0'), /incomplete/u);
  assert.throws(() => parseNameStatusZ('not-a-status\0file.txt\0'), /unsupported/u);
});

test('diffs the explicit PR base and head commits', async () => {
  const calls = [];
  const git = async (args) => {
    calls.push(args);
    return args[0] === 'diff' ? 'M\0cloudflare/index.ts\0' : '';
  };

  assert.deepEqual(await collectChangedPaths({ baseSha, headSha, git }), ['cloudflare/index.ts']);
  assert.deepEqual(calls, [
    ['cat-file', '-e', `${baseSha}^{commit}`],
    ['cat-file', '-e', `${headSha}^{commit}`],
    ['diff', '--name-status', '-z', '--find-renames', `${baseSha}...${headSha}`],
  ]);
});

test('fails closed when the PR base commit is unavailable', async () => {
  await assert.rejects(
    collectChangedPaths({ baseSha, headSha, git: async () => { throw new Error('missing object'); } }),
    /PR base commit is unavailable/u,
  );
});

test('fails closed when the PR head or merge-base diff cannot be retrieved', async () => {
  let calls = 0;
  const missingHead = async () => {
    calls++;
    if (calls === 2) throw new Error('missing object');
    return '';
  };
  await assert.rejects(collectChangedPaths({ baseSha, headSha, git: missingHead }), /PR head commit is unavailable/u);

  const failingDiff = async (args) => {
    if (args[0] === 'diff') throw new Error('no merge base');
    return '';
  };
  await assert.rejects(collectChangedPaths({ baseSha, headSha, git: failingDiff }), /Could not compare/u);
});
