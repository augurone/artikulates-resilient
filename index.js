import * as importPlugin from 'eslint-plugin-import-x';

import product from 'eslint-plugin-resilient/eslint';

import { createProjectAdapter, defaultExtensions, normalizeExtensions } from './integrations/project.js';

export const createImportsConfig = ({ extensions = defaultExtensions, ...projectOptions } = {}) => {
    const project = createProjectAdapter({ extensions, ...projectOptions });
    const { resolver = () => '' } = project;

    return {
        settings: {
            resilient: project,
            'import-x/resolver-next': [{
                interfaceVersion: 3,
                name: 'eslint-plugin-resilient:project',
                resolve: (source = '', from = '') => {
                    const file = resolver({ source, from });

                    return file ? { found: true, path: file } : { found: false };
                }
            }, importPlugin.createNodeResolver({ extensions: normalizeExtensions(extensions) })]
        }
    };
};

const coreRules = {
    "no-console": "error",
    "no-undef": "error",
    "no-unused-vars": [
        "error",
        {
            "ignoreRestSiblings": true
        }
    ],
    "prefer-const": "error",
    "no-nested-ternary": "error",
    "no-unneeded-ternary": "error",
    "eqeqeq": [
        "error",
        "always"
    ],
    "func-style": [
        "error",
        "expression"
    ],
    "prefer-destructuring": [
        "error",
        {
            "VariableDeclarator": {
                "array": true,
                "object": true
            },
            "AssignmentExpression": {
                "array": true,
                "object": true
            }
        },
        {
            "enforceForRenamedProperties": true
        }
    ],
    "indent": [
        "error",
        4,
        {
            "SwitchCase": 1
        }
    ],
    "comma-dangle": [
        "error",
        "never"
    ],
    "comma-style": "error",
    "semi": [
        "error",
        "always"
    ],
    "arrow-parens": [
        "error",
        "as-needed",
        {
            "requireForBlockBody": true
        }
    ],
    "implicit-arrow-linebreak": "error",
    "max-len": [
        "error",
        {
            "code": 200,
            "tabWidth": 4,
            "ignorePattern": "^\\s*// eslint-disable-next-line \\S+(?:, \\S+)+ -- \\S"
        }
    ],
    "no-multiple-empty-lines": [
        "error",
        {
            "max": 1,
            "maxEOF": 0,
            "maxBOF": 0
        }
    ],
    "no-trailing-spaces": "error",
    "no-multi-spaces": "error",
    "no-mixed-spaces-and-tabs": "error",
    "eol-last": [
        "error",
        "always"
    ],
    "padded-blocks": [
        "error",
        {
            "blocks": "never",
            "classes": "never",
            "switches": "never"
        }
    ],
    "padding-line-between-statements": [
        "error",
        {
            "blankLine": "always",
            "prev": "*",
            "next": "if"
        },
        {
            "blankLine": "always",
            "prev": "if",
            "next": "*"
        },
        {
            "blankLine": "always",
            "prev": "*",
            "next": "return"
        },
        {
            "blankLine": "never",
            "prev": "return",
            "next": "return"
        }
    ],
    "no-useless-return": "error",
    "no-plusplus": [
        "error",
        {
            "allowForLoopAfterthoughts": true
        }
    ],
    "object-curly-newline": [
        "error",
        {
            "consistent": true
        }
    ],
    "object-curly-spacing": [
        "error",
        "always"
    ],
    "operator-linebreak": "off",
    "no-use-before-define": [
        "error",
        {
            "functions": true
        }
    ],
    "consistent-return": "error",
    "constructor-super": "error",
    "class-methods-use-this": "error",
    "max-classes-per-file": "error",
    "no-restricted-syntax": [
        "error",
        {
            "selector": "ChainExpression",
            "message": "Optional chaining is forbidden. Use defensive destructuring instead."
        },
        {
            "selector": "ClassDeclaration",
            "message": "Classes are forbidden. Use function expressions instead."
        },
        {
            "selector": "ClassExpression",
            "message": "Classes are forbidden. Use function expressions instead."
        }
    ]
};
const plugin = {
    meta: Object.freeze({ name: 'eslint-plugin-resilient', version: '0.7.7', namespace: 'resilient' }),
    rules: product.rules,
    imports: createImportsConfig
};
const configs = {
    recommended: { plugins: { resilient: plugin }, rules: { ...coreRules, ...product.configs.recommended.rules } },
    contracts: { plugins: { resilient: plugin }, settings: { resilient: { evidenceMessages: true } }, rules: product.configs.contracts.rules },
    safety: { plugins: { resilient: plugin }, rules: { ...product.configs.safety.rules, 'no-empty': ['error', { allowEmptyCatch: true }] } },
    imports: { plugins: { import: importPlugin }, rules: {
        "import/no-unresolved": "error",
        "import/named": "error",
        "import/namespace": "error",
        "import/export": "error"
    } }
};

Object.defineProperty(plugin, 'configs', { value: Object.freeze(configs), enumerable: true });

export { createProjectAdapter };
export default Object.freeze(plugin);
