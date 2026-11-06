import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import ts from 'typescript';

const siteRoot = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const drizzleRoot = dirname(require.resolve('drizzle-kit'));
const drizzlePackagePath = join(drizzleRoot, 'package.json');

function filesBelow(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(path) : [path];
  });
}

function migrationHashes(directory) {
  return filesBelow(directory).map((path) => [
    relative(directory, path),
    createHash('sha256').update(readFileSync(path)).digest('hex'),
  ]).sort(([left], [right]) => left.localeCompare(right));
}

test('Drizzle successor override is limited to the audited, unused legacy dependency', () => {
  const manifest = JSON.parse(readFileSync(join(siteRoot, 'package.json'), 'utf8'));
  const drizzle = JSON.parse(readFileSync(drizzlePackagePath, 'utf8'));
  assert.equal(drizzle.version, '0.31.11');
  assert.equal(manifest.devDependencies['drizzle-kit'], '0.31.11');
  assert.deepEqual(manifest.overrides['drizzle-kit@0.31.11'], {
    '@esbuild-kit/esm-loader': 'npm:tsx@4.23.15',
  });

  // Drizzle 0.31.10+ already uses tsx. Its legacy package declaration is unused.
  // This is NOT an assertion that tsx implements the old loader's API. Fail
  // closed if any published module starts referring to that dependency.
  const modules = filesBelow(drizzleRoot).filter((path) => /\.(?:cjs|mjs|js)$/.test(path));
  assert.ok(modules.length >= 9, 'Expected to audit every published Drizzle entry point');
  for (const path of modules) {
    assert.doesNotMatch(readFileSync(path, 'utf8'), /@esbuild-kit|esm-loader/, path);
  }

  const drizzleRequire = createRequire(drizzlePackagePath);
  const successor = JSON.parse(readFileSync(
    drizzleRequire.resolve('@esbuild-kit/esm-loader/package.json'), 'utf8',
  ));
  assert.equal(successor.name, 'tsx');
  assert.equal(successor.version, '4.23.15');
  assert.throws(() => drizzleRequire.resolve('@esbuild-kit/core-utils'));
});

