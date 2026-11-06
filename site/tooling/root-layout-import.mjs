import MagicString from 'magic-string';

export const rootLayoutEntryId = '\0virtual:vinext-rsc-entry';

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Reuse ONLY an already-eager namespace in the same audited generated entry.
 * The shared build plugin must audit the complete source/dependency inputs;
 * drift keeps the original import (and its real bundler warning) untouched.
 *
 * Do not generalize this to arbitrary modules: top-level await can make the
 * compiler retain an asynchronous module-initialization wrapper. For the pinned
 * layout, the original compiler output is already this exact Promise chain.
 */
export function normalizeRootLayoutImport(code, id, { audited = false, layoutPath } = {}) {
  if (audited !== true || id !== rootLayoutEntryId || typeof code !== 'string'
    || typeof layoutPath !== 'string' || !layoutPath.startsWith('/')
    || !layoutPath.endsWith('/app/layout.tsx')) return null;

  const specifier = JSON.stringify(layoutPath);
  // The current generator mentions this path only in the eager import and its
  // lazy thunk. An extra use or a changed spelling needs fresh validation.
  if (code.split(specifier).length !== 3) return null;
  const escaped = escapeRegExp(specifier);
  const eager = [...code.matchAll(new RegExp(
    `^import \\* as (mod_\\d+) from ${escaped};$`, 'gm',
  ))];
  const lazy = [...code.matchAll(new RegExp(
    `^const (load_\\d+) = \\(\\) => import\\(${escaped}\\);$`, 'gm',
  ))];
  if (eager.length !== 1 || lazy.length !== 1) return null;

  const namespace = eager[0][1];
  const declaration = new RegExp(`\\b(?:const|let|var|function|class)\\s+(?:${namespace}|Promise)\\b`);
  if (declaration.test(code) || /\bimport\s+(?:\*\s+as\s+)?Promise\b/.test(code)) return null;

  const output = new MagicString(code);
  output.overwrite(lazy[0].index, lazy[0].index + lazy[0][0].length,
    `const ${lazy[0][1]} = () => Promise.resolve().then(() => ${namespace});`);
  return {
    code: output.toString(),
    map: output.generateMap({ source: id, includeContent: true, hires: true }),
  };
}
