import { getObject } from '../../../rules/support/object.js';
import { getSyntaxKinds, updateFunction, updateVariableDeclarationFields } from '../../utils/ast-boundary.js';
import {
    getCallExpressionName,
    getCallIdentifierArgument
} from '../understand/type-evidence.js';

const lowerGuardedBindingExtraction = ({
    typescript = {},
    sourceFile = {},
    context = {}
} = {}) => {
    const {
        Block = -1,
        IfStatement = -1,
        VariableStatement = -1,
        VariableDeclaration = -1,
        ObjectBindingPattern = -1,
        BindingElement = -1,
        Identifier = -1,
        CallExpression = -1,
        PropertyAccessExpression = -1,
        BinaryExpression = -1,
        EqualsEqualsToken = -1,
        EqualsEqualsEqualsToken = -1,
        FunctionDeclaration = -1,
        FunctionExpression = -1,
        ArrowFunction = -1
    } = getSyntaxKinds(typescript);
    const { factory = {} } = typescript;
    const functionKinds = new Set([FunctionDeclaration, FunctionExpression, ArrowFunction]);
    const getGuardRoot = (condition = {}) => {
        const {
            kind: conditionKind = 0,
            operatorToken = {},
            left = {},
            right = {}
        } = getObject(condition);
        const { kind: operatorKind = 0 } = getObject(operatorToken);

        const guardName = getCallExpressionName({ typescript, node: condition });

        if (conditionKind === CallExpression && !/^(?:_?[Ii]s[A-Z]|_?[Hh]as[A-Z]|is_)/.test(guardName)) return '';

        if (conditionKind === CallExpression) return getCallIdentifierArgument({
            typescript,
            node: condition
        });

        if (conditionKind === BinaryExpression &&
            [EqualsEqualsToken, EqualsEqualsEqualsToken].includes(operatorKind)) {
            const member = [left, right]
                .find((cand = {}) => {
                    const { expression = {}, name = {}, kind: candidateKind = 0 } = getObject(cand);
                    const { kind: candExprKind = 0 } = getObject(expression);
                    const { text: candNameText = '' } = getObject(name);

                    return candidateKind === PropertyAccessExpression &&
                    candExprKind === Identifier &&
                    ['_tag', 'tag'].includes(candNameText);
                });

            const { expression: memberExpr = {} } = getObject(member);
            const { text: memberExprText = '' } = getObject(memberExpr);

            return member ? memberExprText : '';
        }

        return '';
    };
    const hasIdentifier = (node, name = '') => {
        let found = false;
        const visit = (child) => {
            if (found || !child) return;

            const { kind: childKind = 0, text = '' } = getObject(child);

            if (childKind === Identifier && text === name) {
                found = true;

                return;
            }

            typescript.forEachChild(child, visit);
        };

        visit(node);

        return found;
    };
    const getBindingName = (element) => {
        const { name = {} } = getObject(element);
        const { kind: nameKind = 0, text = '' } = getObject(name);

        return nameKind === Identifier ? text : '';
    };
    const getMovedElements = ({ pattern = {}, statementIndex = -1, guardIndex = -1, statements = [] } = {}) => {
        const { elements: patternElements = [] } = getObject(pattern);
        const elements = patternElements.filter((element) => {
            const { kind: elementKind = 0, dotDotDotToken = false } = getObject(element);

            return (
                elementKind === BindingElement &&
            !dotDotDotToken &&
            getBindingName(element)
            );
        });
        const [guard = {}] = statements.slice(guardIndex, guardIndex + 1);
        const { thenStatement = {} } = getObject(guard);
        const outside = [
            ...statements.slice(statementIndex + 1, guardIndex),
            ...statements.slice(guardIndex + 1)
        ];

        return elements.filter((element) => {
            const name = getBindingName(element);

            return hasIdentifier(thenStatement, name) &&
                !outside.some(candidate => hasIdentifier(candidate, name));
        });
    };
    const lowerBlock = (block) => {
        const { statements: blockStatements = [] } = getObject(block);
        const statements = blockStatements.map(statement => (
            // eslint-disable-next-line no-use-before-define -- visitor delegates block nodes back to this lowerer
            typescript.visitEachChild(statement, visit, context)
        ));
        let nextStatements = [];
        let movedGuards = new Map();

        statements.forEach((statement, statementIndex) => {
            if (movedGuards.has(statementIndex)) {
                nextStatements = [...nextStatements, movedGuards.get(statementIndex)];

                return;
            }

            // eslint-disable-next-line resilient/prefer-safe-destructuring-defaults -- Absent AST modifiers must remain absent in factory update.
            const { kind: statementKind = 0, declarationList = {}, modifiers } = getObject(statement);
            const { declarations = [], flags: declListFlags = 0 } = getObject(declarationList);

            if (statementKind !== VariableStatement ||
                declarations.length !== 1) {
                nextStatements = [...nextStatements, statement];

                return;
            }

            const [declaration = {}] = declarations;
            const {
                name: pattern = {},
                initializer = {},
                kind: declarationKind = 0
            } = getObject(declaration);
            const { kind: patternKind = 0, elements: patternElements = [] } = getObject(pattern);
            const { kind: initKind = 0, text: initText = '' } = getObject(initializer);

            if (declarationKind !== VariableDeclaration ||
                patternKind !== ObjectBindingPattern ||
                initKind !== Identifier) {
                nextStatements = [...nextStatements, statement];

                return;
            }

            const guardIndex = statements.findIndex((candidate = {}, index) => {
                const { kind: candKind = 0, elseStatement: candElse = false, expression: candExpr = {} } = getObject(candidate);

                return index > statementIndex &&
                    candKind === IfStatement &&
                    !candElse &&
                    getGuardRoot(candExpr) === initText;
            });
            const moved = guardIndex < 0
                ? []
                : getMovedElements({
                    pattern,
                    statementIndex,
                    guardIndex,
                    statements
                });

            if (!moved.length) {
                nextStatements = [...nextStatements, statement];

                return;
            }

            const retained = patternElements.filter(element => !moved.includes(element));

            if (retained.length) {
                nextStatements = [...nextStatements, factory.updateVariableStatement(
                    statement,
                    modifiers,
                    factory.updateVariableDeclarationList(
                        declarationList,
                        [updateVariableDeclarationFields({
                            factory, declaration, name: factory.createObjectBindingPattern(retained), initializer
                        })]
                    )
                )];
            }

            const movedStatement = factory.createVariableStatement(
                modifiers,
                factory.createVariableDeclarationList([
                    updateVariableDeclarationFields({
                        factory, declaration, name: factory.createObjectBindingPattern(moved), initializer
                    })
                ], declListFlags)
            );
            const [guard = {}] = statements.slice(guardIndex, guardIndex + 1);

            const {
                thenStatement: guardThen = {},
                expression: guardExpr = {},
                elseStatement: guardElse = undefined
            } = getObject(guard);
            const { kind: guardThenKind = 0, statements: guardThenStatements = [] } = getObject(guardThen);
            const thenBlock = guardThenKind === Block
                ? guardThen
                : factory.createBlock([guardThen], true);
            const updatedGuard = factory.updateIfStatement(
                guard,
                guardExpr,
                factory.updateBlock(thenBlock, [movedStatement, ...guardThenStatements]),
                guardElse
            );

            movedGuards = new Map([...movedGuards, [guardIndex, updatedGuard]]);
        });

        return factory.updateBlock(block, nextStatements);
    };
    const visit = (node) => {
        if (!node) return node;

        const { kind: nodeKind = 0, body = false, parameters: nodeParams = [] } = getObject(node);

        if (nodeKind === Block) return lowerBlock(node);

        if (!functionKinds.has(nodeKind)) return typescript.visitEachChild(node, visit, context);

        if (!body) return node;

        const { kind: bodyKind = 0 } = getObject(body);
        const nextBody = bodyKind === Block ? lowerBlock(body) : visit(body);

        return nextBody === body
            ? node
            : updateFunction({
                typescript,
                node,
                parameters: nodeParams,
                body: nextBody
            });
    };

    return visit(sourceFile);
};

export {
    lowerGuardedBindingExtraction
};
