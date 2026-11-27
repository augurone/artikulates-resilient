import { retain } from '../../../analysis/collections.js';
import { isFunction } from '../../../analysis/host/function.js';
import { getObject } from '../../../analysis/host/object.js';
import { traverse } from '../../../analysis/traversal.js';
import { getSyntaxKinds } from '../../utils/ast-boundary.js';
import { getChildren } from '../../utils/ast-traversal.js';
import { getDestructuringDecisionForNode } from '../policy/destructuring-agreements.js';
import { getScopeReferences, lexicalCapabilities } from '../understand/source-callables.js';
import { getConsumerContractKey } from '../understand/type-evidence.js';

const canLowerFunctionDeclaration = ({ decision = {} } = {}) => (
    getObject(getObject(decision).agreement).action === 'lower-equivalent-arrow'
);

const placeNativeFunctionDeclarationBoundary = ({ typescript = {}, node = {},
    evalObservedName = false } = {}) => {
    const {
        getSyntheticLeadingComments,
        setSyntheticLeadingComments,
        SyntaxKind: { SingleLineCommentTrivia = -1 } = {}
    } = typescript;

    if (!isFunction(getSyntheticLeadingComments) ||
        !isFunction(setSyntheticLeadingComments)) return node;

    const comments = getSyntheticLeadingComments(node) || [];
    const retained = comments.filter(({ text = '' } = {}) => !text.includes('eslint-disable-next-line func-style'));

    return setSyntheticLeadingComments(node, [...retained, {
        kind: SingleLineCommentTrivia,
        text: evalObservedName
            ? ' eslint-disable-next-line func-style, no-unused-vars -- Direct eval may observe this native function binding.'
            : ' eslint-disable-next-line func-style -- Native function declaration retains hoisting and callable capabilities.',
        hasTrailingNewLine: true,
        pos: -1,
        end: -1
    }]);
};

// An authored exception on the expression line or the line before it already
// owns the function-expression restriction.
const hasAuthoredRestriction = ({ typescript = {}, node = {} } = {}) => {
    const { getOriginalNode = false, getSourceFileOfNode = false, getLineAndCharacterOfPosition = false,
        skipTrivia = false } = typescript;

    if (![getOriginalNode, getSourceFileOfNode, getLineAndCharacterOfPosition, skipTrivia].every(isFunction)) return false;

    const original = getOriginalNode(node);
    const { pos = -1 } = getObject(original);
    const source = pos >= 0 && getSourceFileOfNode(original);

    if (!source) return false;

    const { text = '' } = getObject(source);
    const { line = 0 } = getLineAndCharacterOfPosition(source, skipTrivia(text, pos));

    return text.split('\n').slice(Math.max(0, line - 1), line + 1)
        .some(entry => /eslint-disable(?:-next)?-line\b[^\n]*\bno-restricted-syntax\b/u.test(entry));
};

const capabilityNames = Object.freeze({ 'dynamic-this': 'dynamic this', 'new-target': 'new.target', arguments: 'arguments' });
const escapedReason = 'Escaped function value keeps native construction.';

const getCapabilityReason = (capabilities = []) => {
    const names = capabilities.flatMap(capability => (
        Object.hasOwn(capabilityNames, capability) ? [capabilityNames[capability]] : []
    ));

    return names.length ? `Native function reads ${names.join(' and ')}.` : '';
};

// Only an immediately invoked callee is proven never to be constructed or to
// expose its prototype; any other value escapes with native construction.
const isImmediatelyInvoked = ({ typescript = {}, node = {} } = {}) => {
    const { getOriginalNode, SyntaxKind: { CallExpression = -1, ParenthesizedExpression = -1 } = {} } = typescript;

    if (!isFunction(getOriginalNode)) return false;

    const original = getOriginalNode(node);
    const { parent = {} } = getObject(original);
    const { kind = -2, parent: outer = {} } = getObject(parent);
    const [callee = {}, owner = {}] = kind === ParenthesizedExpression ? [parent, outer] : [original, parent];
    const { kind: ownerKind = -2, expression = false } = getObject(owner);

    return ownerKind === CallExpression && expression === callee;
};

