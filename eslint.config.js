'use strict'
const js = require('@eslint/js')
const { defineConfig } = require('eslint/config')
const eslintConfigPrettier = require('eslint-config-prettier')
const prettierRecommended = require('eslint-plugin-prettier/recommended')
const pluginPromise = require('eslint-plugin-promise')
const nodePlugin = require('eslint-plugin-n')

module.exports = defineConfig([
  js.configs.recommended,
  eslintConfigPrettier,
  prettierRecommended,
  pluginPromise.configs['flat/recommended'],
  nodePlugin.configs['flat/recommended'],
  {
    rules: {
      'no-unused-vars': [
        'error',
        {
          args: 'all',
          argsIgnorePattern: '^_',
          caughtErrors: 'all',
          caughtErrorsIgnorePattern: '^_'
        }
      ],
      'n/no-extraneous-require': 'off',
      'n/no-process-exit': 'off',
      'n/no-unpublished-require': 'off'
    }
  }
])
