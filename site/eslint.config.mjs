import react from '@eslint-react/eslint-plugin';
import next from '@next/eslint-plugin-next';
import { defineConfig, globalIgnores } from 'eslint/config';
import noAnonymousDefaultExport from 'eslint-plugin-import-x/rules/no-anonymous-default-export';
import jsxA11y from 'eslint-plugin-jsx-a11y-x';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import ruleMap from './tooling/eslint-rule-map.json' with { type: 'json' };

const deprecatedDestructuring = ruleMap.deprecatedApis.map(({ object, properties }) => ({
  selector: `VariableDeclarator[init.name="${object}"] > ObjectPattern > Property[key.name=/^(${properties.join('|')})$/]`,
  message: 'This React API was removed or deprecated; use its maintained replacement.',
}));

// Rule-by-rule migration and regression fixtures live in tooling/eslint-rule-map.json
// and scripts/tooling.test.mjs. No unsupported ESLint 9 plugin is force-installed.
export default defineConfig([
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: {
      '@eslint-react': react,
      '@next/next': next,
      'react-hooks': reactHooks,
      // Use the package's supported rule subpath: this project enables only
      // this import rule, not unrelated resolver/glob rules.
      'import-x': { rules: { 'no-anonymous-default-export': noAnonymousDefaultExport } },
      'jsx-a11y': jsxA11y,
    },
    rules: {
      ...next.configs['core-web-vitals'].rules,
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': 'warn',
      '@typescript-eslint/no-unused-expressions': 'warn',
      'import-x/no-anonymous-default-export': 'warn',
      '@eslint-react/no-missing-component-display-name': 'error',
      '@eslint-react/no-missing-key': 'error',
      '@eslint-react/no-duplicate-key': 'error',
      '@eslint-react/jsx-no-comment-textnodes': 'error',
      '@eslint-react/jsx-no-children-prop': 'error',
      '@eslint-react/dom-no-dangerously-set-innerhtml-with-children': 'error',
      '@eslint-react/no-class-component': 'error',
      '@eslint-react/no-direct-mutation-state': 'error',
      '@eslint-react/no-component-will-mount': 'error',
      '@eslint-react/no-component-will-receive-props': 'error',
      '@eslint-react/no-component-will-update': 'error',
      '@eslint-react/dom-no-find-dom-node': 'error',
      '@eslint-react/dom-no-render': 'error',
      '@eslint-react/dom-no-hydrate': 'error',
      '@eslint-react/dom-no-render-return-value': 'error',
      'jsx-a11y/alt-text': ['warn', { elements: ['img'], img: ['Image'] }],
      'jsx-a11y/aria-props': 'warn',
      'jsx-a11y/aria-proptypes': 'warn',
      'jsx-a11y/aria-unsupported-elements': 'warn',
      'jsx-a11y/role-has-required-aria-props': 'warn',
      'jsx-a11y/role-supports-aria-props': 'warn',
      'no-restricted-properties': ['error',
        ...ruleMap.deprecatedApis.flatMap(({ object, properties }) => properties.map((property) => ({
          object, property, message: 'This React API was removed or deprecated.',
        }))),
        { property: 'transferPropsTo', message: 'Legacy transferPropsTo is unsupported; use prop spreading.' },
      ],
      'no-restricted-imports': ['error', {
        paths: [
          { name: 'create-react-class', message: 'Legacy class factories are unsupported; use a named function component.' },
          ...ruleMap.deprecatedApis.filter(({ object }) => object !== 'Perf').map(({ module: name, properties: importNames }) => ({
            name, importNames, message: 'This React API was removed or deprecated.',
          })),
        ],
      }],
      'no-restricted-syntax': ['error',
        ...deprecatedDestructuring,
        {
          selector: `JSXText[raw=/["'>}]/]`,
          message: 'Escape quotation marks, apostrophes, > and } in JSX text.',
        },
        {
          selector: 'JSXAttribute[name.name="ref"] > Literal',
          message: 'String refs are unsupported; use a ref object or callback.',
        },
        {
          selector: 'JSXAttribute[name.name="ref"] > JSXExpressionContainer > Literal[value!=null]',
          message: 'String refs are unsupported; use a ref object or callback.',
        },
        {
          selector: 'CallExpression[callee.object.name="React"][callee.property.name="createClass"]',
          message: 'Legacy createClass is unsupported; use a named function component.',
        },
      ],
    },
  },
  {
    // JSX must be type-checked: checkJs is intentionally not enabled globally.
    files: ['**/*.{js,jsx,mjs,cjs}'],
    rules: {
      'no-restricted-syntax': ['error',
        ...deprecatedDestructuring,
        { selector: 'JSXElement, JSXFragment', message: 'Write React JSX in .tsx files so the mandatory TypeScript check validates components and duplicate props.' },
        { selector: 'CallExpression[callee.object.name="React"][callee.property.name="createClass"]', message: 'Legacy createClass is unsupported; use a named function component.' },
      ],
    },
  },
  {
    // Shared browser-local blob previews intentionally use native images.
    files: ['src/features/products/ProductImage.tsx', 'src/features/products/ProductImageField.tsx'],
    rules: { '@next/next/no-img-element': 'off' },
  },
  globalIgnores(['.next/**', 'out/**', 'build/**', 'dist/**', 'next-env.d.ts']),
]);