// An ordinary function expression is retained only for a capability an arrow
// cannot express. The reason names that capability at this exact site.
const getFunctionExpressionReason = ({ typescript = {}, node = {}, evalObserved = false } = {}) => {
    const { asteriskToken = false, name = false } = node;
    const { text: functionName = '' } = getObject(name);
    const capabilities = [...lexicalCapabilities({ typescript, node })];

    if (asteriskToken) return 'Generator function has no arrow form.';

    if (capabilities.length) return getCapabilityReason(capabilities);

    if (functionName && getScopeReferences({ typescript, node, text: functionName, crossFunctions: true }).length)
        return 'Function expression name binds its own recursive reference.';

    if (!isImmediatelyInvoked({ typescript, node })) return escapedReason;

    return evalObserved ? 'Native function retains its invocation scope for direct eval.' : '';
};

const hasRestriction = ({ typescript = {}, node = {} } = {}) => {
    const { getSyntheticLeadingComments } = typescript;
    const comments = isFunction(getSyntheticLeadingComments) ? getSyntheticLeadingComments(node) || [] : [];

    return comments.some(({ text = '' } = {}) => text.includes('no-restricted-syntax')) ||
        hasAuthoredRestriction({ typescript, node });
};

// The inline block stays on the reported line and cannot trigger ASI.
const restrictFunctionExpression = ({ typescript = {}, node = {}, reason = '' } = {}) => {
    const { addSyntheticLeadingComment, SyntaxKind: { MultiLineCommentTrivia = -1 } = {} } = typescript;

    return isFunction(addSyntheticLeadingComment) ? addSyntheticLeadingComment(node, MultiLineCommentTrivia,
        ` eslint-disable-line no-restricted-syntax -- ${reason} `, false) : node;
};

// A strict zero-formal function has no mapped parameter aliases. Declare its
// variadic boundary without replacing its observable native arguments object.
const exposeNativeArguments = ({ typescript = {}, node = {}, strict = false } = {}) => {
    const { factory = {}, SyntaxKind: { ExpressionStatement = -1, StringLiteral = -1, DotDotDotToken = -1,
        FunctionExpression = -1, Identifier = -1 } = {} } = typescript;
    const { kind = 0, modifiers, asteriskToken, name, typeParameters, parameters = [], type, body = {} } = getObject(node);
    const { statements = [] } = getObject(body);
    const runtimeParameters = parameters.filter(({ name: { kind = 0, text = '' } = {} } = {}) => kind !== Identifier || text !== 'this');
    const uses = getScopeReferences({ typescript, node, text: 'arguments' });
    const directiveEnd = statements.findIndex(({ kind = 0, expression: { kind: expression = 0 } = {} } = {}) => (
        kind !== ExpressionStatement || expression !== StringLiteral
    ));
    const directives = statements.slice(0, directiveEnd < 0 ? statements.length : directiveEnd);

    if (!strict || runtimeParameters.length || asteriskToken || !uses.length ||
        directives.some(({ expression: { text = '' } = {} } = {}) => text === 'use strict')) return node;

    const supplied = factory.createUniqueName('supplied');
    const rest = factory.createParameterDeclaration(undefined, factory.createToken(DotDotDotToken), supplied);
    const observed = factory.createExpressionStatement(factory.createVoidExpression(supplied));
    const entered = typescript.setOriginalNode(factory.createBlock(
        [...statements.slice(0, directives.length), observed, ...statements.slice(directives.length)], true), typescript.getOriginalNode(body));
    const updated = kind === FunctionExpression
        ? factory.updateFunctionExpression(node, modifiers, asteriskToken, name, typeParameters, [...parameters, rest], type, entered)
        : factory.updateFunctionDeclaration(node, modifiers, asteriskToken, name, typeParameters, [...parameters, rest], type, entered);

    return typescript.setOriginalNode(updated, typescript.getOriginalNode(node));
};

