import js from '@eslint/js';
import eslintPlugin from 'eslint-plugin-eslint-plugin';
import * as importPlugin from 'eslint-plugin-import-x';
import nodePlugin from 'eslint-plugin-n';
import globals from 'globals';

import resilient from 'eslint-plugin-resilient';

export default [
    {
        ignores: ['node_modules/**']
    },
    js.configs.recommended,
    {
        files: ['rules/*.js'],
        plugins: {
            'eslint-plugin': eslintPlugin
        },
        rules: {
            ...eslintPlugin.configs.recommended.rules
        }
    },
    {
        files: ['index.js', 'rules/**/*.js', 'eslint.config.js'],
        plugins: {
            n: nodePlugin
        },
        rules: {
            ...nodePlugin.configs['flat/recommended'].rules
        }
    },
    resilient.configs.recommended,
    resilient.configs.contracts,
    resilient.configs.safety,
    {
        files: ['**/*.js'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: { ...globals.node }
        },
        plugins: {
            import: importPlugin
        },
        rules: {
            'no-unused-vars': ['error', { ignoreRestSiblings: true }],
            'no-console': 'error',
            'eqeqeq': ['error', 'always'],
            'func-style': ['error', 'expression'],
            'no-nested-ternary': 'error',
            'no-unneeded-ternary': 'error',
            'prefer-destructuring': [
                'error',
                {
                    VariableDeclarator: { array: true, object: true },
                    AssignmentExpression: { array: true, object: true }
                },
                { enforceForRenamedProperties: true }
            ],
            'indent': ['error', 4, { SwitchCase: 1 }],
            'comma-dangle': ['error', 'never'],
            'comma-style': 'error',
            'semi': ['error', 'always'],
            'arrow-parens': ['error', 'as-needed', { requireForBlockBody: true }],
            'implicit-arrow-linebreak': 'error',
            'max-len': ['error', { code: 200, tabWidth: 4 }],
            'no-multiple-empty-lines': ['error', { max: 1, maxEOF: 0, maxBOF: 0 }],
            'no-trailing-spaces': 'error',
            'no-multi-spaces': 'error',
            'no-mixed-spaces-and-tabs': 'error',
            'eol-last': ['error', 'always'],
            'padded-blocks': ['error', { blocks: 'never', classes: 'never', switches: 'never' }],
            'padding-line-between-statements': [
                'error',
                { blankLine: 'always', prev: '*', next: 'if' },
                { blankLine: 'always', prev: 'if', next: '*' },
                { blankLine: 'always', prev: '*', next: 'return' },
                { blankLine: 'never', prev: 'return', next: 'return' }
            ],
            'no-useless-return': 'error',
            'no-plusplus': ['error', { allowForLoopAfterthoughts: true }],
            'object-curly-newline': ['error', { consistent: true }],
            'object-curly-spacing': ['error', 'always'],
            'operator-linebreak': ['error', 'before', { overrides: { '&&': 'after', '||': 'after' } }],
            'no-use-before-define': ['error', { functions: true }],
            'consistent-return': 'error',
            'lines-between-class-members': ['error'],
            'constructor-super': 'error',
            'class-methods-use-this': 'error',
            'max-classes-per-file': 'error',
            'no-param-reassign': 'error',
            'no-restricted-globals': 'error',
            'no-undef': 'error',
            'import/no-cycle': 'error',
            'import/order': [
                'error',
                {
                    alphabetize: { order: 'asc', caseInsensitive: true },
                    groups: ['builtin', 'external', 'internal', ['parent', 'sibling', 'index']],
                    'newlines-between': 'always'
                }
            ],
            'import/no-useless-path-segments': [
                'error',
                {
                    noUselessIndex: true
                }
            ],
            'import/no-extraneous-dependencies': [
                'error',
                {
                    devDependencies: ['eslint.config.js', 'scripts/**/*.js', 'tests/**/*.js'],
                    optionalDependencies: false,
                    peerDependencies: true,
                    packageDir: './'
                }
            ],
            'no-restricted-syntax': [
                'error',
                {
                    selector: 'ChainExpression',
                    message: 'Optional chaining is forbidden. Use defensive destructuring instead.'
                },
                {
                    selector: 'ClassDeclaration',
                    message: 'Classes are forbidden. Use function expressions instead.'
                },
                {
                    selector: 'ClassExpression',
                    message: 'Classes are forbidden. Use function expressions instead.'
                }
            ]
        }
    }
];
