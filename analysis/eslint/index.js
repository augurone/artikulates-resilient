import noDestructuringFallback from './no-destructuring-fallback.js';
import noElse from './no-else.js';
import noLengthComparison from './no-length-comparison.js';
import noNestedIf from './no-nested-if.js';
import noNullAssignment from './no-null-assignment.js';
import noSilentCatch from './no-silent-catch.js';
import noUndefinedAssignment from './no-undefined-assignment.js';
import noUndefinedComparison from './no-undefined-comparison.js';
import noUnguardedCallbackInvocation from './no-unguarded-callback-invocation.js';
import noUnhandledPromiseChain from './no-unhandled-promise-chain.js';
import operatorLinebreak from './operator-linebreak.js';
import preferAsyncAwait from './prefer-async-await.js';
import preferDestructuredMemberAccess from './prefer-destructured-member-access.js';
import preferFalseyReturns from './prefer-falsey-returns.js';
import preferPrototypeMethods from './prefer-prototype-methods.js';
import preferSafeDestructuringDefaults from './prefer-safe-destructuring-defaults.js';
import preferSafeTransformations from './prefer-safe-transformations.js';
import preferSignatureDestructuring from './prefer-signature-destructuring.js';
import signatureContractCallSite from './signature-contract-call-site.js';
import signatureContractDestructuring from './signature-contract-destructuring.js';
import signatureContractOperation from './signature-contract-operation.js';
import signatureContractProperty from './signature-contract-property.js';
import signatureContractReturnConsistency from './signature-contract-return-consistency.js';

const rules = Object.freeze({
    'no-destructuring-fallback': noDestructuringFallback,
    'no-else': noElse,
    'no-length-comparison': noLengthComparison,
    'no-nested-if': noNestedIf,
    'no-null-assignment': noNullAssignment,
    'no-silent-catch': noSilentCatch,
    'no-undefined-assignment': noUndefinedAssignment,
    'no-undefined-comparison': noUndefinedComparison,
    'no-unguarded-callback-invocation': noUnguardedCallbackInvocation,
    'no-unhandled-promise-chain': noUnhandledPromiseChain,
    'operator-linebreak': operatorLinebreak,
    'prefer-async-await': preferAsyncAwait,
    'prefer-destructured-member-access': preferDestructuredMemberAccess,
    'prefer-falsey-returns': preferFalseyReturns,
    'prefer-prototype-methods': preferPrototypeMethods,
    'prefer-safe-destructuring-defaults': preferSafeDestructuringDefaults,
    'prefer-safe-transformations': preferSafeTransformations,
    'prefer-signature-destructuring': preferSignatureDestructuring,
    'signature-contract-destructuring': signatureContractDestructuring,
    'signature-contract-call-site': signatureContractCallSite,
    'signature-contract-operation': signatureContractOperation,
    'signature-contract-property': signatureContractProperty,
    'signature-contract-return-consistency': signatureContractReturnConsistency
});
const select = (names, severity = 'error') => Object.fromEntries(names.map(name => [`resilient/${name}`, severity]));
const contractNames = Object.keys(rules).filter(name => name.startsWith('signature-contract-'));
const safetyNames = ['prefer-safe-transformations', 'no-silent-catch', 'no-unguarded-callback-invocation', 'no-unhandled-promise-chain'];
const recommendedNames = Object.keys(rules).filter(name => ![...contractNames, ...safetyNames, 'prefer-async-await', 'operator-linebreak'].includes(name));
const plugin = { meta: Object.freeze({ name: 'resilient', version: '0.7.6' }), rules };
const configs = {
    recommended: { plugins: { resilient: plugin }, rules: {
        ...select(recommendedNames), 'operator-linebreak': 'off',
        'resilient/operator-linebreak': ['error', 'before', { overrides: { '&&': 'after', '||': 'after' } }]
    } },
    contracts: { plugins: { resilient: plugin }, rules: select(contractNames) },
    safety: { plugins: { resilient: plugin }, rules: { ...select(safetyNames), ...select(['prefer-async-await'], 'warn') } }
};

Object.defineProperty(plugin, 'configs', { value: Object.freeze(configs), enumerable: true });

export default Object.freeze(plugin);
