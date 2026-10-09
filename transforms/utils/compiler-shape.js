import { isFunction } from '../../analysis/host/function.js';
import { getObject } from '../../analysis/host/object.js';
import { getSyntaxKinds } from './ast-boundary.js';

const getSymbolDeclaration = (symbol) => {
    const { valueDeclaration } = getObject(symbol);

    return valueDeclaration;
};
const getSymbolDeclarations = symbol => getObject(symbol).declarations || [];
const isImplicitArgumentsSymbol = symbol => getObject(symbol).name === 'arguments' && !getSymbolDeclarations(symbol).length;

const hasTypeChecker = ({ getTypeAtLocation = false } = {}) => isFunction(getTypeAtLocation);

// CompilerOptions.configFile is diagnostic syntax metadata, often cyclic.
// Effective options already contain its settings; revision identity owns only
// those settings and must not serialize or retain the host's config AST.
const getCompilerOptionsIdentity = (options = {}) => JSON.stringify(Object.fromEntries(
    Object.entries(options).filter(([name = ''] = []) => name !== 'configFile')
));

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

export { getSymbolDeclaration, getSymbolDeclarations, isImplicitArgumentsSymbol, getSingleStatement, hasTypeChecker, isArrayLikeExpression, getCompilerOptionsIdentity };
