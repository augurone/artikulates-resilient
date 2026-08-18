export {
    contract,
    describe,
    getKind,
    isCompatible,
    isKnown,
    mergeContracts,
    unknown,
    withOptional
} from './model.js';

export {
    createContractDocument,
    getRange
} from './document.js';

export {
    createFunctionFlow,
    createFunctionFlows,
    getFlowContext,
    narrowContext
} from './flow.js';

export {
    getChildren,
    getDefinitions,
    getEnclosingFunction,
    getFunctionContext,
    getFunctionName,
    getFunctionNodes,
    getOperationExpectation,
    getPropertyName,
    getReturnNodes,
    getSignature,
    inferExpression,
    inferObjectExpression,
    inferPattern,
    isFunction,
    walk
} from './infer.js';
