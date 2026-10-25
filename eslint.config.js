import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

/**
 * ESLint 9 flat config。
 * 只做基础约束，不启用类型感知规则（太慢，见 ARCHITECTURE 1.1）。
 */
export default tseslint.config(
  { ignores: ['dist', 'dev-dist', 'coverage', 'node_modules'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'warn',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      // 分层约束的静态兜底：调度计算不允许直接调用 Date.now() / Math.random()
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date']",
          message: '请使用 lib/time.ts 的 now() / fmtDate() 封装。',
        },
      ],
    },
  },
  {
    // 纯函数层允许的例外放在具体文件的注释里说明；此处仅豁免时间工具自身
    files: ['src/lib/time.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },
);
