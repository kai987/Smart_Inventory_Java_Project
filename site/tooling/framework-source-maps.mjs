import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import MagicString from 'magic-string';

// Upstream still omits these maps in stable releases. Revalidate/remove this
// adapter when upgrading either package; do not turn this into a warning filter.
// https://github.com/vitejs/vite-plugin-react/pull/1294
// https://github.com/vitejs/vite-plugin-react/issues/1418
// https://github.com/cloudflare/vinext/blob/main/packages/vinext/src/plugins/action-owner-manifest.ts
export const auditedFrameworkSources = [
  {
    name: 'vinext', version: '1.0.1',
    file: 'dist/plugins/action-owner-manifest.js',
    sha256: '73f785a5e1c563f9ba55773a51cf8c7aa1cf7d03cc8579b8768c2c2ab0a39300',
  },
  {
    name: '@vitejs/plugin-rsc', version: '0.5.35',
    file: 'dist/plugin-CLvIS10V.js',
    sha256: '81e2c8baf862a7a363e486883a2f327f9ba2cee8d483f40ea2468de4b170499f',
  },
];

export function verifyFrameworkSourceGuard({ readFile = readFileSync } = {}) {
  for (const source of auditedFrameworkSources) {
    const packageRoot = dirname(dirname(fileURLToPath(import.meta.resolve(source.name))));
    const manifest = JSON.parse(readFile(join(packageRoot, 'package.json'), 'utf8'));
    const actualHash = createHash('sha256').update(readFile(join(packageRoot, source.file))).digest('hex');
    if (manifest.version !== source.version || actualHash !== source.sha256) {
      throw new Error(`Revalidate framework source-map adapter: ${source.name} source/version changed.`);
    }
  }
}

const asyncHooksPrefixes = [
  'import * as __viteRscAsyncHooks from "node:async_hooks";',
  'const __viteRscAsyncHooks = require("node:async_hooks");',
].map((prefix) => `${prefix}globalThis.AsyncLocalStorage = __viteRscAsyncHooks.AsyncLocalStorage;`);

// Always consume the ORIGINAL handler's result. Reconstruct only the audited
// prepend/replaceAll edits, validate byte identity, then attach their real map.
export function attachFrameworkMap({ kind, token, source, originalCode, result }) {
  if (result == null) return result;
  const code = typeof result === 'string' ? result : result.code;
  if (typeof code !== 'string') throw new Error('Unexpected framework transform result.');
  if (code === originalCode || (typeof result === 'object' && result.map != null)) return result;
  const output = new MagicString(originalCode);

  if (kind === 'prepend') {
    const prefix = asyncHooksPrefixes.find((candidate) => code === candidate + originalCode);
    if (!prefix) throw new Error('Revalidate framework AsyncLocalStorage prepend.');
    output.prepend(prefix);
  } else if (kind === 'replaceAll') {
    const positions = [];
    for (let offset = originalCode.indexOf(token); offset !== -1; offset = originalCode.indexOf(token, offset + token.length)) {
      positions.push(offset);
    }
    if (positions.length === 0) throw new Error('Expected framework manifest token.');
    const replacementLength = token.length + (code.length - originalCode.length) / positions.length;
    if (!Number.isInteger(replacementLength) || replacementLength < 0) throw new Error('Revalidate framework manifest replacement length.');
    const replacement = code.slice(positions[0], positions[0] + replacementLength);
    if (originalCode.replaceAll(token, () => replacement) !== code) throw new Error('Revalidate framework manifest replacement.');
    for (const position of positions) output.update(position, position + token.length, replacement);
  } else {
    throw new Error('Unknown framework source-map adapter operation.');
  }

  if (output.toString() !== code) throw new Error('Framework source-map adapter changed executable code.');
  return {
    ...(typeof result === 'object' ? result : {}),
    code,
    map: output.generateMap({ source, includeContent: true, hires: true }),
  };
}

const targets = [
  { name: 'rsc:inject-async-local-storage', hook: 'transform', kind: 'prepend' },
  { name: 'rsc:virtual:vite-rsc/assets-manifest', hook: 'renderChunk', kind: 'replaceAll', token: 'virtual:vite-rsc/assets-manifest' },
  { name: 'vinext:action-owner-manifest', hook: 'renderChunk', kind: 'replaceAll', token: 'virtual:vinext-action-owner-manifest' },
];
const patched = new WeakSet();

export function attachFrameworkHookMaps(plugins) {
  for (const target of targets) {
    const matching = plugins.filter((plugin) => plugin.name === target.name);
    if (matching.length !== 1) throw new Error(`Expected one audited plugin: ${target.name}.`);
    const plugin = matching[0];
    if (patched.has(plugin)) continue;
    const hook = plugin[target.hook];
    const original = typeof hook === 'function' ? hook : hook?.handler;
    if (typeof original !== 'function') throw new Error(`Missing audited hook: ${target.name}.`);
    const handler = function (...args) {
      const result = original.apply(this, args);
      const addMap = (value) => attachFrameworkMap({
        ...target,
        originalCode: args[0],
        source: target.hook === 'transform' ? args[1] : args[1].fileName,
        result: value,
      });
      return result?.then ? result.then(addMap) : addMap(result);
    };
    plugin[target.hook] = typeof hook === 'function' ? handler : { ...hook, handler };
    patched.add(plugin);
  }
}

/** @returns {import('vite').Plugin} */
export function frameworkSourceMaps() {
  return {
    name: 'smart-inventory:framework-source-maps',
    apply: 'build',
    enforce: 'post',
    configResolved: {
      order: 'post',
      handler(config) {
        verifyFrameworkSourceGuard();
        attachFrameworkHookMaps(config.plugins);
      },
    },
  };
}
