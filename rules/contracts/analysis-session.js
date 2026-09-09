import { createBindingIndex } from './binding-evidence.js';
import { createFunctionFlows } from './flow.js';
import {
    copyDefinitionMetadata,
    getDefinitions,
    getFunctionNodes,
    isFunction,
    walk
} from './infer.js';
import { hasAnalysisAccessors } from './reference-variants.js';
import { isObject } from '../support/object.js';

const hasCensusAccessors = (node = {}) => hasAnalysisAccessors(node) ||
    Object.values(Object.getOwnPropertyDescriptors(node))
        .some(({ value = false } = {}) => Array.isArray(value) && hasAnalysisAccessors(value));
const hasSemanticAccessors = (value = {}) => {
    if (!isObject(value)) return false;

    const ignored = new Set(['start', 'end', 'loc', 'range', 'parent', 'tokens', 'comments']);
    const descriptors = Object.entries(Object.getOwnPropertyDescriptors(value));
    const own = descriptors.some(([key = '', { get = false, set = false } = {}] = []) => (
        !ignored.has(key) && Boolean(get || set)
    ));

    if (own) return true;

    const prototype = Object.getPrototypeOf(value);

    return prototype !== null && prototype !== Object.prototype && hasSemanticAccessors(prototype);
};

// The census preserves occurrences, including a shared node on separate paths.
// Local function/body and skip-functions walks retain their own stopping laws.
const createAnalysisSession = (program = {}, { externalDefinitions = {} } = {}) => {
    const nodes = [];
    const functions = [];
    walk(program, (node) => {
        // eslint-disable-next-line resilient/prefer-safe-transformations -- Private ordered census retains repeated AST identities without copying the growing prefix.
        nodes.push(node);

        if (isFunction(node)) {
            // eslint-disable-next-line resilient/prefer-safe-transformations -- Function occurrences share the census order; the AST is never mutated.
            functions.push(node);
        }
    });
    const canReuseCensus = !nodes.some(hasCensusAccessors);
    const canIndexBindings = !nodes.some(hasSemanticAccessors);
    const bindingIndex = canIndexBindings ? createBindingIndex(program) : false;
    const localDefinitions = getDefinitions(program, externalDefinitions, { functions, bindingIndex });
    const definitions = copyDefinitionMetadata({
        source: localDefinitions,
        target: { ...localDefinitions, ...externalDefinitions }
    });
    const getFunctions = () => canReuseCensus ? functions : getFunctionNodes(program);
    let completedFlows;
    const getFlows = () => {
        if (completedFlows) return completedFlows;

        const flows = createFunctionFlows({ program, definitions, functions: canReuseCensus ? functions : false });
        completedFlows = flows;

        return flows;
    };
    const visit = (source = {}, visitor, options = {}) => {
        const { skipFunctions = false } = options;

        if (!canReuseCensus || source !== program || skipFunctions) return walk(source, visitor, options);

        return nodes.forEach(node => visitor(node));
    };

    return { bindingIndex, canReuseCensus, definitions, getFunctions, getFlows, visit };
};

// Only local ESLint consumers use this cache. Documents own public mutable
// definitions; graph variants retain their separate live-environment law.
let localSessions = new WeakMap();
const getLocalAnalysisSession = (program = {}) => {
    if (!isObject(program)) return createAnalysisSession(program);

    const existing = localSessions.get(program);

    if (existing) return existing;

    const session = createAnalysisSession(program);
    const { canReuseCensus = false } = session;

    if (!canReuseCensus) return session;

    // eslint-disable-next-line resilient/prefer-safe-transformations -- Publish only a completed local analysis by AST identity; throws remain retryable and reentry cannot observe a partial session.
    localSessions.set(program, session);

    return session;
};
const clearLocalAnalysisSessions = () => {
    localSessions = new WeakMap();
};

export { clearLocalAnalysisSessions, createAnalysisSession, getLocalAnalysisSession };
