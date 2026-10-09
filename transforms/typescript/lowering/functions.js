import { getObject } from '../../../rules/support/object.js';
import { getSyntaxKinds } from '../../utils/ast-boundary.js';
import { getDestructuringDecisionForNode } from '../policy/destructuring-agreements.js';
import { getConsumerContractKey } from '../understand/type-evidence.js';

const canLowerFunctionDeclaration = ({ decision = {} } = {}) => (
    getObject(getObject(decision).agreement).action === 'lower-equivalent-arrow'
);

const placeNativeFunctionDeclarationBoundary = ({ typescript = {}, node = {},
    evalObservedName = false } = {}) => {
    const {
        getSyntheticLeadingComments = false,
        setSyntheticLeadingComments = false,
        SyntaxKind: { SingleLineCommentTrivia = -1 } = {}
    } = typescript;

    if (typeof getSyntheticLeadingComments !== 'function' ||
        typeof setSyntheticLeadingComments !== 'function') return node;

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

const annotateNativeFunctionDeclarationBoundaries = ({
    typescript = {}, sourceFile = {}, context = {}, destructuringAgreements = {}
} = {}) => {
    const {
        SyntaxKind: {
            FunctionDeclaration: FunctionDeclarationKind2 = -1
        } = {}
    } = typescript;
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

        if (kind !== FunctionDeclarationKind2 || !body) return visited;

        const { contract = {} } = getDestructuringDecisionForNode({
            typescript, node: visited, destructuringAgreements, kinds: ['native-function-capability']
        });

        return placeNativeFunctionDeclarationBoundary({
            typescript, node: visited, evalObservedName: getObject(contract).evalObservedName
        });
    };

    return typescript.visitNode(sourceFile, visit);
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
        typeParameters = undefined,
        parameters = undefined,
        asteriskToken = undefined,
        name: nodeName = undefined
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
    const hasNativeDecision = getObject(nativeEntry).kind === 'native-function-capability';
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
        : factory.createFunctionExpression(
            asyncModifier ? [asyncModifier] : undefined,
            asteriskToken,
            nodeName,
            typeParameters,
            parameters,
            undefined,
            nodeBody
        );
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
    canLowerFunctionDeclaration,
    lowerFunctionDeclaration
};
