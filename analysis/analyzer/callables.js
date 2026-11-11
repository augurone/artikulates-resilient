import { put, retain } from '../collections.js';
import { traverse } from '../traversal.js';

export const synchronousFunction = ({ type = '', async = false, generator = false } = {}) => (
    ['ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration'].includes(type) && !async && !generator
);
const callableFunction = ({ type = '' } = {}) => ['ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration'].includes(type);

// Immutable callable identity is safe across a lexical capture when its source
// initializer precedes that read. This does not admit captured mutable values.
export const bindingSources = ({ bindings = [], callableResolutions = new WeakMap(), importTargets = new Map(), writes = new Set(), opaqueExecutions = new Set() } = {}) => {
    const callables = new Map();
    const namespaces = new Map();
    const completed = new Set();
    const eligible = ({ imported = false, stable = false, functionSource = false } = {}) => imported || stable || Boolean(functionSource);
    const sourceFor = (binding) => {
        const { imported = false, init = {}, functionSource = false } = binding;

        if (!imported) return functionSource || init;

        const target = importTargets.get(binding);
        const { execution = false, functionSource: { type = '' } = {} } = target ?? {};

        // A dependency's mutable export has no caller-owned initial phase.
        return type === 'FunctionDeclaration' && opaqueExecutions.has(execution) ? false : target;
    };
    const dependency = (binding) => {
        const source = sourceFor(binding);

        return importTargets.has(binding) ? source : callableResolutions.get(source);
    };

    bindings.forEach(binding => traverse(binding, { enter: (current) => {
        if (completed.has(current) || writes.has(current) || !eligible(current)) return [];

        retain(completed, current);
        const source = sourceFor(current);

        return source && !callableFunction(source) ? [dependency(current)].filter(Boolean) : [];
    }, leave: (current) => {
        if (writes.has(current) || !eligible(current)) return;

        const source = sourceFor(current);
        const callable = source && (callableFunction(source) ? source : callables.get(dependency(current)));
        const { namespace = false } = source ? source : {};
        const shared = namespace ? source : namespaces.get(dependency(current));

        if (callable) put(callables, current, callable);

        if (shared) put(namespaces, current, shared);
    } }));

    return { callables, namespaces };
};

// Completion seals a callable only after its acquired body can reference the
// same lexical callable identity. The flow contains owned templates, never ASTs.
export const completeCallable = (model, flow) => {
    Object.defineProperty(model, 'flow', { value: Object.freeze(flow), enumerable: true });

    return Object.freeze(model);
};