// Retain native capabilities; only a capability-free immediate function has
// an equivalent arrow. Arguments objects are never replaced by arrays.
const placeFunctionExpression = ({ typescript = {}, node = {}, evalObserved = false } = {}) => {
    if (hasRestriction({ typescript, node })) return node;

    const { factory = {}, SyntaxKind: { EqualsGreaterThanToken = -1 } = {} } = typescript;
    const { modifiers, typeParameters, parameters = [], type, body = {} } = getObject(node);
    const reason = getFunctionExpressionReason({ typescript, node, evalObserved });

    if (reason) return restrictFunctionExpression({ typescript, node, reason });

    const arrow = factory.createArrowFunction(modifiers, typeParameters, parameters, type,
        factory.createToken(EqualsGreaterThanToken), body);

    return typescript.setOriginalNode(typescript.setTextRange(arrow, node), node);
};

const annotateNativeFunctionDeclarationBoundaries = ({
    typescript = {}, sourceFile = {}, context = {}, destructuringAgreements = {}
} = {}) => {
    const {
        SyntaxKind: {
            FunctionDeclaration: FunctionDeclarationKind2 = -1,
            FunctionExpression: FunctionExpressionKind = -1, Identifier = -1, CallExpression = -1
        } = {}
    } = typescript;
    const evalScopes = new WeakSet();

    traverse(sourceFile, { enter: node => getChildren({ typescript, node }), leave: (node = {}) => {
        const { kind = 0, expression = {}, questionDotToken = false } = getObject(node);
        const callee = kind === CallExpression ? typescript.skipOuterExpressions(expression) : {};
        const { kind: calleeKind = 0, text = '' } = getObject(callee);
        const direct = kind === CallExpression && !questionDotToken && calleeKind === Identifier && text === 'eval';

        if (direct || getChildren({ typescript, node }).some(child => evalScopes.has(child))) retain(evalScopes, node);
    } });
    const strict = typescript.isExternalModule(typescript.getOriginalNode(sourceFile)) && !evalScopes.has(sourceFile);
    const visit = (node = {}, covered = false) => {
        const leading = typescript.getSyntheticLeadingComments(node) || [];
        const enclosing = covered || leading.some(({ text = '' } = {}) => (
            /^\s*eslint-disable no-use-before-define -- source lifetime\s*$/u.test(text)
        ));
        const retained = enclosing ? leading.filter(({ text = '' } = {}) => (
            text !== ' eslint-disable-next-line no-use-before-define -- Native mutual recursion keeps forward calls hoisted.'
        )) : leading;
        const cleaned = retained.length === leading.length ? node : typescript.setSyntheticLeadingComments(node, retained);
        const visited = typescript.visitEachChild(cleaned, child => visit(child, enclosing), context);
        const { kind = 0, body = false } = getObject(visited);

        if (kind === FunctionExpressionKind) {
            const placed = placeFunctionExpression({ typescript, node: visited, evalObserved: evalScopes.has(node) });

            return getObject(placed).kind === FunctionExpressionKind ? exposeNativeArguments({ typescript, node: placed, strict }) : placed;
        }

        if (kind !== FunctionDeclarationKind2 || !body) return visited;

        const { contract = {} } = getDestructuringDecisionForNode({
            typescript, node: visited, destructuringAgreements, kinds: ['native-function-capability']
        });

        const { evalObservedName = false } = getObject(contract);

        return placeNativeFunctionDeclarationBoundary({ typescript, node: exposeNativeArguments({ typescript, node: visited, strict }), evalObservedName });
    };

    return typescript.visitNode(sourceFile, visit);
};

// The declaration contract owns why this lowered binding stays native.
const getNativeFunctionReason = ({ generator = false, capabilities = [], referenceRanges = [], directCallRanges = [],
    simpleParameters = false } = {}) => {
    if (generator) return 'Generator function has no arrow form.';

    const capabilityReason = getCapabilityReason(capabilities);

    if (capabilityReason) return capabilityReason;

    if (referenceRanges.length !== directCallRanges.length) return escapedReason;

    return simpleParameters ? 'Unreferenced function keeps native construction.'
        : 'Arrow equivalence for these formals is not proved.';
};

