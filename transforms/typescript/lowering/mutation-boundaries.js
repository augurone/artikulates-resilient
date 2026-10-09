import { getObject } from '../../../rules/support/object.js';
import { getSyntaxKinds } from '../../utils/ast-boundary.js';

const annotateRetainedMutationBoundaries = ({ typescript = {}, sourceFile = {} } = {}) => {
    const {
        BinaryExpression = -1,
        CallExpression = -1,
        ClassDeclaration = -1,
        Constructor = -1,
        ExpressionStatement = -1,
        MultiLineCommentTrivia = -1,
        PrivateKeyword = -1,
        PropertyAccessExpression = -1,
        ProtectedKeyword = -1,
        PublicKeyword = -1,
        ReadonlyKeyword = -1,
        SingleLineCommentTrivia = -1,
        ThisKeyword = -1
    } = getSyntaxKinds(typescript);
    const {
        addSyntheticLeadingComment = false,
        addSyntheticTrailingComment = false,
        SyntaxKind: { FirstAssignment = -1, LastAssignment = -1 } = {}
    } = typescript;

    if (typeof addSyntheticLeadingComment !== 'function' ||
        typeof addSyntheticTrailingComment !== 'function') return sourceFile;

    const isThisWrite = (node = {}) => {
        const { kind = 0, expression = {} } = getObject(node);
        const { kind: expressionKind = 0, left = {}, operatorToken = {} } = getObject(expression);
        const { kind: leftKind = 0, expression: target = {} } = getObject(left);
        const { kind: operatorKind = 0 } = getObject(operatorToken);

        return kind === ExpressionStatement && expressionKind === BinaryExpression &&
            leftKind === PropertyAccessExpression && getObject(target).kind === ThisKeyword &&
            operatorKind >= FirstAssignment && operatorKind <= LastAssignment;
    };
    const isFreshSliceReverse = (node = {}) => {
        const { kind = 0, expression: reverseMember = {} } = getObject(node);
        const { kind: reverseKind = 0, name: reverseName = {}, expression: sliceCall = {} } = getObject(reverseMember);
        const { kind: sliceCallKind = 0, expression: sliceMember = {} } = getObject(sliceCall);
        const { kind: sliceKind = 0, name: sliceName = {} } = getObject(sliceMember);

        return kind === CallExpression && reverseKind === PropertyAccessExpression &&
            getObject(reverseName).text === 'reverse' && sliceCallKind === CallExpression &&
            sliceKind === PropertyAccessExpression && getObject(sliceName).text === 'slice';
    };
    const isParameterPropertyConstructor = (node = {}) => {
        const { kind = 0, parameters = [] } = getObject(node);

        return kind === Constructor && parameters.some(({ modifiers = [] } = {}) => modifiers.some(({ kind: modifierKind = 0 } = {}) => (
            [PrivateKeyword, ProtectedKeyword, PublicKeyword, ReadonlyKeyword].includes(modifierKind)
        )));
    };
    const visit = (node = {}, inClass = false, inParameterPropertyConstructor = false) => {
        const { kind = 0 } = getObject(node);
        const withinClass = inClass || kind === ClassDeclaration;
        const parameterPropertyConstructor = withinClass && isParameterPropertyConstructor(node);

        if (parameterPropertyConstructor) {
            addSyntheticLeadingComment(node, MultiLineCommentTrivia,
                ' eslint-disable resilient/prefer-safe-transformations -- Native parameter property initialization and constructor state writes retain class identity. ', true);
            addSyntheticTrailingComment(node, MultiLineCommentTrivia,
                ' eslint-enable resilient/prefer-safe-transformations ', true);
        }

        if (withinClass && !inParameterPropertyConstructor && isThisWrite(node)) {
            addSyntheticLeadingComment(
                node, SingleLineCommentTrivia,
                ' eslint-disable-next-line resilient/prefer-safe-transformations -- Native class state is intentionally updated on this instance.',
                true
            );
        }

        if (isFreshSliceReverse(node)) {
            addSyntheticTrailingComment(
                node, MultiLineCommentTrivia,
                ' eslint-disable-line resilient/prefer-safe-transformations -- Reverse mutates a fresh slice. ',
                true
            );
        }

        typescript.forEachChild(node, child => visit(child, withinClass,
            inParameterPropertyConstructor || parameterPropertyConstructor));
    };

    visit(sourceFile);

    return sourceFile;
};

export { annotateRetainedMutationBoundaries };
