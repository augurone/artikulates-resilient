import { append } from '../collections.js';
import { createPromiseChains, unhandledChain } from '../promise-chains.js';
import { traverse } from '../traversal.js';
import { locationOf } from './locations.js';

const contributionChildren = ({ type = '', test = false, consequent = false, alternate = false, left = false, right = false, elements = [] } = {}) => {
    if (type === 'ConditionalExpression') return [test, consequent, alternate].filter(Boolean);

    if (type === 'LogicalExpression') return [left, right].filter(Boolean);

    return type === 'ArrayExpression' ? elements.filter(Boolean) : [];
};

// Acquisition retains policy facts and owned expressions, never host syntax.
export const preparePromiseOwnership = ({ expressionStatements = [], parents = new WeakMap() } = {}, expressionFor) => {
    if (typeof expressionFor !== 'function') throw new TypeError('Expected shared expression acquisition');

    const chains = createPromiseChains(node => parents.get(node));

    const prepared = [];
    const describe = (expression) => {
        const { type = '', operator = '' } = expression;
        const chain = chains.chainFor(expression);
        const { catch: caught = false } = chain;
        const ownership = [caught && 'catch', type === 'AwaitExpression' && 'await', type === 'AssignmentExpression' && 'assignment',
            type === 'UnaryExpression' && operator === 'void' && 'void', 'dropped'].find(Boolean);
        const { expression: wrapped = {} } = expression;
        const { type: wrappedType = '' } = wrapped;
        const eligible = ['CallExpression', 'NewExpression'].includes(type) || (type === 'ChainExpression' && wrappedType === 'CallExpression');

        return { ownership, eligible, chain: unhandledChain(chain), location: locationOf(expression) };
    };

    expressionStatements.forEach(({ expression = {} } = {}) => {
        const contributions = [];
        const root = describe(expression);

        traverse(expression, { enter: (current = {}) => {
            const descriptor = current === expression ? root : describe(current);
            const { ownership = '', eligible = false } = descriptor;

            if (eligible || ownership !== 'dropped') {
                append(contributions, { expression: current, descriptor });

                return [];
            }

            return contributionChildren(current);
        } });

        (contributions.length ? contributions : [{ expression, descriptor: root }]).forEach(({ expression: current = {}, descriptor = {} } = {}) => {
            const { eligible = false } = descriptor;

            append(prepared, { expression: eligible && expressionFor(current), boundary: eligible && expressionFor(expression),
                descriptor: Object.freeze({ index: prepared.length, ...descriptor }) });
        });
    });

    return prepared;
};
