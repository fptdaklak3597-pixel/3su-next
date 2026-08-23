import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'

/** Cấm ghi Dexie trực tiếp từ UI — phải qua domain (createSupplier, …). Đọc dbx vẫn được. */
const noDirectDbxWrites = {
  'no-restricted-syntax': [
    'error',
    {
      selector:
        "CallExpression[callee.object.object.name='dbx'][callee.property.name=/^(add|put|delete|bulkAdd|bulkPut|update|clear|bulkDelete)$/]",
      message:
        'Không ghi dbx từ UI. Dùng hàm domain (createSupplier, addProduct, …) để có sync/outbox.',
    },
  ],
}

export default tseslint.config(
  { ignores: ['dist/**', 'dist-mobile/**', 'dist-admin/**', 'node_modules/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/web/**/*.{ts,tsx}', 'src/mobile/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser },
    },
    rules: {
      ...noDirectDbxWrites,
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
)
