import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping';
import vinext from 'vinext';
import {
  attachFrameworkHookMaps,
  attachFrameworkMap,
  frameworkSourceMaps,
  verifyFrameworkSourceGuard,
} from '../tooling/framework-source-maps.mjs';

function locationOf(code, marker) {
  const offset = code.indexOf(marker);
  assert.ok(offset !== -1, `Missing fixture marker: ${marker}`);
  const lines = code.slice(0, offset).split('\n');
  return { line: lines.length, column: lines.at(-1).length };
}

function assertTraces(result, originalCode, source, markers) {
  const map = new TraceMap(result.map);
  assert.deepEqual(result.map.sourcesContent, [originalCode]);
  for (const marker of markers) {
    const traced = originalPositionFor(map, locationOf(result.code, marker));
    assert.equal(traced.source, source, marker);
    assert.equal(traced.line, locationOf(originalCode, marker).line, marker);
    assert.equal(traced.column, locationOf(originalCode, marker).column, marker);
  }
}

async function flattenPlugins(options) {
  const flattened = [];
  for (const option of Array.isArray(options) ? options : [options]) {
    const resolved = await option;
    if (Array.isArray(resolved)) flattened.push(...await flattenPlugins(resolved));
    else if (resolved) flattened.push(resolved);
  }
  return flattened;
}

test('only the exact audited stable framework source is accepted', () => {
  assert.doesNotThrow(() => verifyFrameworkSourceGuard());
  assert.throws(() => verifyFrameworkSourceGuard({
    readFile(path, ...args) {
      const content = readFileSync(path, ...args);
      return path.endsWith('/vinext/package.json') ? String(content).replace('"1.0.1"', '"1.0.2"') : content;
    },
  }), /source\/version changed/);
  assert.throws(() => verifyFrameworkSourceGuard({
    readFile(path, ...args) {
      const content = readFileSync(path, ...args);
      return path.endsWith('action-owner-manifest.js') ? `${content}\n// upstream changed\n` : content;
    },
  }), /source\/version changed/);
});

test('real pinned framework hooks retain byte-identical executable output and truthful maps', async () => {
  const plugins = await flattenPlugins(vinext());
  const context = { environment: { name: 'rsc', mode: 'build' } };
  const fixtures = [
    {
      plugin: 'rsc:inject-async-local-storage', hook: 'transform', source: '/fixture/original.js',
      code: 'const kind = typeof AsyncLocalStorage;\nconst store = new AsyncLocalStorage();\nexport const markerAfterPrefix = store;\n',
      markers: ['const kind', 'const store', 'markerAfterPrefix'],
    },
    ...[
      ['rsc:virtual:vite-rsc/assets-manifest', 'virtual:vite-rsc/assets-manifest'],
      ['vinext:action-owner-manifest', 'virtual:vinext-action-owner-manifest'],
    ].map(([plugin, token]) => ({
      plugin, hook: 'renderChunk', source: '_next/static/chunks/fixture.js',
      code: `import first from "${token}";\nconst markerBetweenReplacements = 1;\nimport second from "${token}";\nexport const markerAfterReplacements = [first, second];\n`,
      markers: ['import first', 'markerBetweenReplacements', 'import second', 'markerAfterReplacements'],
    })),
  ];
  const originals = fixtures.map((fixture) => {
    const plugin = plugins.find((entry) => entry.name === fixture.plugin);
    const hook = plugin[fixture.hook];
    const handler = typeof hook === 'function' ? hook : hook.handler;
    const args = [fixture.code, fixture.hook === 'transform' ? fixture.source : { fileName: fixture.source }];
    const result = handler.apply(context, args);
    return { fixture, plugin, hook, args, result };
  });

  attachFrameworkHookMaps(plugins);
  for (const { fixture, plugin, hook, args, result: before } of originals) {
    const patchedHook = plugin[fixture.hook];
    const after = await (typeof patchedHook === 'function' ? patchedHook : patchedHook.handler).apply(context, args);
    assert.equal(after.code, typeof before === 'string' ? before : before.code, fixture.plugin);
    assertTraces(after, fixture.code, fixture.source, fixture.markers);
    if (fixture.hook === 'transform') {
      assert.equal(originalPositionFor(new TraceMap(after.map), { line: 1, column: 0 }).source, null,
        'Injected prefix must not pretend to originate from application code');
      assert.deepEqual(patchedHook.filter, hook.filter, 'Hook filtering is preserved');
    }
  }
});

