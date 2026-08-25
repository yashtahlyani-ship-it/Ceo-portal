import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import { defineConfig, globalIgnores } from 'eslint/config';

// Mirrors the Marketing Portal's frontend/eslint.config.js so both codebases are
// held to the same bar, with a Node block for the admin scripts and tests.
export default defineConfig([
  globalIgnores(['dist', '**/node_modules', 'supabase/functions']),

  // Browser app
  {
    files: ['src/**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      // eslint-plugin-react is not installed, so ESLint does not count a JSX
      // reference as a use. Components are PascalCase by convention, so allow
      // capitalised names to go "unused" rather than pull in the whole plugin
      // for one rule — e.g. `({ icon: Icon }) => <Icon/>`.
      'no-unused-vars': ['error', {
        varsIgnorePattern: '^[A-Z_]',
        argsIgnorePattern: '^(_|[A-Z])',
      }],

      // These two arrived with react-hooks v7's React-Compiler ruleset and flag
      // patterns used throughout BOTH this codebase and the Marketing Portal —
      // fetch-on-mount effects, and modules that export a component plus a
      // helper. Running `npx eslint .` inside gyftr-portal/frontend reports 53
      // of the same errors today.
      //
      // They are kept as warnings, not switched off: the advice is sound and
      // worth acting on, but silently rewriting these patterns here would put
      // the two portals out of step for no functional gain. Revisit as a
      // deliberate change across both products.
      'react-hooks/set-state-in-effect': 'warn',
      'react-refresh/only-export-components': 'warn',
    },
  },

  // Admin scripts and integration tests — Node, not a browser, no React rules
  {
    files: ['scripts/**/*.mjs', 'tests/**/*.mjs'],
    extends: [js.configs.recommended],
    languageOptions: {
      globals: globals.node,
      sourceType: 'module',
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
]);
