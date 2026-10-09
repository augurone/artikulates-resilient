import { getSyntaxKinds } from './ast-boundary.js';

const hasTypeChecker = ({ getTypeAtLocation = false } = {}) => typeof getTypeAtLocation === 'function';

const isArrayLikeExpression = ({ checker = {}, node = {} } = {}) => {
    const {
        isArrayType = false,
        isTupleType = false,
        getTypeAtLocation = false
    } = checker;

    if (!hasTypeChecker({ getTypeAtLocation })) return false;

    const type = getTypeAtLocation.call(checker, node);

    return Boolean(
        isArrayType && isArrayType.call(checker, type) ||
        isTupleType && isTupleType.call(checker, type)
    );
};

const getSingleStatement = ({ typescript = {}, node = {} } = {}) => {
    const { Block = -1 } = getSyntaxKinds(typescript);

    if (!node) return {};

    const { kind = 0, statements: bodyStatements = [] } = node;
    const statements = kind === Block ? bodyStatements : [node];
    const [statement = {}] = statements;

    return statements.length === 1 ? statement : {};
};

export { getSingleStatement, hasTypeChecker, isArrayLikeExpression };
