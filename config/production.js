import { resolve } from 'node:path';

import js from '@eslint/js';
import globals from 'globals';

import plugin from 'eslint-plugin-resilient';

// Node JavaScript policy. Repository plugin-authoring checks stay in the host.
export const createProductionConfig = ({
    cwd = process.cwd(),
    files = ['**/*.js'],
    ignores = ['node_modules/**', 'docs/**', '**/*.md'],
    ...projectOptions
} = {}) => [
    { ignores },
    ...[js.configs.recommended, plugin.configs.recommended, plugin.configs.contracts,
        plugin.configs.safety, plugin.configs.imports, plugin.imports({ ...projectOptions, cwd }), {
            languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: { ...globals.nodeBuiltin } },
            linterOptions: { reportUnusedDisableDirectives: 'error', reportUnusedInlineConfigs: 'error' },
            rules: {
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
                        packageDir: resolve(cwd)
                    }
                ]
            }
        }].map(config => ({ ...config, files }))
];

export default createProductionConfig;
