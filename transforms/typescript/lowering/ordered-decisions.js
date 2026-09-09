import { getObject } from '../../../rules/support/object.js';
import { getSyntaxKinds } from '../../utils/ast-boundary.js';
import { getDestructuringDecisionForNode } from '../policy/destructuring-agreements.js';

// A terminating first arm makes its alternate guard the next statement in
// the same block. This moves no expression across another observable effect.
const lowerOrderedDecisions = ({
    typescript = {}, sourceFile = {}, destructuringAgreements = {}, context = {}
} = {}) => {
    const { Block = -1, IfStatement = -1, ReturnStatement = -1,
        ThrowStatement = -1, ExclamationToken = -1,
        SingleLineCommentTrivia = -1, VariableStatement = -1,
        ObjectBindingPattern = -1, Identifier = -1 } = getSyntaxKinds(typescript);
    const { factory = {}, addSyntheticLeadingComment = false,
        getSyntheticLeadingComments = false } = typescript;
    const getDecision = (node = {}) => getDestructuringDecisionForNode({
        typescript, node, destructuringAgreements,
        kinds: ['ordered-decision']
    });
    const getAction = (node = {}) => getObject(getDecision(node).agreement).action || '';
    const terminates = (statement = {}) => {
        const { kind = 0, statements = [] } = getObject(statement);
        const terminal = kind === Block ? statements.at(-1) || {} : statement;

        return [ReturnStatement, ThrowStatement].includes(getObject(terminal).kind);
    };
    const annotateDeferredBindings = (block = {}, guardedSource = '') => {
        const visitBinding = (node = {}) => {
            const { kind = 0, declarationList = {} } = getObject(node);
            const { declarations = [] } = getObject(declarationList);
            const deferred = kind === VariableStatement && declarations.some((declaration = {}) => {
                const { name = {}, initializer = {} } = getObject(declaration);

                return getObject(name).kind === ObjectBindingPattern &&
                    getObject(initializer).kind === Identifier &&
                    getObject(initializer).text === guardedSource;
            });
            const comments = typeof getSyntheticLeadingComments === 'function'
                ? getSyntheticLeadingComments(node) || [] : [];
            const alreadyAnnotated = comments.some(({ text = '' } = {}) => (
                text.includes('resilient/prefer-signature-destructuring')
            ));

            if (deferred && !alreadyAnnotated && typeof addSyntheticLeadingComment === 'function') {
                addSyntheticLeadingComment(node, SingleLineCommentTrivia,
                    ' eslint-disable-next-line resilient/prefer-signature-destructuring -- Guarded payload Get remains after the original callback guard.', true);
            }
        };

        const { statements = [] } = getObject(block);

        statements.forEach(visitBinding);
    };
    const visit = (node = {}) => {
        const visited = typescript.visitEachChild(node, visit, context);
        const { kind = 0, statements = [] } = getObject(visited);

        if (kind !== Block) return visited;

        let changed = false;
        const lowerStatements = (remaining = []) => {
            const [statement = {}, ...suffix] = remaining;
            const { kind: statementKind = 0, expression = {}, thenStatement = {},
                elseStatement = {} } = getObject(statement);

            if (!statementKind) return [];

            if (statementKind === IfStatement &&
                getAction(statement) === 'flatten-terminated-nested-decision' &&
                getObject(thenStatement).kind === Block && terminates(thenStatement) &&
                suffix.length && terminates(suffix.at(-1)) &&
                !suffix.some(({ kind: suffixKind = 0 } = {}) => suffixKind === IfStatement)) {
                changed = true;
                const { contract = {} } = getDecision(statement);
                const { guardedSource = '' } = getObject(contract);

                annotateDeferredBindings(thenStatement, guardedSource);

                return [factory.createIfStatement(
                    factory.createPrefixUnaryExpression(
                        ExclamationToken, factory.createParenthesizedExpression(expression)
                    ),
                    factory.createBlock(suffix, true)
                ), thenStatement];
            }

            if (statementKind === IfStatement &&
                getAction(statement) === 'flatten-terminal-guards' &&
                getObject(elseStatement).kind === IfStatement) {
                changed = true;

                return [factory.updateIfStatement(statement, expression, thenStatement, undefined),
                    elseStatement, ...lowerStatements(suffix)];
            }

            return [statement, ...lowerStatements(suffix)];
        };
        const lowered = lowerStatements(statements);

        return changed ? factory.updateBlock(visited, lowered) : visited;
    };

    return typescript.visitNode(sourceFile, visit);
};

const annotateOrderedDecisionBoundaries = ({
    typescript = {}, sourceFile = {}, destructuringAgreements = {}
} = {}) => {
    const { IfStatement = -1, SingleLineCommentTrivia = -1,
        ArrowFunction = -1, FunctionExpression = -1,
        FunctionDeclaration = -1 } = getSyntaxKinds(typescript);
    const { addSyntheticLeadingComment = false, getSyntheticLeadingComments = false,
        setSyntheticLeadingComments = false } = typescript;

    if (typeof addSyntheticLeadingComment !== 'function' ||
        typeof getSyntheticLeadingComments !== 'function' ||
        typeof setSyntheticLeadingComments !== 'function') return sourceFile;

    const visit = (node = {}, ifDepth = 0) => {
        const { kind = 0 } = getObject(node);
        const { agreement = {} } = kind === IfStatement && ifDepth > 0
            ? getDestructuringDecisionForNode({
                typescript, node, destructuringAgreements,
                kinds: ['ordered-decision']
            }) : {};

        if (getObject(agreement).action === 'retain-ordered-decision') {
            const comments = getSyntheticLeadingComments(node) || [];
            const repeatedRead = comments.some(({ text = '' } = {}) => (
                text.includes('eslint-disable-next-line resilient/prefer-destructured-member-access')
            ));
            const retained = comments.filter(({ text = '' } = {}) => (
                !text.includes('eslint-disable-next-line resilient/no-nested-if') &&
                !text.includes('eslint-disable-next-line resilient/prefer-destructured-member-access')
            ));

            setSyntheticLeadingComments(node, retained);
            addSyntheticLeadingComment(node, SingleLineCommentTrivia,
                repeatedRead
                    ? ' eslint-disable-next-line resilient/no-nested-if, resilient/prefer-destructured-member-access -- Nested decision and repeated Get retain branch and getter timing.'
                    : ' eslint-disable-next-line resilient/no-nested-if -- Alternate variant branches retain their guarded payload-read phases.',
                true);
        }

        let nextDepth = ifDepth;

        if ([ArrowFunction, FunctionExpression, FunctionDeclaration].includes(kind)) nextDepth = 0;

        if (kind === IfStatement) nextDepth = ifDepth + 1;

        typescript.forEachChild(node, child => visit(child, nextDepth));
    };

    visit(sourceFile);

    return sourceFile;
};

export { annotateOrderedDecisionBoundaries, lowerOrderedDecisions };
