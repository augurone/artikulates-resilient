import noDestructuringFallback from './rules/no-destructuring-fallback.js';
import noElse from './rules/no-else.js';
import noLengthComparison from './rules/no-length-comparison.js';
import noNestedIf from './rules/no-nested-if.js';
import noUndefinedAssignment from './rules/no-undefined-assignment.js';
import preferFalseyReturns from './rules/prefer-falsey-returns.js';
import preferPrototypeMethods from './rules/prefer-prototype-methods.js';
import preferSafeDestructuringDefaults from './rules/prefer-safe-destructuring-defaults.js';
import preferSignatureDestructuring from './rules/prefer-signature-destructuring.js';

const plugin = {
    meta: {
        name: 'eslint-plugin-resilient',
        version: '0.1.0'
    },
    rules: {
        'prefer-signature-destructuring': preferSignatureDestructuring,
        'no-destructuring-fallback': noDestructuringFallback,
        'no-else': noElse,
        'no-length-comparison': noLengthComparison,
        'no-nested-if': noNestedIf,
        'no-undefined-assignment': noUndefinedAssignment,
        'prefer-falsey-returns': preferFalseyReturns,
        'prefer-prototype-methods': preferPrototypeMethods,
        'prefer-safe-destructuring-defaults': preferSafeDestructuringDefaults
    },
    configs: {}
};

plugin.configs.recommended = {
    plugins: {
        resilient: plugin
    },
    rules: {
        'resilient/prefer-signature-destructuring': 'error',
        'resilient/no-destructuring-fallback': 'error',
        'resilient/no-else': 'error',
        'resilient/no-length-comparison': 'error',
        'resilient/no-nested-if': 'error',
        'resilient/no-undefined-assignment': 'error',
        'resilient/prefer-falsey-returns': 'error',
        'resilient/prefer-prototype-methods': 'error',
        'resilient/prefer-safe-destructuring-defaults': 'error',
        'no-console': 'error',
        'no-undef': 'error',
        'no-unused-vars': ['error', { ignoreRestSiblings: true }],
        'no-nested-ternary': 'error',
        'no-unneeded-ternary': 'error',
        'eqeqeq': ['error', 'always'],
        'func-style': ['error', 'expression'],
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
        'consistent-return': 'error',
        'constructor-super': 'off',
        'class-methods-use-this': 'off',
        'max-classes-per-file': 'off',
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
};

export default plugin;