for (const token of ['virtual:vite-rsc/assets-manifest', 'virtual:vinext-action-owner-manifest']) {
  test(`manifest maps retain interior positions with adjacent/repeated ${token}`, () => {
    const source = 'chunk.js';
    const originalCode = `const markerBefore = "${token}${token}";\nconst markerMiddle = 1;\nconst end = "${token}";\nconst markerAfter = 2;`;
    const result = { code: originalCode.replaceAll(token, () => './relative-manifest.js'), meta: { retained: true } };
    const after = attachFrameworkMap({ kind: 'replaceAll', token, source, originalCode, result });
    assert.equal(after.code, result.code);
    assert.equal(after.meta, result.meta);
    assertTraces(after, originalCode, source, ['markerBefore', 'markerMiddle', 'const end', 'markerAfter']);
  });
}

test('unmodified, missing, or already mapped handler results are preserved', () => {
  const originalCode = 'export const marker = 1;';
  const unchanged = { code: originalCode };
  const existing = { code: 'already transformed', map: { mappings: 'AAAA' } };
  for (const result of [undefined, null, originalCode, unchanged, existing]) {
    assert.equal(attachFrameworkMap({ kind: 'prepend', source: 'fixture.js', originalCode, result }), result);
  }
});

test('unexpected prefix or edits outside manifest replacements fail closed', () => {
  assert.throws(() => attachFrameworkMap({
    kind: 'prepend', source: 'fixture.js', originalCode: 'original', result: 'unknown-prefixoriginal',
  }), /Revalidate/);
  assert.throws(() => attachFrameworkMap({
    kind: 'replaceAll', token: 'TOKEN', source: 'fixture.js', originalCode: 'TOKEN middle TOKEN',
    result: { code: 'path changed middle path' },
  }), /Revalidate/);
});

test('wrapper retains original hook context, arguments, metadata and object-hook options', () => {
  const originalCode = 'export const marker = 1;';
  const context = { marker: 'context' };
  const options = { ssr: true };
  const filter = { code: 'marker' };
  const meta = { untouched: true };
  let calls = 0;
  const plugins = [
    {
      name: 'rsc:inject-async-local-storage',
      transform: { order: 'post', filter, handler(code, id, actualOptions) {
        calls += 1;
        assert.equal(this, context);
        assert.equal(id, 'fixture.js');
        assert.equal(actualOptions, options);
        return { code, meta };
      } },
    },
    { name: 'rsc:virtual:vite-rsc/assets-manifest', renderChunk() {} },
    { name: 'vinext:action-owner-manifest', renderChunk() {} },
  ];
  attachFrameworkHookMaps(plugins);
  attachFrameworkHookMaps(plugins);
  const hook = plugins[0].transform;
  const result = hook.handler.call(context, originalCode, 'fixture.js', options);
  assert.equal(calls, 1);
  assert.equal(hook.filter, filter);
  assert.equal(hook.order, 'post');
  assert.equal(result.meta, meta);
});

test('missing or duplicate audited hooks require deliberate revalidation', () => {
  assert.throws(() => attachFrameworkHookMaps([]), /Expected one audited plugin/);
  assert.throws(() => attachFrameworkHookMaps([
    { name: 'rsc:inject-async-local-storage' }, { name: 'rsc:inject-async-local-storage' },
  ]), /Expected one audited plugin/);
});

test('adapter is build-only and never changes sourcemap or warning policy', () => {
  const plugin = frameworkSourceMaps();
  assert.equal(plugin.apply, 'build');
  assert.equal(plugin.config, undefined);
  assert.equal(plugin.onLog, undefined);
  assert.equal(plugin.renderChunk, undefined);
});
