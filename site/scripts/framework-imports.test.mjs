import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test, { mock } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import audit from '../tooling/framework-imports.audit.json' with { type: 'json' };
import { auditedBuildInputs, auditedEnvironment, clientReferencesId, frameworkImports,
  normalizeDefaultErrorReference, runtimeInputFingerprint } from '../tooling/framework-imports.mjs';
import { rootLayoutEntryId } from '../tooling/root-layout-import.mjs';

const siteRoot = fileURLToPath(new URL('../', import.meta.url));
const targetPath = '/fixture/node_modules/vinext/dist/shims/default-global-error.js';
const source = `export default {
  "default": async () => {
    const m = await import(${JSON.stringify(targetPath)});
    return { get default() { return m.default; } };
  },
  "admin": async () => import("/fixture/lazy-admin.js"),
};
`;
const production = { command: 'build', mode: 'production' };

function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'inventory-import-audit-')));
  for (const path of audit.inputs) {
    fs.mkdirSync(dirname(join(root, path)), { recursive: true });
    fs.writeFileSync(join(root, path), `// ${path}\n`);
  }
  return { root, record: { ...audit, runtimeFingerprint: runtimeInputFingerprint(root) } };
}

test('metadata audit rejects unknown nested inputs BEFORE any file contents are read', () => {
  for (const path of ['app/data/page.tsx', 'app/out/page.tsx', 'src/outputs/feature.ts', 'lib/secrets/private.json', 'src/assets/private.json']) {
    const { root, record } = fixture();
    try {
      fs.mkdirSync(dirname(join(root, path)), { recursive: true });
      fs.writeFileSync(join(root, path), 'not-to-be-read');
      let reads = 0;
      const original = fs.readFileSync;
      const stub = mock.method(fs, 'readFileSync', (...args) => { reads += 1; return original(...args); });
      syncBuiltinESMExports();
      try { assert.equal(auditedBuildInputs(root, production, {}, record), false); assert.equal(reads, 0); }
      finally { stub.mock.restore(); syncBuiltinESMExports(); }
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  }
});

test('fingerprint detects file edits/deletion and rejects root/config symlinks and read failures', () => {
  const { root, record } = fixture();
  try {
    assert.equal(auditedBuildInputs(root, production, {}, record), true);
    const path = join(root, 'app/layout.tsx');
    const original = fs.readFileSync(path);
    fs.appendFileSync(path, 'await Promise.resolve();');
    assert.equal(auditedBuildInputs(root, production, {}, record), false);
    fs.writeFileSync(path, original);
    fs.rmSync(path);
    assert.equal(auditedBuildInputs(root, production, {}, record), false);
    fs.writeFileSync(path, original);
    fs.renameSync(join(root, 'lib'), join(root, 'lib-original'));
    fs.symlinkSync(join(root, 'lib-original'), join(root, 'lib'), 'dir');
    assert.equal(auditedBuildInputs(root, production, {}, record), false);
    fs.unlinkSync(join(root, 'lib'));
    fs.renameSync(join(root, 'lib-original'), join(root, 'lib'));
    fs.renameSync(join(root, 'vite.config.ts'), join(root, 'vite-original'));
    fs.symlinkSync(join(root, 'vite-original'), join(root, 'vite.config.ts'), 'file');
    assert.equal(auditedBuildInputs(root, production, {}, record), false);
    fs.unlinkSync(join(root, 'vite.config.ts'));
    fs.renameSync(join(root, 'vite-original'), join(root, 'vite.config.ts'));
    const stub = mock.method(fs, 'readFileSync', () => { throw new Error('read denied'); });
    syncBuiltinESMExports();
    try { assert.equal(auditedBuildInputs(root, production, {}, record), false); }
    finally { stub.mock.restore(); syncBuiltinESMExports(); }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('watch, unknown environment/compiler/source versions and dotenv presence use original imports', () => {
  const { root, record } = fixture();
  try {
    assert.equal(auditedBuildInputs(root, { ...production, build: { watch: {} } }, {}, record), false);
    assert.equal(auditedBuildInputs(root, production, { NEXT_PUBLIC_UNKNOWN: '1' }, record), false);
    assert.equal(auditedEnvironment({}, ['--conditions=react-server']), false);
    assert.equal(auditedEnvironment({ NAPI_RS_NATIVE_LIBRARY_PATH: '/other/compiler' }, []), false);
    for (const name of ['vite', 'rolldown', 'react', 'vinext']) {
      const changed = { ...record, packages: record.packages.map((pkg) => pkg.name === name ? { ...pkg, version: '0.0.0' } : pkg) };
      assert.equal(auditedBuildInputs(root, production, {}, changed), false);
    }
    const changed = structuredClone(record);
    changed.packages[0].files['dist/shims/default-global-error.js'] = 'changed';
    assert.equal(auditedBuildInputs(root, production, {}, changed), false);
    fs.writeFileSync(join(root, '.env.production'), 'not-to-be-read');
    assert.equal(auditedBuildInputs(root, production, {}, record), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('default-only normalizer preserves all unrelated lazy loaders and the exact then microtask', () => {
  const result = normalizeDefaultErrorReference(source, clientReferencesId, { audited: true, targetPath });
  assert.ok(result);
  assert.match(result.code, /await Promise\.resolve\(\)\.then\(\(\) => __smart_inventory_default_error\)/);
  assert.ok(result.code.includes('"admin": async () => import("/fixture/lazy-admin.js")'));
  assert.ok(result.code.includes('return { get default() { return m.default; } };'));
  assert.deepEqual(result.map.sourcesContent, [source]);
  assert.equal(normalizeDefaultErrorReference(source, clientReferencesId, { targetPath }), null);
  assert.equal(normalizeDefaultErrorReference(source, clientReferencesId, { audited: true, targetPath: targetPath.replace('default-global-error', 'slot') }), null);
  assert.equal(normalizeDefaultErrorReference(source.replace('const m = ', 'const changed = '), clientReferencesId, { audited: true, targetPath }), null);
});

async function compile(referenceCode, targetSource) {
  const entry = '\0default-error-entry';
  const expectedWarnings = referenceCode.includes(`await import(${JSON.stringify(targetPath)})`) ? 1 : 0;
  const warnings = [];
  const result = await build({ configFile: false, logLevel: 'warn', plugins: [{
    name: 'default-error-compiler-fixture',
    resolveId(id) { return [entry, clientReferencesId, targetPath, '/fixture/lazy-admin.js'].includes(id) ? id : null; },
    load(id) {
      if (id === entry) return `import eager from ${JSON.stringify(targetPath)}; import refs from ${JSON.stringify(clientReferencesId)}; export {eager,refs};`;
      if (id === clientReferencesId) return referenceCode;
      if (id === targetPath) return targetSource;
      if (id === '/fixture/lazy-admin.js') return 'export default "lazy-admin";';
    },
  }], build: { ssr: true, write: false, target: 'esnext', minify: false,
    rolldownOptions: { input: entry, preserveEntrySignatures: 'strict',
      onLog(level, log, defaultHandler) {
        if (level === 'warn' && log.code === 'INEFFECTIVE_DYNAMIC_IMPORT' && log.message.includes('default-global-error.js')) warnings.push(log);
        else {
          defaultHandler(level, log);
          if (level === 'warn') throw new Error(`Unexpected compiler fixture warning: ${log.code}`);
        }
      },
    } } });
  assert.equal(warnings.length, expectedWarnings, 'test-only diagnostic capture must prove 1→0');
  return result.output.filter((chunk) => chunk.type === 'chunk');
}

test('default error compiler keeps entire code/order and async/live-object/error contracts identical', async () => {
  const normalized = normalizeDefaultErrorReference(source, clientReferencesId, { audited: true, targetPath });
  for (const [label, target] of [['ordinary', 'export default { value:0, bump() { this.value++; } };'],
    ['failure', 'throw new Error("default-init-failure"); export default null;']]) {
    const before = await compile(source, target);
    const after = await compile(normalized.code, target);
    assert.deepEqual(before.map((chunk) => chunk.code), after.map((chunk) => chunk.code));
    const entries = before.filter((chunk) => chunk.isEntry);
    assert.equal(entries.length, 1);
    if (label === 'failure') await assert.rejects(import(`data:text/javascript;base64,${Buffer.from(entries[0].code).toString('base64')}#failure`), /default-init-failure/);
    else {
      const mod = await import(`data:text/javascript;base64,${Buffer.from(entries[0].code).toString('base64')}#ordinary`);
      const events = [];
      const pending = mod.refs.default();
      Promise.resolve().then(() => events.push('tick1')).then(() => events.push('tick2'));
      pending.then(() => events.push('loaded'));
      const loaded = await pending;
      assert.deepEqual(events, ['tick1', 'tick2', 'loaded']);
      assert.equal(loaded.default, mod.eager);
      loaded.default.bump(); assert.equal(mod.eager.value, 1);
    }
  }
});

test('whole shared plugin applies only audited RSC/SSR targets and rechecks source drift/watch', () => {
  const { root, record } = fixture();
  const plugin = frameworkImports({ auditRecord: record });
  plugin.configResolved({ ...production, root });
  const actualTarget = join(siteRoot, 'node_modules/vinext/dist/shims/default-global-error.js');
  const actualSource = source.replaceAll(targetPath, actualTarget);
  const transform = plugin.transform.handler;
  assert.ok(transform.call({ environment: { name: 'ssr' } }, actualSource, clientReferencesId));
  assert.equal(transform.call({ environment: { name: 'client' } }, actualSource, clientReferencesId), null);
  const layoutPath = join(root, 'app/layout.tsx');
  const layout = `const load_1 = () => import(${JSON.stringify(layoutPath)});\nimport * as mod_0 from ${JSON.stringify(layoutPath)};\n`;
  assert.ok(transform.call({ environment: { name: 'rsc' } }, layout, rootLayoutEntryId));
  try {
    const fallback = frameworkImports({ auditRecord: record }); fallback.configResolved({ ...production, root });
    assert.ok(fallback.transform.handler.call({ environment: { name: 'ssr' } }, actualSource, clientReferencesId));
    const clonedLayoutPath = join(root, 'app/layout.tsx');
    const clonedLayout = layout.replaceAll(layoutPath, clonedLayoutPath);
    const original = fs.readFileSync(clonedLayoutPath);
    assert.ok(fallback.transform.handler.call({ environment: { name: 'rsc' } }, clonedLayout, rootLayoutEntryId));
    fs.appendFileSync(join(root, 'app/layout.tsx'), 'await Promise.resolve();');
    assert.equal(fallback.transform.handler.call({ environment: { name: 'rsc' } }, clonedLayout, rootLayoutEntryId), null);
    fs.writeFileSync(clonedLayoutPath, original);
    assert.ok(fallback.transform.handler.call({ environment: { name: 'rsc' } }, clonedLayout, rootLayoutEntryId));
    const watch = frameworkImports({ auditRecord: record }); watch.configResolved({ ...production, root, build: { watch: {} } });
    assert.equal(watch.transform.handler.call({ environment: { name: 'ssr' } }, actualSource, clientReferencesId), null);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
