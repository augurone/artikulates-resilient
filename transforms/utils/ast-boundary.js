import { getObject } from '../../rules/support/object.js';

const getSyntaxKinds = ({ SyntaxKind = {} } = {}) => getObject(SyntaxKind);

// Placement may split one source unit, but must not retarget an authored line
// directive. Block disables conservatively retain the entire file's layout;
// line disables elsewhere do not constrain this unit. Text matches inside
// literals may reject layout too; they never authorize a new suppression.
const hasAuthoredLayoutDirective = ({ typescript = {}, sourceFile = {}, node = {} } = {}) => {
    const { text = '' } = getObject(sourceFile);
    const original = typescript.getOriginalNode(node);
    const { pos = -1, end = -1 } = getObject(original);

    if (pos < 0 || end < pos || /eslint-disable(?:\s|$)/u.test(text)) return true;

    const lineStart = text.lastIndexOf('\n', pos - 1) + 1;
    const previousLine = lineStart ? text.lastIndexOf('\n', lineStart - 2) + 1 : 0;
    const followingLine = text.indexOf('\n', end);

    return /eslint-disable-(?:next-)?line\b/u.test(text.slice(previousLine, followingLine < 0 ? text.length : followingLine));
};

const getSourceRange = ({ typescript = {}, node = {} } = {}) => {
    const { getOriginalNode = false } = typescript;
    const original = typeof getOriginalNode === 'function' ? getOriginalNode(node) : node;
    const { pos = -1, end = -1 } = getObject(original);

    if (!Number.isInteger(pos) || !Number.isInteger(end) || pos < 0 || end < pos) return '';

    return `${pos}:${end}`;
};

const markGuardedNode = (node = {}) => {
    Object.defineProperty(node, '__resilientGuarded', {
        configurable: true,
        enumerable: false,
        value: true
    });

    return node;
};

const getNodeShape = ({
    kind = 0,
    text = '',
    pos = 0,
    end = 0,
    parent = {},
    name = {},
    expression = {},
    argumentExpression = {},
    initializer = {},
    type = {},
    body = {},
    statements = [],
    parameters = []
} = {}) => ({
    kind,
    text,
    pos,
    end,
    parent,
    name,
    expression,
    argumentExpression,
    initializer,
    type,
    body,
    statements,
    parameters
});

const getNodeText = ({ node = {}, sourceFile = {} } = {}) => {
    const {
        getText = false,
        pos = 0
    } = node;

    return typeof getText === 'function' && (!('pos' in node) || pos >= 0)
        ? getText.call(node, sourceFile)
        : '';
};

const requireDeclarationName = () => {
    throw new TypeError('A variable declaration name is required.');
};

const updateVariableDeclarationFields = ({
    factory = {}, declaration = {}, name = requireDeclarationName(), initializer = undefined
} = {}) => {
    const { exclamationToken = undefined, type = undefined } = getObject(declaration);

    return factory.updateVariableDeclaration(declaration, name, exclamationToken, type, initializer);
};

const updateVariableInitializer = ({
    factory = {},
    collection: { statement = {}, declarationList = {}, declaration = {} } = {},
    initializer = {},
    flags = false,
    binding = false
} = {}) => {
    // eslint-disable-next-line resilient/prefer-safe-destructuring-defaults -- A default changes the native null-statement TypeError message before any factory Get.
    const { modifiers } = statement;
    const { name = requireDeclarationName(), exclamationToken = undefined, type = undefined } = declaration;

    const updatedList = factory.updateVariableDeclarationList(declarationList, [
        factory.updateVariableDeclaration(declaration, binding || name, exclamationToken, type, initializer)
    ]);
    const { declarations = [] } = updatedList;
    const nextList = typeof flags === 'number'
        ? factory.createVariableDeclarationList(declarations, flags)
        : updatedList;

    return factory.updateVariableStatement(statement, modifiers, nextList);
};

