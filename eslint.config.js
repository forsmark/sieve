import tseslint from 'typescript-eslint';

export default tseslint.config({ ignores: ['dist', 'drizzle', 'node_modules', 'tools/spec-checks'] }, ...tseslint.configs.recommended, {
  rules: {
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    '@typescript-eslint/no-explicit-any': 'off',
  },
});