for (const extension of ['js', 'ts', 'mjs']) {
  test(`Drizzle ${extension} config generates without changing immutable migration history`, () => {
    const fixture = mkdtempSync(join(tmpdir(), 'smart-inventory-drizzle-tooling-'));
    try {
      symlinkSync(join(siteRoot, 'node_modules'), join(fixture, 'node_modules'), 'dir');
      writeFileSync(join(fixture, 'package.json'), '{"type":"module"}\n');
      cpSync(join(siteRoot, 'db'), join(fixture, 'db'), { recursive: true });
      cpSync(join(siteRoot, 'drizzle'), join(fixture, 'drizzle'), { recursive: true });
      const before = migrationHashes(join(fixture, 'drizzle'));
      const typedImport = extension === 'ts' ? "import type { Config } from 'drizzle-kit';\n" : '';
      const typedConfig = extension === 'ts' ? ' satisfies Config' : '';
      writeFileSync(join(fixture, `drizzle.config.${extension}`),
        `${typedImport}import { defineConfig } from 'drizzle-kit';\n` +
        `export default defineConfig({ out: './drizzle', schema: './db/schema.ts', dialect: 'sqlite' }${typedConfig});\n`,
      );
      const result = spawnSync(process.execPath, [
        join(drizzleRoot, 'bin.cjs'), 'generate', '--config', `drizzle.config.${extension}`,
      ], { cwd: fixture, encoding: 'utf8', timeout: 30_000, env: { ...process.env, NO_COLOR: '1' } });
      assert.equal(result.error, undefined);
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
      assert.match(result.stdout, /No schema changes/);
      assert.deepEqual(migrationHashes(join(fixture, 'drizzle')), before);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
}

const eslint = new ESLint({ cwd: siteRoot });
const lintFixturePath = join(siteRoot, 'src/tooling-regression-fixture.tsx');
const lintFixtures = [
  ['anonymous exports', 'export default {};', 'import-x/no-anonymous-default-export'],
  ['memo display names', 'import { memo } from "react"; export const View = memo(() => <div />);', '@eslint-react/no-missing-component-display-name'],
  ['forwardRef display names', 'import { forwardRef } from "react"; export const View = forwardRef(() => <div />);', '@eslint-react/no-missing-component-display-name'],
  ['list keys', 'export function View() { return [1].map(n => <div>{n}</div>); }', '@eslint-react/no-missing-key'],
  ['JSX comments', 'export function View() { return <div>// comment\n</div>; }', '@eslint-react/jsx-no-comment-textnodes'],
  ['children props', 'export function View() { return <div children="text" />; }', '@eslint-react/jsx-no-children-prop'],
  ['dangerous children', 'export function View() { return <div dangerouslySetInnerHTML={{__html:"x"}}>x</div>; }', '@eslint-react/dom-no-dangerously-set-innerhtml-with-children'],
  ['legacy class components', 'import { Component } from "react"; export class View extends Component { render() { return null; } }', '@eslint-react/no-class-component'],
  ['legacy class factories', 'import createReactClass from "create-react-class"; export const View = createReactClass({render() { this.isMounted(); }});', 'no-restricted-imports'],
  ['direct state mutation', 'import { Component } from "react"; export class View extends Component { state = {n:0}; render() { this.state.n = 1; return null; } }', '@eslint-react/no-direct-mutation-state'],
  ['legacy DOM API', 'import { findDOMNode } from "react-dom"; findDOMNode(null);', '@eslint-react/dom-no-find-dom-node'],
  ['legacy render result', 'import * as ReactDOM from "react-dom"; export const node = ReactDOM.render(<div />, document.body);', '@eslint-react/dom-no-render-return-value'],
  ['literal string refs', 'export function View() { return <div ref="old" />; }', 'no-restricted-syntax'],
  ['expression string refs', 'export function View() { return <div ref={"old"} />; }', 'no-restricted-syntax'],
  ['unescaped text', 'export function View() { return <div>don\'t</div>; }', 'no-restricted-syntax'],
  ['legacy createClass', 'import * as React from "react"; export const View = React.createClass({render() { return null; }});', 'no-restricted-syntax'],
  ['image alternatives', 'export function View() { return <img src="/test.png" />; }', 'jsx-a11y/alt-text'],
  ['ARIA property names', 'export function View() { return <div aria-notreal="x" />; }', 'jsx-a11y/aria-props'],
  ['ARIA property types', 'export function View() { return <div aria-hidden="wrong" />; }', 'jsx-a11y/aria-proptypes'],
  ['ARIA unsupported elements', 'export function View() { return <meta aria-label="x" />; }', 'jsx-a11y/aria-unsupported-elements'],
  ['required ARIA roles', 'export function View() { return <div role="checkbox" />; }', 'jsx-a11y/role-has-required-aria-props'],
  ['role-supported ARIA props', 'export function View() { return <div role="button" aria-checked="true" />; }', 'jsx-a11y/role-supports-aria-props'],
  ['Next client rules', '"use client"; export default async function View() { return <div />; }', '@next/next/no-async-client-component'],
  ['React hook rules', 'import { useState } from "react"; export function View({ok}:{ok:boolean}) { if(ok) useState(0); return null; }', 'react-hooks/rules-of-hooks'],
];

for (const [name, source, expectedRule] of lintFixtures) {
  test(`ESLint regression: ${name}`, async () => {
    const [result] = await eslint.lintText(source, { filePath: lintFixturePath });
    assert.equal(result.fatalErrorCount, 0, JSON.stringify(result.messages));
    assert.ok(result.messages.some((message) => message.ruleId === expectedRule), JSON.stringify(result.messages));
  });
}

test('escaped JSX, JSX-only variable use and null refs remain valid', async () => {
  const [result] = await eslint.lintText(
    'function Child() { return <span ref={null} />; } export function View() { return <div>don&apos;t &quot;quote&quot;<Child /></div>; }',
    { filePath: lintFixturePath },
  );
  assert.deepEqual(result.messages, []);
});

test('every baseline deprecated API is rejected as a member, import and destructuring', async () => {
  const mapping = JSON.parse(readFileSync(join(siteRoot, 'tooling/eslint-rule-map.json'), 'utf8'));
  for (const { module: source, object, properties } of mapping.deprecatedApis) {
    for (const property of properties) {
      for (const [code, expectedRule] of [
        [`${object}.${property};`, 'no-restricted-properties'],
        [`import { ${property} as oldApi } from "${source}"; oldApi();`, 'no-restricted-imports'],
        [`const { ${property}: oldApi } = ${object}; oldApi();`, 'no-restricted-syntax'],
      ]) {
        const [result] = await eslint.lintText(code, { filePath: lintFixturePath });
        assert.ok(result.messages.some((message) => message.ruleId === expectedRule), `${code}: ${JSON.stringify(result.messages)}`);
      }
    }
  }
  const [result] = await eslint.lintText('this.transferPropsTo({});', { filePath: lintFixturePath });
  assert.ok(result.messages.some((message) => message.ruleId === 'no-restricted-properties'));
});

test('unchecked JavaScript cannot introduce JSX outside the mandatory TSX check', async () => {
  for (const extension of ['js', 'jsx', 'mjs', 'cjs']) {
    const [result] = await eslint.lintText('export function View() { return <div />; }', {
      filePath: join(siteRoot, `src/tooling-regression-fixture.${extension}`),
    });
    assert.ok(result.messages.some((message) => message.ruleId === 'no-restricted-syntax'), JSON.stringify(result.messages));
  }
});

test('mandatory TypeScript check rejects duplicate JSX props and unknown JSX components', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'smart-inventory-tsx-tooling-'));
  try {
    symlinkSync(join(siteRoot, 'node_modules'), join(fixture, 'node_modules'), 'dir');
    const source = join(fixture, 'fixture.tsx');
    writeFileSync(source, 'export function View() { return <><div id="a" id="b" /><UnknownComponent /></>; }');
    const program = ts.createProgram([source], {
      noEmit: true, strict: true, skipLibCheck: true,
      target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler, jsx: ts.JsxEmit.ReactJSX,
      types: ['react', 'react-dom'], typeRoots: [join(siteRoot, 'node_modules/@types')],
    });
    const codes = ts.getPreEmitDiagnostics(program).map((diagnostic) => diagnostic.code);
    assert.ok(codes.includes(17001), `Missing duplicate-prop diagnostic: ${codes}`);
    assert.ok(codes.includes(2304), `Missing unknown-component diagnostic: ${codes}`);
    const manifest = JSON.parse(readFileSync(join(siteRoot, 'package.json'), 'utf8'));
    assert.match(manifest.scripts.lint, /tsc --noEmit --incremental false/);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test('rule mapping is exhaustive for the replaced baseline and unchanged presets remain enabled', async () => {
  const mapping = JSON.parse(readFileSync(join(siteRoot, 'tooling/eslint-rule-map.json'), 'utf8'));
  assert.equal(Object.keys(mapping.replacements).length, 18);
  const config = await eslint.calculateConfigForFile(lintFixturePath);
  for (const replacements of Object.values(mapping.replacements)) {
    for (const replacement of replacements) {
      if (!replacement.includes(':')) {
        assert.ok(config.rules[replacement]?.[0] > 0, `Missing mapped rule: ${replacement}`);
      }
    }
  }
  for (const rule of mapping.unchanged.core) assert.ok(config.rules[rule]?.[0] > 0, rule);
  for (const rule of mapping.unchanged['jsx-a11y']) assert.ok(config.rules[`jsx-a11y/${rule}`]?.[0] > 0, rule);
  assert.equal(config.rules['@typescript-eslint/no-unused-vars'][0], 1);
  assert.equal(config.rules['react-hooks/rules-of-hooks'][0], 2);
  assert.equal(config.rules['@next/next/no-async-client-component'][0], 1);
});
