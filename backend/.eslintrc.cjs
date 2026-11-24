/**
 * ESLint cho backend (TypeScript). Dùng định dạng .eslintrc cổ điển vì đang ở
 * ESLint 8 + @typescript-eslint 7. Không bật type-checked rules (cần
 * parserOptions.project, chậm) — giữ nhanh để chạy tốt trong CI; typecheck
 * riêng đã lo phần kiểu.
 */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  env: { node: true, es2022: true },
  ignorePatterns: ['dist', 'node_modules', 'coverage', '*.mjs'],
  rules: {
    // Cho phép biến bỏ qua có tiền tố _ (ví dụ _req, _res của Express).
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    // any thỉnh thoảng cần cho SDK động (AWS) — cảnh báo thay vì chặn cứng,
    // và đã đánh dấu disable tường minh ở từng chỗ.
    '@typescript-eslint/no-explicit-any': 'warn',
    'no-console': 'off',
  },
  overrides: [
    {
      // Test dùng một số mẫu nới lỏng hơn.
      files: ['**/*.test.ts'],
      rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
    },
  ],
};