const lowerFunctionDeclaration = ({
    typescript = {}, node = {}, destructuringAgreements = {}
} = {}) => {
    const {
        NodeFlags: {
            Const: ConstKind8 = 0,
            Let: LetKind2 = 0
        } = {}
    } = typescript;

    const { SyntaxKind = {} } = typescript;
    const {
        DefaultKeyword: DefaultKeywordKind2 = -1,
        FunctionDeclaration: FunctionDeclarationKind2 = -1,
        AsyncKeyword: AsyncKeywordKind2 = -1,
        EqualsGreaterThanToken: EqualsGreaterThanTokenKind4 = -1
    } = SyntaxKind;
    const {
        kind: nodeKind = 0,
        body: nodeBody = false,
        modifiers = [],
        typeParameters,
        parameters,
        asteriskToken,
        name: nodeName
    } = getObject(node);
    const hasBody = !!nodeBody;
    const hasDefaultModifier = modifiers.some(({ kind = -1 } = {}) => kind === DefaultKeywordKind2);

    if (nodeKind !== FunctionDeclarationKind2 || !hasBody) return node;

    const { agreement = {}, contract: hoistedContract = {} } = getDestructuringDecisionForNode({
        typescript,
        node,
        destructuringAgreements,
        kinds: ['hoisted-function-cycle']
    });
    const nativeDecision = getDestructuringDecisionForNode({
        typescript,
        node,
        destructuringAgreements,
        kinds: ['native-function-capability']
    });
    const { agreement: nativeAgreement = {}, contract: nativeContract = {}, entry: nativeEntry = {} } = nativeDecision;
    const { kind: nativeKind = '' } = getObject(nativeEntry);
    const hasNativeDecision = nativeKind === 'native-function-capability';
    const retainDeclaration = getObject(agreement).action === 'retain-hoisted-function' ||
        getObject(nativeAgreement).action === 'retain-native-function-declaration' || !hasNativeDecision || hasDefaultModifier;

    if (retainDeclaration) {
        const { addSyntheticLeadingComment = false,
            SyntaxKind: { SingleLineCommentTrivia = -1 } = {}, factory: retainedFactory = {} } = typescript;

        const { forwardReturnRanges = [] } = getObject(hoistedContract);
        const { ReturnStatement = -1 } = getSyntaxKinds(typescript);
        const statements = (getObject(nodeBody).statements || []).map((statement = {}) => {
            if (getObject(statement).kind !== ReturnStatement ||
                !forwardReturnRanges.includes(getConsumerContractKey(statement))) return statement;

            return addSyntheticLeadingComment(retainedFactory.createReturnStatement(getObject(statement).expression), SingleLineCommentTrivia,
                ' eslint-disable-next-line no-use-before-define -- Native mutual recursion keeps forward calls hoisted.',
                true);
        });
        const multiline = retainedFactory.updateFunctionDeclaration(
            node,
            modifiers,
            asteriskToken,
            nodeName,
            typeParameters,
            parameters,
            getObject(node).type,
            retainedFactory.createBlock(statements, true)
        );

        return placeNativeFunctionDeclarationBoundary({
            typescript, node: multiline, evalObservedName: getObject(nativeContract).evalObservedName
        });
    }

    const { factory = {} } = typescript;
    const asyncModifier = modifiers.find(({ kind = -1 } = {}) => kind === AsyncKeywordKind2);
    const variableModifiers = modifiers.filter(({ kind = -1 } = {}) => kind !== AsyncKeywordKind2);
    const arrow = canLowerFunctionDeclaration({ decision: nativeDecision })
        ? factory.createArrowFunction(
            asyncModifier ? [asyncModifier] : undefined,
            typeParameters,
            parameters,
            undefined,
            factory.createToken(EqualsGreaterThanTokenKind4),
            nodeBody
        )
        : restrictFunctionExpression({ typescript, node: factory.createFunctionExpression(
            asyncModifier ? [asyncModifier] : undefined,
            asteriskToken,
            nodeName,
            typeParameters,
            parameters,
            undefined,
            nodeBody
        ), reason: getNativeFunctionReason({ ...getObject(nativeContract), generator: Boolean(asteriskToken) }) });
    const declaration = factory.createVariableDeclaration(nodeName, undefined, undefined, arrow);

    return factory.createVariableStatement(
        variableModifiers.length ? variableModifiers : undefined,
        factory.createVariableDeclarationList(
            [declaration],
            getObject(nativeContract).mutableBinding ? LetKind2 : ConstKind8
        )
    );
};

export {
    annotateNativeFunctionDeclarationBoundaries,
    lowerFunctionDeclaration
};
