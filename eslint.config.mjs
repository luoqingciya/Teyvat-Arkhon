import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import pluginVue from 'eslint-plugin-vue'
import vueParser from 'vue-eslint-parser'

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/out/**', '**/node_modules/**', '**/build/**', '**/resources/arkhon-core/**']
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['apps/**/*.vue'],
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        parser: tseslint.parser,
        sourceType: 'module',
        extraFileExtensions: ['.vue']
      }
    },
    plugins: {
      vue: pluginVue
    },
    rules: {
      ...pluginVue.configs['flat/recommended'].rules,
      'vue/multi-word-component-names': 'off'
    }
  },
  {
    files: ['**/*.{ts,tsx,vue}'],
    languageOptions: {
      globals: {
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        localStorage: 'readonly',
        console: 'readonly',
        process: 'readonly',
        NodeJS: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        setTimeout: 'readonly',
        Event: 'readonly',
        HTMLDivElement: 'readonly',
        HTMLCanvasElement: 'readonly',
        HTMLSelectElement: 'readonly'
      }
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }]
    }
  },

  // ---------- 分层边界 ----------
  // 依赖方向此前只靠约定与评审维持；以下规则把它变成 CI 可强制的约束。
  {
    // shared 是最底层共享内核：须保持零运行时依赖，且不得触碰 Node/Electron
    // （它同时被渲染端与主进程引用）
    files: ['packages/shared/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['electron', 'electron/*'], message: 'shared 不得依赖 Electron（须保持零运行时依赖）' },
            { group: ['node:*'], message: 'shared 不得依赖 Node 内置模块（渲染端也要用）' },
            { group: ['@teyvat-arkhon/core-bridge', '@teyvat-arkhon/electron'], message: 'shared 不得依赖上层包' }
          ]
        }
      ]
    }
  },
  {
    // core-bridge 是可在纯 Node 环境独立运行/测试的领域层：不得触碰 Electron 或应用层
    files: ['packages/core-bridge/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['electron', 'electron/*'], message: 'core-bridge 不得依赖 Electron（否则无法独立复用与单测）' },
            {
              group: ['@teyvat-arkhon/electron', '../../apps/*', '../../../apps/*'],
              message: 'core-bridge 不得反向依赖应用层'
            }
          ]
        }
      ]
    }
  },
  {
    // 渲染端只能经 IPC 与主进程通信：不得直连 core-bridge，也不得用 Node/Electron API
    files: ['apps/electron/src/renderer/**/*.{ts,vue}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@teyvat-arkhon/core-bridge'], message: '渲染端须经 IPC 取数，不得直连 core-bridge' },
            { group: ['node:*', 'electron'], message: '渲染端不得使用 Node / Electron API' }
          ]
        }
      ]
    }
  }
)