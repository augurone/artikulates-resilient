import { getObject } from '../../../analysis/host/object.js';
import { createSourceCensus } from './source-census.js';
import { getConsumerContractKey, getTupleParameterRequirements } from './type-evidence.js';

// Requirement collection and callable execution keep separate owners. A report
// joins their original source identities without manufacturing a policy action.
export const collectSourceEvidence = ({ typescript = {}, sourceFile = {}, checker = {}, sourceAnalysis = {},
    census = createSourceCensus({ typescript, sourceFile }) } = {}) => {
    const { source = false, functions = [], consumers = [], checkFunction = false, checkTuple = false } = sourceAnalysis;

    if (!source) return false;

    if (typeof checkFunction !== 'function' || typeof checkTuple !== 'function') throw new TypeError('Expected compiler evidence queries');

    const { SyntaxKind: { FunctionDeclaration = -1, ArrowFunction = -1, FunctionExpression = -1, ArrayBindingPattern = -1 } = {} } = typescript;
    const descriptors = new Map(functions.map((descriptor) => {
        const { location: { range = [] } = {} } = descriptor;

        return [range.join(':'), descriptor];
    }));
    const tuples = new Map(consumers.map((descriptor) => {
        const { functionIndex = -1 } = descriptor;

        return [functionIndex, descriptor];
    }));
    const entries = census.select(FunctionDeclaration, ArrowFunction, FunctionExpression).flatMap((node) => {
        const { parameters = [] } = node;
        const parameterIndex = parameters.findIndex(({ name: { kind = -1 } = {} } = {}) => kind === ArrayBindingPattern);

        if (parameterIndex < 0) return [];

        const key = getConsumerContractKey(node);
        const descriptor = descriptors.get(key);

        if (!descriptor) throw new Error('Compiler callable report source identity mismatch');

        const { index = -1 } = descriptor;
        const tupleDescriptor = tuples.get(index);
        const { index: tupleIndex = -1 } = tupleDescriptor ?? {};
        const runtimeEvidence = tupleDescriptor ? checkTuple({ index: tupleIndex, node, sourceFile }) : false;
        const { result: tupleResult = false } = getObject(runtimeEvidence);
        const result = runtimeEvidence ? tupleResult : checkFunction({ index, node, sourceFile });
        const collected = getTupleParameterRequirements({ typescript, node, checker, descriptor: tupleDescriptor || false });
        const { state = 'unknown', arity: length = 0, containers: requiredContainers = [], positions: requiredPositions = [] } = collected;
        const { type = false } = parameters.at(parameterIndex) ?? {};
        const checkerProvenance = type ? 'checker-annotation' : 'contextual-signature';
        const provenance = tupleDescriptor ? 'tuple-annotation' : checkerProvenance;
        const requirements = Object.freeze({ source, parameterIndex, state, provenance: state === 'known' ? provenance : 'unknown', arity: length,
            containers: Object.freeze(requiredContainers.map(({ path = [], arity = 0 } = {}) => Object.freeze({ path: Object.freeze([...path]), arity }))),
            positions: Object.freeze(requiredPositions.map(({ path = [], name = '', kind = '', requirements = [] } = {}) => Object.freeze({
                path: Object.freeze([...path]), name, kind, requirements: Object.freeze([...requirements])
            }))) });

        return [Object.freeze({ descriptor, requirements, result, ...(runtimeEvidence ? { runtimeEvidence } : {}) })];
    });

    return Object.freeze({ source, functions: Object.freeze(entries) });
};
