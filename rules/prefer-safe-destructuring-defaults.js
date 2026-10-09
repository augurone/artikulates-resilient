import { getArrayBindingFact, getObjectBindingFact } from './contracts/binding-patterns.js';
import { createCallableEvidence } from './contracts/callable-evidence.js';
import { getObject } from './support/object.js';

const reportMissingDefault = ({ node = {}, report, hasGuardedUse = undefined } = {}) => {
    const { value: sourceValue = node } = getObject(node);
    const value = getObject(sourceValue);

    const { type = '' } = value;

    if (['AssignmentPattern', 'RestElement'].includes(type) || hasGuardedUse(value)) return;

    if (typeof report !== 'function') return;

    report({
        node: value,
        messageId: 'safeDefault'
    });
};

export default {
    meta: {
        type: 'suggestion',
        docs: {
            description: 'Require explicit defaults for destructured values',
            url: 'https://github.com/augurone/artikulates-resilient/blob/main/docs/rules/prefer-safe-destructuring-defaults.md'
        },
        schema: [],
        messages: {
            safeDefault: 'Provide an explicit default for this destructured value.'
        }
    },
    create(context = {}) {
        const { report = () => {} } = context;
        const { hasGuardedUse = undefined } = createCallableEvidence(context);

        return {
            'ObjectPattern > Property'(node = {}) {
                if (getObjectBindingFact(node)) return;

                reportMissingDefault({ node, report, hasGuardedUse });
            },
            ArrayPattern({ elements = [], ...node } = {}) {
                if (getArrayBindingFact({ ...node, elements })) return;

                elements.filter(Boolean).forEach(element => reportMissingDefault({ node: element, report, hasGuardedUse }));
            }
        };
    }
};
