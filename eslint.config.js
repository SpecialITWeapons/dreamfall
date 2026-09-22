import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig([
  // `.claude/` is the agent tooling's own directory, not source. Its worktrees
  // hold whole checkouts of this repo, and a second tsconfig under the root
  // stops the typed linter dead.
  { ignores: ['dist/**', 'node_modules/**', 'playwright-report/**', 'test-results/**', '.claude/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,js,mjs}'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
  prettier,
]);
