import js from '@eslint/js';
import * as importPlugin from 'eslint-plugin-import';
import react from 'eslint-plugin-react';
import globals from 'globals';

export default [
    js.configs.recommended,
    react.configs.flat.recommended,
    {
        files: ['**/*.{js,jsx}'],
        ignores: ['node_modules/**'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: { ...globals.node },
            parserOptions: {
                ecmaFeatures: { jsx: true }
            }
        },
        plugins: {
            import: importPlugin,
            react
        },
        settings: {
            react: { version: 'detect' }
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
            'no-multiple-empty-lines': 'error',
            'no-plusplus': ['error', { allowForLoopAfterthoughts: true }],
            'object-curly-newline': ['error', { consistent: true }],
            'object-curly-spacing': ['error', 'always'],
            'operator-linebreak': ['error', 'before', { overrides: { '&&': 'after', '||': 'after' } }],
            'no-use-before-define': ['error', { functions: true }],
            'no-lonely-if': 'error',
            'consistent-return': 'error',
            'no-undefined': 'error',
            'lines-between-class-members': ['error'],
            'constructor-super': 'off',
            'class-methods-use-this': 'off',
            'max-classes-per-file': 'off',
            'no-param-reassign': 'off',
            'no-restricted-globals': 'off',
            'no-undef': 'off',
            'import/no-cycle': 'off',
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
                    devDependencies: ['eslint.config.js', 'tests/**/*.js'],
                    optionalDependencies: false,
                    peerDependencies: false,
                    packageDir: './'
                }
            ],
            'react/jsx-uses-vars': 'error',
            'react/jsx-uses-react': 'error',
            'react/jsx-closing-bracket-location': ['error', { selfClosing: 'after-props', nonEmpty: 'after-props' }],
            'react/jsx-max-props-per-line': ['error', { maximum: 1, when: 'multiline' }],
            'react/jsx-tag-spacing': ['error', { beforeSelfClosing: 'always' }],
            'react/prop-types': 'off',
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
