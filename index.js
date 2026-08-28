import * as importPlugin from 'eslint-plugin-import';

import noDestructuringFallback from './rules/no-destructuring-fallback.js';
import noElse from './rules/no-else.js';
import noLengthComparison from './rules/no-length-comparison.js';
import noNestedIf from './rules/no-nested-if.js';
import noNullAssignment from './rules/no-null-assignment.js';
import noSilentCatch from './rules/no-silent-catch.js';
import noUndefinedAssignment from './rules/no-undefined-assignment.js';
import noUndefinedComparison from './rules/no-undefined-comparison.js';
import noUnhandledPromiseChain from './rules/no-unhandled-promise-chain.js';
import preferAsyncAwait from './rules/prefer-async-await.js';
import preferDestructuredMemberAccess from './rules/prefer-destructured-member-access.js';
import preferFalseyReturns from './rules/prefer-falsey-returns.js';
import preferPrototypeMethods from './rules/prefer-prototype-methods.js';
import preferSafeDestructuringDefaults from './rules/prefer-safe-destructuring-defaults.js';
import preferSafeTransformations from './rules/prefer-safe-transformations.js';
import preferSignatureDestructuring from './rules/prefer-signature-destructuring.js';
import signatureContractCallSite from './rules/signature-contract-call-site.js';
import signatureContractDestructuring from './rules/signature-contract-destructuring.js';
import signatureContractOperation from './rules/signature-contract-operation.js';
import signatureContractReturnConsistency from './rules/signature-contract-return-consistency.js';

let configs = {};

const plugin = {
    meta: {
        name: 'eslint-plugin-resilient',
        version: '0.4.1'
    },
    rules: {
        'prefer-signature-destructuring': preferSignatureDestructuring,
        'no-destructuring-fallback': noDestructuringFallback,
        'no-else': noElse,
        'no-length-comparison': noLengthComparison,
        'no-null-assignment': noNullAssignment,
        'no-silent-catch': noSilentCatch,
        'no-unhandled-promise-chain': noUnhandledPromiseChain,
        'prefer-async-await': preferAsyncAwait,
        'no-nested-if': noNestedIf,
        'no-undefined-assignment': noUndefinedAssignment,
        'no-undefined-comparison': noUndefinedComparison,
        'prefer-destructured-member-access': preferDestructuredMemberAccess,
        'prefer-falsey-returns': preferFalseyReturns,
        'prefer-prototype-methods': preferPrototypeMethods,
        'prefer-safe-transformations': preferSafeTransformations,
        'prefer-safe-destructuring-defaults': preferSafeDestructuringDefaults,
        'signature-contract-call-site': signatureContractCallSite,
        'signature-contract-destructuring': signatureContractDestructuring,
        'signature-contract-operation': signatureContractOperation,
        'signature-contract-return-consistency': signatureContractReturnConsistency
    },
    get configs() {
        return configs;
    }
};

const recommended = {
    plugins: {
        resilient: plugin
    },
    rules: {
        'resilient/prefer-signature-destructuring': 'error',
        'resilient/no-destructuring-fallback': 'error',
        'resilient/no-else': 'error',
        'resilient/no-length-comparison': 'error',
        'resilient/no-null-assignment': 'error',
        'resilient/no-nested-if': 'error',
        'resilient/no-undefined-assignment': 'error',
        'resilient/no-undefined-comparison': 'error',
        'resilient/prefer-destructured-member-access': 'error',
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
        'constructor-super': 'error',
        'class-methods-use-this': 'error',
        'max-classes-per-file': 'error',
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

const contracts = {
    plugins: {
        resilient: plugin
    },
    rules: {
        'resilient/signature-contract-call-site': 'error',
        'resilient/signature-contract-destructuring': 'error',
        'resilient/signature-contract-operation': 'error',
        'resilient/signature-contract-return-consistency': 'error'
    }
};

const safety = {
    plugins: {
        resilient: plugin
    },
    rules: {
        'resilient/prefer-safe-transformations': 'error',
        'resilient/no-silent-catch': 'error',
        'resilient/no-unhandled-promise-chain': 'error',
        'resilient/prefer-async-await': 'warn',
        'no-empty': ['error', { allowEmptyCatch: true }]
    }
};

const imports = {
    plugins: {
        import: importPlugin
    },
    rules: {
        'import/no-unresolved': 'error',
        'import/named': 'error',
        'import/namespace': 'error',
        'import/export': 'error'
    }
};

configs = { recommended, contracts, safety, imports };

export default plugin;
