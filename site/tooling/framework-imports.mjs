import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import MagicString from 'magic-string';
import audit from './framework-imports.audit.json' with { type: 'json' };
import { normalizeRootLayoutImport, rootLayoutEntryId } from './root-layout-import.mjs';

export const clientReferencesId = '\0virtual:vite-rsc/client-references';
const roots = ['app', 'src', 'lib', 'db'];
const configs = ['vite.config.ts', 'next.config.ts', 'tsconfig.json', 'package.json',
  'package-lock.json', '.openai/hosting.json', 'tooling/framework-source-maps.mjs',
  'tooling/root-layout-import.mjs', 'tooling/framework-imports.mjs'];
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** Relative path + length + bytes; never read data, secrets or generated output. */
export function runtimeInputFingerprint(root, record = audit) {
  const expected = new Set(record.inputs);
  if (!record.inputs?.length || configs.some((path) => !expected.has(path))
    || [...expected].some((path) => path.startsWith('/') || path.includes('\\') || path.split('/').includes('..'))) throw new Error('Invalid audit inputs');
  const found = new Set(configs);
  function visit(directory) {
    const stat = lstatSync(join(root, directory));
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Unaudited source directory');
    for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`;
      if (entry.isSymbolicLink()) throw new Error('Unaudited source symlink');
      if (entry.isDirectory()) {
        if (![...expected].some((known) => known.startsWith(`${path}/`))) {
          if (record.optionalEmptyDirectories?.includes(path) && readdirSync(join(root, path)).length === 0) continue;
          throw new Error('Unknown source directory');
        }
        visit(path);
      } else {
        if (!entry.isFile() || !expected.has(path)) throw new Error('Unknown source file');
        found.add(path);
      }
    }
  }
  roots.forEach(visit);
  if (found.size !== expected.size || [...expected].some((path) => !found.has(path))) throw new Error('Missing audit input');
  // Validate the entire name/type set BEFORE reading even one known file.
  for (const path of found) if (!lstatSync(join(root, path)).isFile()) throw new Error('Unaudited input file');
  const hash = createHash('sha256');
  for (const path of [...found].sort()) {
    const bytes = readFileSync(join(root, path));
    hash.update(path).update('\0').update(String(bytes.length)).update('\0').update(bytes).update('\0');
  }
  return hash.digest('hex');
}

export function auditedEnvironment(env, execArgv = process.execArgv) {
  if (execArgv.some((arg) => /^(?:--conditions(?:=|$)|-C|--import(?:=|$)|--(?:experimental-)?loader(?:=|$)|--require(?:=|$)|-r$)/.test(arg))) return false;
  if (env.NODE_ENV && env.NODE_ENV !== 'production') return false;
  if (env.NODE_OPTIONS && !/^\s*(?:--max-old-space-size=\d+\s*)+$/.test(env.NODE_OPTIONS)) return false;
  const identities = new Set(['__VINEXT_SHARED_RSC_COMPATIBILITY_ID', '__VINEXT_SHARED_RSC_BUILD_ID',
    '__VINEXT_SHARED_PRERENDER_SECRET', '__VINEXT_SHARED_REVALIDATE_SECRET']);
  return Object.keys(env).filter((key) => /^(?:NEXT_|__NEXT|VINEXT_|__VINEXT|REACT_|VITE_|ROLLDOWN_|NAPI_RS_)/.test(key))
    .every((key) => identities.has(key)
      || (key === 'NEXT_PHASE' && env[key] === 'phase-production-build')
      || (key === 'NEXT_TELEMETRY_DISABLED' && ['0', '1'].includes(env[key]))
      || (key === 'VITE_USER_NODE_ENV' && env[key] === 'production'));
}

function upstreamRoots(record) {
  return new Map(record.packages.map((pkg) => {
    let root = dirname(fileURLToPath(import.meta.resolve(pkg.name)));
    for (const segment of pkg.entryDirectory.split('/')) if (segment !== '.') root = dirname(root);
    return [pkg.name, root];
  }));
}

function nativeCompilerMatches(root, version) {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const prefix = `@rolldown/binding-${process.platform}-${process.arch}`;
  const installed = Object.keys(pkg.optionalDependencies ?? {}).filter((name) => name.startsWith(prefix)).flatMap((name) => {
    try {
      const path = fileURLToPath(import.meta.resolve(`${name}/package.json`));
      const metadata = JSON.parse(readFileSync(path, 'utf8'));
      return [{ metadata, binaryExists: typeof metadata.main === 'string' && existsSync(join(dirname(path), metadata.main)) }];
    } catch { return []; }
  });
  return installed.length > 0 && installed.every(({ metadata, binaryExists }) => metadata.version === version && binaryExists);
}

/** Any drift is a conservative no-op, not a failure of a future feature build. */
export function auditedBuildInputs(root, config, env = process.env, record = audit) {
  try {
    if (config.command !== 'build' || config.mode !== 'production' || config.build?.watch || !auditedEnvironment(env)) return false;
    // Do not read secret-bearing dotenv files. Their presence is unaudited.
    if (readdirSync(root).some((name) => /^\.env(?:\.|$)/.test(name))) return false;
    if (['next.config.js', 'next.config.mjs', 'next.config.cjs', 'vite.config.js', 'vite.config.mjs', 'vite.config.mts'].some((name) => existsSync(join(root, name)))) return false;
    if (config.envDir && realpathSync(config.envDir) !== realpathSync(root)) return false;
    if (config.configFile && realpathSync(config.configFile) !== join(realpathSync(root), 'vite.config.ts')) return false;
    if (record.version !== 1 || runtimeInputFingerprint(root, record) !== record.runtimeFingerprint) return false;
    if (record.packages.map((pkg) => pkg.name).sort().join() !== ['@vitejs/plugin-rsc', 'react', 'rolldown', 'vinext', 'vite'].join()) return false;
    const packages = upstreamRoots(record);
    return record.packages.every((pkg) => {
      const base = packages.get(pkg.name);
      const manifest = JSON.parse(readFileSync(join(base, 'package.json'), 'utf8'));
      return manifest.version === pkg.version && Object.entries(pkg.files)
        .every(([path, expected]) => sha256(readFileSync(join(base, path))) === expected);
    }) && nativeCompilerMatches(packages.get('rolldown'), '1.2.16');
  } catch {
    return false;
  }
}

/** Only the audited single-export default error shim; NEVER the multi-export Slot. */
export function normalizeDefaultErrorReference(code, id, { audited = false, targetPath } = {}) {
  if (!audited || id !== clientReferencesId || typeof code !== 'string'
    || typeof targetPath !== 'string' || !targetPath.endsWith('/vinext/dist/shims/default-global-error.js')) return null;
  const binding = '__smart_inventory_default_error';
  const specifier = JSON.stringify(targetPath);
  const expression = `await import(${specifier})`;
  const offset = code.indexOf(expression);
  if (!code.startsWith('export default {\n') || !code.endsWith('\n};\n')
    || code.split(specifier).length !== 2 || code.includes(binding) || offset < 0
    || !/^\s*const m = $/.test(code.slice(code.lastIndexOf('\n', offset) + 1, offset))
    || !/^;\s*$/.test(code.slice(offset + expression.length).split('\n')[0])
    || /\b(?:const|let|var|function|class|import)\s+Promise\b/.test(code)) return null;
  const output = new MagicString(code);
  output.prepend(`import * as ${binding} from ${specifier};\n`);
  output.update(offset, offset + expression.length, `await Promise.resolve().then(() => ${binding})`);
  return { code: output.toString(), map: output.generateMap({ source: id, includeContent: true, hires: true }) };
}

/** @returns {import('vite').Plugin} */
export function frameworkImports({ auditRecord = audit } = {}) {
  let root;
  let config;
  let layoutPath;
  let targetPath;
  return {
    name: 'smart-inventory:audited-framework-imports',
    apply: 'build',
    enforce: 'post',
    configResolved(resolved) {
      try {
        root = realpathSync(resolved.root);
        config = resolved;
        layoutPath = join(root, 'app/layout.tsx');
        targetPath = join(dirname(fileURLToPath(import.meta.resolve('vinext'))), 'shims/default-global-error.js');
      } catch { root = undefined; }
    },
    transform: {
      order: 'post',
      handler(code, id) {
        if (!root || ![rootLayoutEntryId, clientReferencesId].includes(id)
          || !auditedBuildInputs(root, config, process.env, auditRecord)) return null;
        if (id === rootLayoutEntryId && this.environment.name === 'rsc') {
          return normalizeRootLayoutImport(code, id, { audited: true, layoutPath });
        }
        if (id === clientReferencesId && this.environment.name === 'ssr') {
          return normalizeDefaultErrorReference(code, id, { audited: true, targetPath });
        }
        return null;
      },
    },
  };
}
