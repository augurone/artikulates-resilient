import { put, retain } from '../collections.js';
import { traverse } from '../traversal.js';
import { locationOf } from './locations.js';

const nativeLength = ({ type = '', computed = false, object = {}, property: { name = '' } = {} } = {}, identities) => {
    const { type: kind = '', name: subject = '' } = object;

    return type === 'MemberExpression' && !computed && name === 'length' && kind === 'Identifier' && subject === 'arguments' && !identities.has(object);
};
const returning = (entries) => {
    const outcomes = new Set();

    traverse(entries, { enter: (statements) => {
        const [first = {}] = statements;
        const { type = '', body = [] } = first;

        if (statements.length === 1 && type === 'BlockStatement') return [body];

        retain(outcomes, statements.length === 1 && type === 'ReturnStatement');

        return [];
    } });

    return outcomes.has(true) && !outcomes.has(false);
};

// A dispatched count is owned by the callee. The existing reference/parent index
// proves which formals the returned case can observe, including lexical captures.
// This pass never evaluates a body or borrows facts from a caller.
export const acquireArity = ({ functionEntries = [], references = [], identities = new WeakMap(), parents = new WeakMap(),
    argumentOwners = new Map(), dynamicExecutions = new Set() } = {}) => {
    const candidates = new Map();
    const casesFor = new WeakMap();
    const invalid = new Set();
    const result = new WeakMap();

    functionEntries.forEach(({ node = {}, execution = false, body: { type: bodyType = '', body = [] } = {}, params = [] } = {}) => {
        if (bodyType !== 'BlockStatement') return;

        const argumentOwner = argumentOwners.get(execution);
        const [first = {}] = body;
        const { type: kind = '', discriminant = {}, cases = [] } = first;
        const simple = params.every(({ type = '' } = {}) => type === 'Identifier');

        if (argumentOwner !== execution || kind !== 'SwitchStatement' || !simple || dynamicExecutions.has(execution) || !nativeLength(discriminant, identities)) return;

        const inert = cases.filter(({ test = false } = {}) => test).every(({ test: { type = '' } = {} } = {}) => type === 'Literal');

        if (!inert) return;

        const counts = new Set();

        cases.forEach((entry) => {
            const { test = false, consequent = [] } = entry;

            if (!test) return;

            const { type = '', value = -1 } = test;

            if (counts.has(value)) return;

            retain(counts, value);

            if (type !== 'Literal' || !Number.isInteger(value) || value < 0 || value >= params.length || !returning(consequent)) return;

            const selected = { node, execution, count: value, location: locationOf(entry) };

            put(candidates, entry, selected);
        });
    });
    const caseFor = (node) => {
        traverse(node, { enter: current => casesFor.has(current) || candidates.has(current) ? [] : [parents.get(current)].filter(Boolean),
            leave: current => put(casesFor, current, candidates.get(current) || casesFor.get(parents.get(current)) || false) });

        return casesFor.get(node);
    };

    references.forEach(({ node = {}, execution = false, unsupported = false } = {}) => {
        const selected = caseFor(node);

        if (!selected) return;

        const { execution: owner = false, count = 0 } = selected;
        const binding = identities.get(node);
        const { execution: bindingOwner = false, parameterSource: { index = -1 } = {}, declaration: { node: declared = false } = {} } = binding ?? {};
        const { name = '' } = node;
        const currentArguments = name === 'arguments' && !binding && argumentOwners.get(execution) === owner;
        const omitted = bindingOwner === owner && (index < 0 || index >= count);

        if (node !== declared && (unsupported || dynamicExecutions.has(execution) || currentArguments || omitted)) retain(invalid, selected);
    });
    Map.groupBy([...candidates.values()].filter(entry => !invalid.has(entry)), ({ node = {} } = {}) => node).forEach((entries, node) => {
        put(result, node, Object.freeze(entries.map(({ count = 0, location = {} } = {}) => Object.freeze({ count, location }))));
    });

    return result;
};