const updateBindingInitializer = ({ factory = {}, element = {}, initializer = undefined } = {}) => {
    // eslint-disable-next-line resilient/prefer-safe-destructuring-defaults -- Defaults change the native null-element TypeError message before the binding factory Get.
    const { dotDotDotToken, propertyName, name = requireDeclarationName() } = element;

    return factory.updateBindingElement(element, dotDotDotToken, propertyName, name, initializer);
};

const updateCallArguments = ({ factory = {}, call = {}, args = [] } = {}) => {
    const { expression = requireDeclarationName(), typeArguments = undefined } = call;

    return factory.updateCallExpression(call, expression, typeArguments, args);
};

const updateIfBranches = ({ factory = {}, statement = {}, transform = requireDeclarationName() } = {}) => {
    const { expression = requireDeclarationName(), thenStatement = requireDeclarationName(), elseStatement = undefined } = statement;

    return factory.updateIfStatement(statement, expression, transform(thenStatement), transform(elseStatement));
};

const updateFunction = ({ typescript = {}, node = {}, parameters = [], body = {} } = {}) => {
    const {
        isFunctionDeclaration = false,
        isFunctionExpression = false,
        factory = {}
    } = getObject(typescript);
    const {
        updateFunctionDeclaration = false,
        updateFunctionExpression = false,
        updateArrowFunction = false
    } = getObject(factory);
    const {
        body: nodeBody = undefined,
        modifiers: nodeModifiers = undefined,
        asteriskToken: nodeAsterisk = undefined,
        name: nodeName = undefined,
        typeParameters: nodeTypeParams = undefined,
        type: nodeType = undefined,
        equalsGreaterThanToken: nodeEqualsGreater = undefined
    } = getObject(node);

    // An overload declaration has no executable body. It supplies source shape
    // to TypeScript but cannot participate in runtime grammar lowering.
    if (!nodeBody) return node;

    const nextBody = body ? body : nodeBody;

    if (typeof isFunctionDeclaration === 'function' && isFunctionDeclaration.call(typescript, node) && typeof updateFunctionDeclaration === 'function') return updateFunctionDeclaration.call(
        factory,
        node,
        nodeModifiers,
        nodeAsterisk,
        nodeName,
        nodeTypeParams,
        parameters,
        nodeType,
        nextBody
    );

    if (typeof isFunctionExpression === 'function' && isFunctionExpression.call(typescript, node) && typeof updateFunctionExpression === 'function') return updateFunctionExpression.call(
        factory,
        node,
        nodeModifiers,
        nodeAsterisk,
        nodeName,
        nodeTypeParams,
        parameters,
        nodeType,
        nextBody
    );

    if (typeof updateArrowFunction === 'function') return updateArrowFunction.call(
        factory,
        node,
        nodeModifiers,
        nodeTypeParams,
        parameters,
        nodeType,
        nodeEqualsGreater,
        nextBody
    );

    return node;
};

// A completed call agreement may need a statement owner without changing the
// expression's evaluation phase or manufacturing a return value.
const wrapExpressionArrowBody = ({ typescript = {}, node = {} } = {}) => {
    const { ArrowFunction = -1, Block = -1 } = getSyntaxKinds(typescript);
    const { kind = 0, body = false, parameters = [] } = getObject(node);

    if (kind !== ArrowFunction || getObject(body).kind === Block || !body) return node;

    const { factory = {} } = getObject(typescript);

    return updateFunction({ typescript, node, parameters,
        body: factory.createBlock([factory.createReturnStatement(body)], true) });
};

export {
    hasAuthoredLayoutDirective,
    getSourceRange,
    getNodeShape,
    getNodeText,
    getSyntaxKinds,
    markGuardedNode,
    updateBindingInitializer,
    updateCallArguments,
    wrapExpressionArrowBody,
    updateFunction,
    updateIfBranches,
    updateVariableDeclarationFields,
    updateVariableInitializer
};
