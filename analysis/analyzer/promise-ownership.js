import { createPromiseChains, unhandledChain } from '../promise-chains.js';
import { locationOf } from './locations.js';

// Acquisition retains policy facts and owned expressions, never host syntax.
export const preparePromiseOwnership = ({ expressionStatements = [], parents = new WeakMap() } = {}, expressionFor) => {
    if (typeof expressionFor !== 'function') throw new TypeError('Expected shared expression acquisition');

    const chains = createPromiseChains(node => parents.get(node));

    return expressionStatements.map(({ expression = {} } = {}, index) => {
        const { type = '', operator = '' } = expression;
        const chain = chains.chainFor(expression);
        const { catch: caught = false } = chain;
        const ownership = [caught && 'catch', type === 'AwaitExpression' && 'await', type === 'AssignmentExpression' && 'assignment',
            type === 'UnaryExpression' && operator === 'void' && 'void', 'dropped'].find(Boolean);
        const { expression: wrapped = {} } = expression;
        const { type: wrappedType = '' } = wrapped;
        const eligible = ['CallExpression', 'NewExpression'].includes(type) || (type === 'ChainExpression' && wrappedType === 'CallExpression');

        return { expression: eligible && expressionFor(expression), descriptor: Object.freeze({ index, ownership, eligible,
            chain: unhandledChain(chain), location: locationOf(expression) }) };
    });
};
