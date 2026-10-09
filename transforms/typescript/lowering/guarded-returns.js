import { isFunction } from '../../../analysis/host/function.js';
import { getObject } from '../../../analysis/host/object.js';
import {
    getSyntaxKinds,
    updateFunction
} from '../../utils/ast-boundary.js';
import {
    getMemberAlias,
    getMemberBindingStatement,
    isStaticMemberRead
} from '../grammar/member-access.js';
import { getDestructuringDecisionForNode } from '../policy/destructuring-agreements.js';
import { getPlacementPredicate } from '../policy/placement.js';
import { getBindingNames } from '../understand/imports.js';

const lowerGuardedConditionalReturns = ({
    typescript = {},
    sourceFile = {},

    placement = {},
    destructuringAgreements = {},
    context = {}
} = {}) => {
    const {
        Block = -1,
        ReturnStatement = -1,
        ConditionalExpression = -1,
        Identifier = -1,
        PropertyAccessExpression = -1,
        ParenthesizedExpression = -1,
        FunctionDeclaration = -1,
        FunctionExpression = -1,
        ArrowFunction = -1,
        StringLiteral = -1
    } = getSyntaxKinds(typescript);
    const { factory = {}, setOriginalNode, getOriginalNode } = typescript;
    const functionKinds = new Set([FunctionDeclaration, FunctionExpression, ArrowFunction]);
    const unwrap = (node) => {
        const { kind = 0, expression = false } = getObject(node);

        return kind === ParenthesizedExpression ? unwrap(expression) : node;
    };
    const getGuardName = (condition = {}) => {
        const { receiverName = '' } = getPlacementPredicate({ typescript, placement, expression: condition });
        const { left = {}, right = {} } = getObject(condition);
        const source = [left, right].map(read => getDestructuringDecisionForNode({
            typescript, node: read, destructuringAgreements, kinds: ['selected-model-read']
        })).find(({ contract: { operationRole = '' } = {}, agreement: { action = '' } = {} } = {}) => (
            operationRole === 'discriminator-read' && ['selected-model-read', 'retain-source-phase-read'].includes(action)
        ));
        const { contract: { source: { provider = '' } = {} } = {} } = getObject(source);

        return receiverName || provider;
    };
    const hasGuardedConditional = (node) => {
        const candidate = unwrap(node);

        const { kind = 0, condition = {}, whenTrue = false, whenFalse = false } = getObject(candidate);

        if (kind !== ConditionalExpression) return false;

        return Boolean(getGuardName(condition) || hasGuardedConditional(whenTrue) || hasGuardedConditional(whenFalse));
    };
    const getReads = (branch = {}) => {
        const candidate = unwrap(branch);
        const { kind = 0, expression: { kind: receiverKind = 0, text: objectName = '' } = {},
            name: { kind: nameKind = 0, text: propertyName = '' } = {} } = getObject(candidate);

        if (kind !== PropertyAccessExpression || receiverKind !== Identifier || nameKind !== Identifier ||
            !isStaticMemberRead({ typescript, node: candidate })) return new Map();

        const { agreement = {} } = getDestructuringDecisionForNode({
            typescript, node: candidate, destructuringAgreements, kinds: ['exact-provider-forward']
        });

        return getObject(agreement).action === 'exact-provider-forward'
            ? new Map([[`${objectName}.${propertyName}`, candidate]]) : new Map();
    };
    const getBranch = (branch = {}, occupied = new Set(), rootName = '') => {
        let available = occupied;
        const reads = new Map([...getReads(branch)].filter(([, { expression: { text = '' } = {} } = {}]) => (
            !rootName || text === rootName
        )));
        let aliases = new Map();
        let members = new Map();

        reads.forEach((read = {}, key) => {
            const { expression: { text: objectName = '' } = {}, name: { text: propertyName = '' } = {} } = read;
            const { agreement = {} } = getDestructuringDecisionForNode({
                typescript, node: read, destructuringAgreements, kinds: ['exact-provider-forward']
            });
            const { action = '' } = agreement;
            const forwarded = action === 'exact-provider-forward';
            const alias = getMemberAlias({ objectName, propertyName, occupied: available });

            aliases = new Map([...aliases, [key, alias]]);
            available = new Set([...available, alias]);

            const currentMembers = members.get(objectName) || [];

            members = new Map([
                ...members,
                [objectName, [...currentMembers, {
                    propertyName, alias, canonical: '', sourceNode: forwarded ? read : false
                }]]
            ]);
        });

        const replace = (child) => {
            const { kind: childKind = 0, expression: { kind: receiverKind = 0, text: objectName = '' } = {}, name: { text: propertyName = '' } = {} } = child;

            const alias = aliases.get(`${objectName}.${propertyName}`);

            if (childKind === PropertyAccessExpression &&
                receiverKind === Identifier &&
                alias) return factory.createIdentifier(alias);

            return typescript.visitEachChild(child, replace, context);
        };
        const rewritten = aliases.size ? replace(branch) : branch;
        const declarationsForBranch = [...members.entries()].map(([objectName = '', branchMembers = []]) => (
            getMemberBindingStatement({
                typescript,
                factory,
                objectName,
                members: branchMembers
            })
        ));

        return {
            expression: rewritten,
            declarations: declarationsForBranch,
            members
        };
    };

    const lowerReturn = (node, parent = {}) => {
        const { kind: nodeKind = 0, expression: sourceExpression = false } = node;
        const expression = unwrap(sourceExpression);

        if (nodeKind !== ReturnStatement || !expression) return node;

        const { kind: expressionKind = 0, condition = false, whenTrue = false, whenFalse = false } = expression;

        if (expressionKind !== ConditionalExpression || !condition) return node;

        const getGuardRoot = () => getGuardName(condition);
        const root = getGuardRoot();

        const directForward = getReads(whenTrue).size || getReads(whenFalse).size;

        if (!root && !directForward && !hasGuardedConditional(whenTrue) && !hasGuardedConditional(whenFalse)) return node;

        const occupied = new Set(getBindingNames({ typescript, node: parent }));
        const createReturn = branch => factory.createReturnStatement(branch);
        const lowerBranch = (branch) => {
            const candidate = unwrap(branch);

            const { kind: candidateKind = 0, condition: candidateCondition = {} } = candidate;

            const getNestedStatements = () => {
                if (candidateKind !== ConditionalExpression || !getGuardName(candidateCondition)) return [];

                const nestedLowered = lowerReturn(
                    factory.createReturnStatement(candidate),
                    parent
                );
                const { kind: nestedLoweredKind = 0, statements: nestedStatements = [] } = nestedLowered;

                return nestedLoweredKind === Block ? nestedStatements : [];
            };
            const nestedStatements = getNestedStatements();

            if (nestedStatements.length) return nestedStatements;

            const recursivelyLowered = lowerReturn(
                factory.createReturnStatement(branch),
                parent
            );

            const { kind: recursiveKind = 0, statements: recursiveStatements = [] } = recursivelyLowered;

            if (recursiveKind === Block) return recursiveStatements;

            const { declarations: loweredDeclarations = [], expression: loweredExpression = {} } = getBranch(branch, occupied);

            return [
                ...loweredDeclarations,
                createReturn(loweredExpression)
            ];
        };
        const trueStatements = lowerBranch(whenTrue);
        const falseStatements = lowerBranch(whenFalse);

        const guard = factory.createIfStatement(
            condition,
            factory.createBlock(trueStatements, true)
        );
        const { agreement = {} } = getDestructuringDecisionForNode({
            typescript, node: expression, destructuringAgreements,
            kinds: ['ordered-decision']
        });

        if (getObject(agreement).action === 'retain-ordered-decision' &&
            isFunction(setOriginalNode)) {
            setOriginalNode(guard, isFunction(getOriginalNode)
                ? getOriginalNode(expression) : expression);
        }

        return factory.createBlock([
            guard,
            ...falseStatements
        ], true);
    };
    const lowerBlock = (block) => {
        const lowerStatements = (remaining) => {
            const [rawStatement = {}] = remaining;
            const { kind: rawKind = 0 } = getObject(rawStatement);

            if (!rawKind) return [];

            const statement = typescript.visitEachChild(
                rawStatement,
                (child) => {
                    const { kind: childKind17 = 0 } = getObject(child);

                    if (functionKinds.has(childKind17)) return child;

                    return childKind17 === Block ? lowerBlock(child) : child;
                },
                context
            );

            const lowered = lowerReturn(statement, block);
            const { kind: loweredKind = 0 } = getObject(lowered);
            const fullyLowered = loweredKind === Block ? lowerBlock(lowered) : lowered;
            const { kind: fullyLoweredKind = 0, statements: fullyLoweredStatements = [] } = getObject(fullyLowered);

            return [
                ...(fullyLoweredKind === Block ? fullyLoweredStatements : [fullyLowered]),
                ...lowerStatements(remaining.slice(1))
            ];
        };
        const { statements: blockStatements = [] } = getObject(block);
        const statements = lowerStatements(blockStatements);
        const directiveIndex = statements.findIndex(({ expression = {} } = {}) => {
            const { kind: expressionKind = 0 } = expression;

            return expressionKind !== StringLiteral;
        });
        const ordered = directiveIndex < 0
            ? statements
            : statements.slice(0, directiveIndex).concat(statements.slice(directiveIndex));

        return factory.updateBlock(block, ordered);
    };
    const visit = (node) => {
        if (!node) return node;

        const visited = typescript.visitEachChild(node, child => visit(child), context);
        const { kind: visitedKind = 0, body: visitedBody = false, parameters: visitedParams = [] } = getObject(visited);

        if (!functionKinds.has(visitedKind)) return visited;

        if (!visitedBody) return visited;

        const body = visitedBody;
        const bodyExpression = unwrap(body);
        const { kind: bodyExpressionKind = 0 } = bodyExpression;
        const loweredExpression = bodyExpressionKind === ConditionalExpression
            ? lowerReturn(factory.createReturnStatement(body), visited)
            : {};
        const { kind: bodyKind = 0 } = getObject(body);
        const { kind: loweredExprKind = 0 } = getObject(loweredExpression);
        const getLoweredBody = () => {
            if (bodyKind === Block) return lowerBlock(body);

            if (loweredExprKind === Block) return loweredExpression;

            return body;
        };
        const loweredBody = getLoweredBody();

        return loweredBody === body
            ? visited
            : updateFunction({
                typescript,
                node: visited,
                parameters: visitedParams,
                body: loweredBody
            });
    };

    return typescript.visitNode(sourceFile, visit);
};

export {
    lowerGuardedConditionalReturns
};
