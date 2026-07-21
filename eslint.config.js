import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', 'server/src/db/migrations/**'] },
  js.configs.recommended,
  {
    files: ['server/**/*.ts', 'agent/**/*.ts'],
    extends: [...tseslint.configs.recommended],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['extension/src/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.webextensions,
      },
    },
  },
  {
    files: ['extension/test/**/*.js', 'extension/scripts/**/*.js', '*.js'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  prettier,
);
