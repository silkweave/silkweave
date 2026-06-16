import eslint from '@eslint/js'
import stylistic from '@stylistic/eslint-plugin'
import { defineConfig } from 'eslint/config'
import tseslint from 'typescript-eslint'

export default defineConfig(eslint.configs.recommended, tseslint.configs.recommendedTypeChecked, tseslint.configs.stylisticTypeChecked, {
  languageOptions: {
    parserOptions: {
      project: 'tsconfig.json',
      tsconfigRootDir: import.meta.dirname
    }
  },
  plugins: { '@stylistic': stylistic },
  rules: {
    '@stylistic/indent': ['error', 2],
    '@stylistic/quotes': ['error', 'single'],
    '@stylistic/semi': ['error', 'never'],
    '@stylistic/comma-dangle': ['error', 'never'],
    '@stylistic/object-curly-spacing': ['error', 'always'],
    '@typescript-eslint/require-await': 'off',
    '@typescript-eslint/no-floating-promises': 'off',
    '@typescript-eslint/no-misused-promises': 'off',
    '@typescript-eslint/no-unsafe-return': 'off',
    '@typescript-eslint/no-unsafe-member-access': 'off',
    '@typescript-eslint/no-unsafe-call': 'off',
    '@typescript-eslint/no-unsafe-argument': 'off',
    '@typescript-eslint/no-unsafe-assignment': 'off',
    '@typescript-eslint/restrict-template-expressions': 'off',
    '@typescript-eslint/no-unused-vars': ['error', { 'argsIgnorePattern': '^_', 'varsIgnorePattern': '^_' }]
  }
}, {
  files: ['eslint.config.mjs', 'next.config.ts'],
  extends: [tseslint.configs.disableTypeChecked]
}, {
  ignores: ['.next', 'next-env.d.ts', 'eslint.config.mjs', 'next.config.ts']
})
