import assert from 'node:assert/strict';
import test from 'node:test';
import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping';
import { build } from 'vite';
import { normalizeRootLayoutImport, rootLayoutEntryId } from '../tooling/root-layout-import.mjs';

const layoutPath = '/fixture/app/layout.tsx';
const source = `const load_1 = () => import(${JSON.stringify(layoutPath)});
import * as mod_0 from ${JSON.stringify(layoutPath)};
export const eager = mod_0;
export const load = load_1;
export function probe() { return 'cycle-ok'; }
`;
const options = { audited: true, layoutPath };

test('root layout reuses its existing namespace with a truthful map and exact async chain', () => {
  const result = normalizeRootLayoutImport(source, rootLayoutEntryId, options);
  assert.ok(result);
  assert.equal(result.code, source.replace(
    `() => import(${JSON.stringify(layoutPath)})`,
    '() => Promise.resolve().then(() => mod_0)',
  ));
  assert.equal((result.code.match(/^import /gm) ?? []).length, 1, 'no new static import');
  assert.deepEqual(result.map.sourcesContent, [source]);
  const marker = 'export const eager';
  const line = result.code.slice(0, result.code.indexOf(marker)).split('\n').length;
  assert.deepEqual(originalPositionFor(new TraceMap(result.map), { line, column: 0 }), {
    source: rootLayoutEntryId, line: 3, column: 0, name: null,
  });
});

test('root layout preserves the original import whenever the audit or generated shape changes', () => {
  const cases = [
    [source, rootLayoutEntryId, { layoutPath }],
    [source, rootLayoutEntryId, { ...options, audited: false }],
    [source, 'virtual:vinext-rsc-entry', options],
    [source, rootLayoutEntryId, { ...options, layoutPath: '/other/app/layout.tsx' }],
    [source.replace('import * as mod_0', 'import mod_0'), rootLayoutEntryId, options],
    [source.replace('import * as mod_0', 'let mod_0; //'), rootLayoutEntryId, options],
    [source.replace('() => import(', 'async () => import('), rootLayoutEntryId, options],
    [source.replace('mod_0 from', 'mod_0 from\n'), rootLayoutEntryId, options],
    [`${source}const extra = () => import(${JSON.stringify(layoutPath)});\n`, rootLayoutEntryId, options],
    [`${source}const mod_0 = {};\n`, rootLayoutEntryId, options],
    [`${source}const Promise = {};\n`, rootLayoutEntryId, options],
    [`${source}import Promise from 'other';\n`, rootLayoutEntryId, options],
  ];
  for (const args of cases) assert.equal(normalizeRootLayoutImport(...args), null);
});

async function compile(entry, layout, expectedDuplicateWarnings) {
  const duplicateWarnings = [];
  const unexpectedWarnings = [];
  const result = await build({
    configFile: false,
    logLevel: 'warn',
    plugins: [{
      name: 'root-layout-regression-fixture',
      resolveId(id) { return [rootLayoutEntryId, layoutPath].includes(id) ? id : null; },
      load(id) { return id === rootLayoutEntryId ? entry : id === layoutPath ? layout : null; },
    }],
    build: {
      ssr: true,
      write: false,
      target: 'esnext',
      minify: false,
      rolldownOptions: {
        input: rootLayoutEntryId,
        preserveEntrySignatures: 'strict',
        // TEST ONLY: these fixtures deliberately create the warning under test.
        // Assert its exact count; print and fail every unexpected diagnostic.
        onLog(level, log, defaultHandler) {
          if (level === 'warn' && log.code === 'INEFFECTIVE_DYNAMIC_IMPORT'
            && log.message.includes('fixture/app/layout.tsx')) {
            duplicateWarnings.push(log);
            return;
          }
          if (level === 'warn' || level === 'error') unexpectedWarnings.push(log);
          defaultHandler(level, log);
        },
      },
    },
  });
  assert.ok(!Array.isArray(result) && 'output' in result);
  assert.deepEqual(unexpectedWarnings, []);
  assert.equal(duplicateWarnings.length, expectedDuplicateWarnings, 'expected fixture warning count');
  return result.output.filter(chunk => chunk.type === 'chunk');
}

for (const [name, layout] of [
  ['live exports', 'export let value=0; export const bump=()=>++value; export default "root";'],
  ['initialization failure', 'throw new Error("layout-initialization-failed"); export let value=0; export const bump=()=>++value;'],
  ['ordinary cycle', `import {probe} from ${JSON.stringify(rootLayoutEntryId)}; export let value=0; export const bump=()=>++value; export const cyclic=()=>probe();`],
]) {
  test(`root-layout compiler and runtime equivalence: ${name}`, async () => {
    const normalized = normalizeRootLayoutImport(source, rootLayoutEntryId, options);
    assert.ok(normalized);
    const before = await compile(source, layout, 1);
    const after = await compile(normalized.code, layout, 0);
    assert.equal(before.length, 1);
    assert.equal(after.length, 1);
    assert.equal(before[0].code, after[0].code, 'entire compiled executable is identical');
    const observations = [];
    for (const [index, chunk] of [before[0], after[0]].entries()) {
      const url = `data:text/javascript;base64,${Buffer.from(chunk.code).toString('base64')}#${encodeURIComponent(name)}-${index}`;
      if (name === 'initialization failure') {
        await assert.rejects(import(url), /layout-initialization-failed/);
        continue;
      }
      const mod = await import(url);
      const events = [];
      const promise = mod.load();
      promise.then(() => events.push('load'));
      queueMicrotask(() => events.push('queued'));
      events.push('sync');
      const loaded = await promise;
      assert.equal(loaded, mod.eager, 'namespace identity is retained');
      const value = loaded.value;
      mod.eager.bump();
      assert.equal(loaded.value, value + 1, 'namespace export remains live');
      assert.deepEqual(events, ['sync', 'queued', 'load']);
      observations.push({ events, value: loaded.value, cycle: loaded.cyclic?.() });
    }
    assert.deepEqual(observations[0], observations[1]);
  });
}

test('top-level-await layout changes fall back instead of removing the compiler initialization boundary', async () => {
  const layout = 'export let value=0; await Promise.resolve(); value=7; export const bump=()=>++value;';
  // The shared plugin fingerprints the actual app tree. A changed layout means
  // audited=false, never a rewrite based only on the duplicate-import shape.
  const normalized = normalizeRootLayoutImport(source, rootLayoutEntryId, { ...options, audited: false });
  assert.equal(normalized, null);
  const baseline = await compile(source, layout, 0);
  const fallback = await compile(normalized?.code ?? source, layout, 0);
  assert.deepEqual(baseline.map(chunk => chunk.code), fallback.map(chunk => chunk.code));
  assert.ok(baseline.length > 1, 'TLA actually retains separate async initialization chunks');
});
