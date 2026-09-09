import { getObject } from '../../../rules/support/object.js';
import {
    getSyntaxKinds,
    updateBindingInitializer,
    updateCallArguments,
    updateFunction,
    updateIfBranches,
    updateVariableInitializer
} from '../../utils/ast-boundary.js';
import {
    getMemberAlias,
    getMemberBindingStatement,
    isStaticMemberRead
} from '../grammar/member-access.js';
import { getBindingPropertyName } from '../grammar/resolvers.js';
import {
    getBindingAgreement,
    getBindingDecision,
    getAgreementDefaultInitializer
} from '../policy/defaults.js';
import { getDestructuringDecisionForNode } from '../policy/destructuring-agreements.js';
import { getPlacementContract, getPlacementReason } from '../policy/placement.js';
import { getBindingNames } from '../understand/imports.js';
import {
    getCallExpressionName,
    getCallIdentifierArgument
} from '../understand/type-evidence.js';

const lowerGuardedConditionalReturns = ({
    typescript = {},
    sourceFile = {},

    placement = {},
    destructuringAgreements = {},
    context = {}
} = {}) => {
    const {
        SyntaxKind: {
            ExpressionStatement: ExpressionStatementKind2 = -1,
            VariableStatement: VariableStatementKind2 = -1,
            ObjectBindingPattern: ObjectBindingPatternKind3 = -1,
            IfStatement: IfStatementKind3 = -1
        } = {}
    } = typescript;

    const {
        Block = -1,
        ReturnStatement = -1,
        IfStatement = -1,
        ConditionalExpression = -1,
        CallExpression = -1,
        Identifier = -1,
        PropertyAccessExpression = -1,
        BinaryExpression = -1,
        EqualsEqualsToken = -1,
        EqualsEqualsEqualsToken = -1,
        BarBarToken = -1,
        AmpersandAmpersandToken = -1,
        ExclamationToken = -1,
        ParenthesizedExpression = -1,
        FunctionDeclaration = -1,
        FunctionExpression = -1,
        ArrowFunction = -1,
        StringLiteral = -1
    } = getSyntaxKinds(typescript);
    const { factory = {}, setOriginalNode = false, getOriginalNode = false } = typescript;
    const functionKinds = new Set([FunctionDeclaration, FunctionExpression, ArrowFunction]);
    const unwrap = (node) => {
        const { kind = 0, expression = false } = getObject(node);

        return kind === ParenthesizedExpression ? unwrap(expression) : node;
    };
    const getGuardName = (condition = {}) => {
        const { kind: conditionKind = 0, operatorToken: { kind: conditionOperator = 0 } = {}, left = {}, right = {} } = condition;

        const guard = getCallExpressionName({ typescript, node: condition });

        if (conditionKind === CallExpression && !/^(?:_?[Ii]s[A-Z]|_?[Hh]as[A-Z]|is_)/.test(guard)) return '';

        if (conditionKind === CallExpression) return getCallIdentifierArgument({
            typescript,
            node: condition
        });

        if (conditionKind === BinaryExpression &&
            [EqualsEqualsToken, EqualsEqualsEqualsToken].includes(conditionOperator)) {
            const member = [left, right]
                .find(({ expression: { kind: receiverKind = 0 } = {}, name: { text = '' } = {}, kind: candidateKind = 0 } = {}) => {
                    return candidateKind === PropertyAccessExpression && receiverKind === Identifier && ['_tag', 'tag'].includes(text);
                });
            const { expression: { text = '' } = {} } = getObject(member);

            return text;
        }

        return '';
    };
    const isGuard = (condition = {}, name = '') => getGuardName(condition) === name;
    const hasGuardedConditional = (node) => {
        const candidate = unwrap(node);

        const { kind = 0, condition = {}, whenTrue = false, whenFalse = false } = getObject(candidate);

        if (kind !== ConditionalExpression) return false;

        return Boolean(getGuardName(condition) || hasGuardedConditional(whenTrue) || hasGuardedConditional(whenFalse));
    };
    const getReads = (branch = {}) => {
        let reads = new Map();
        const visitBranchRead = (child, parent = {}) => {
            const {
                kind: childKind16 = 0,
                expression: { kind: receiverKind = 0, text: objectName = '' } = {},
                name: { kind: nameKind = 0, text: propertyName = '' } = {}
            } = getObject(child);

            if (!child || functionKinds.has(childKind16)) return;

            if (child !== branch && childKind16 === ConditionalExpression) return;

            const key = `${objectName}.${propertyName}`;
            const isNewRead = !reads.has(key);
            const { agreement: repeatedReadAgreement = {} } = getDestructuringDecisionForNode({
                typescript,
                node: child,
                destructuringAgreements,
                kinds: ['repeated-parameter-read']
            });

            if (childKind16 === PropertyAccessExpression &&
                receiverKind === Identifier &&
                nameKind === Identifier &&
                isStaticMemberRead({ typescript, node: child, parent }) &&
                isNewRead && getObject(repeatedReadAgreement).action !== 'retain-source-phase-read') {
                reads = new Map([...reads, [key, child]]);
            }

            typescript.forEachChild(child, next => visitBranchRead(next, child));
        };

        visitBranchRead(branch);

        return reads;
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

        const {
            kind: expressionKind = 0, left = {}, right: rightExpression = {}, arguments: args = [],
            operatorToken: { kind: operatorKind = 0 } = {}, condition = false, whenTrue = false, whenFalse = false
        } = expression;
        const { kind: rightExpressionKind = 0 } = getObject(unwrap(rightExpression));

        const lowerShortCircuitConditional = () => {
            if (expressionKind !== BinaryExpression ||
                ![BarBarToken, AmpersandAmpersandToken].includes(operatorKind) ||
                rightExpressionKind !== ConditionalExpression) return {};

            const right = lowerReturn(
                factory.createReturnStatement(rightExpression),
                parent
            );

            const { kind: rightKind = 0, statements: rightStatements = [] } = right;

            if (rightKind !== Block) return {};

            const shortCircuit = operatorKind === BarBarToken
                ? factory.createIfStatement(
                    left,
                    factory.createReturnStatement(left)
                )
                : factory.createIfStatement(
                    factory.createPrefixUnaryExpression(
                        ExclamationToken,
                        left
                    ),
                    factory.createReturnStatement(left)
                );

            return factory.createBlock([
                shortCircuit,
                ...rightStatements
            ], true);
        };
        const shortCircuitLowered = lowerShortCircuitConditional();

        if (getObject(shortCircuitLowered).kind === Block) return shortCircuitLowered;

        const lowerGuardedAnd = () => {
            if (expressionKind !== BinaryExpression || operatorKind !== AmpersandAmpersandToken) return {};

            // TypeScript represents `guard(value) && first && second` as a
            // left-associated binary tree.  The guard still owns every later
            // operand, so recover that finite conjunction before creating a
            // branch-local binding.  Do not search arbitrary boolean trees:
            // the first operand must be the known guard and every remaining
            // operand stays in its original left-to-right order.
            const getConjunctionTerms = (candidate = {}) => {
                const { kind: candidateKind = 0, operatorToken = {}, left: candidateLeft = {}, right: candidateRight = {} } = getObject(candidate);
                const { kind: candidateOperator = 0 } = getObject(operatorToken);

                return candidateKind === BinaryExpression && candidateOperator === AmpersandAmpersandToken
                    ? [...getConjunctionTerms(candidateLeft), candidateRight]
                    : [candidate];
            };
            const terms = getConjunctionTerms(expression);
            const [guardExpression = {}, ...guardedTerms] = terms;
            const guardedRoot = getGuardName(unwrap(guardExpression));

            if (!guardedRoot || !guardedTerms.length) return {};

            const guardedExpression = guardedTerms.reduce((current = {}, next = {}) => factory.createBinaryExpression(
                current,
                factory.createToken(AmpersandAmpersandToken),
                next
            ));

            const occupied = new Set(getBindingNames({ typescript, node: parent }));
            const { declarations: branchDeclarations = [], expression: branchExpression = {} } = getBranch(guardedExpression, occupied, guardedRoot);

            if (!branchDeclarations.length) return {};

            return factory.createBlock([
                factory.createIfStatement(
                    factory.createPrefixUnaryExpression(
                        ExclamationToken,
                        guardExpression
                    ),
                    factory.createReturnStatement(guardExpression)
                ),
                ...branchDeclarations,
                factory.createReturnStatement(branchExpression)
            ], true);
        };
        const guardedAndLowered = lowerGuardedAnd();

        if (getObject(guardedAndLowered).kind === Block) return guardedAndLowered;

        const lowerConditionalCall = () => {
            if (expressionKind !== CallExpression) return {};

            const conditionalArgument = args.find((argument) => {
                const { kind = 0 } = getObject(unwrap(argument));

                return kind === ConditionalExpression;
            });
            const conditional = unwrap(conditionalArgument);
            const { condition: conditionalCondition = {}, whenTrue: conditionalTrue = {}, whenFalse: conditionalFalse = {} } = getObject(conditional);
            const root = conditional && getGuardName(conditionalCondition);

            if (!conditional || !root) return {};

            const occupied = new Set(getBindingNames({ typescript, node: parent }));
            const getReturnExpression = branch => updateCallArguments({
                factory, call: expression,
                args: args.map(argument => unwrap(argument) === conditional ? branch : argument)
            });
            const lowerBranch = (branch) => {
                const { declarations: loweredDeclarations = [], expression: loweredExpression = {} } = getBranch(branch, occupied, root);

                return [
                    ...loweredDeclarations,
                    factory.createReturnStatement(getReturnExpression(loweredExpression))
                ];
            };

            return factory.createBlock([
                factory.createIfStatement(
                    conditionalCondition,
                    factory.createBlock(lowerBranch(conditionalTrue), true)
                ),
                ...lowerBranch(conditionalFalse)
            ], true);
        };
        const conditionalCallLowered = lowerConditionalCall();

        if (getObject(conditionalCallLowered).kind === Block) return conditionalCallLowered;

        if (expressionKind !== ConditionalExpression || !condition) return node;

        const getGuardRoot = () => getGuardName(condition);
        const root = getGuardRoot();

        if (!root && !hasGuardedConditional(whenTrue) && !hasGuardedConditional(whenFalse)) return node;

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
            typeof setOriginalNode === 'function') {
            setOriginalNode(guard, typeof getOriginalNode === 'function'
                ? getOriginalNode(expression) : expression);
        }

        return factory.createBlock([
            guard,
            ...falseStatements
        ], true);
    };
    const lowerGuardedIf = (statement = {}, parent = {}) => {
        const { kind: statementKind = 0, expression: sourceCondition = {}, thenStatement = {}, elseStatement = false } = statement;
        const { kind: thenKind = 0 } = thenStatement;

        if (statementKind !== IfStatement) return statement;

        const condition = unwrap(sourceCondition);

        const { kind: conditionKind = 0, operatorToken: { kind: conditionOperator = 0 } = {}, left = {}, right = {} } = condition;

        const lowerGuardedAnd = () => {
            if (conditionKind !== BinaryExpression ||
                conditionOperator !== AmpersandAmpersandToken ||
                elseStatement) return {};

            const guardedRoot = getGuardName(left);

            if (!guardedRoot) return {};

            const occupied = new Set(getBindingNames({ typescript, node: parent }));
            const sourceBody = thenKind === Block
                ? thenStatement
                : factory.createBlock([thenStatement], true);
            const { statements: sourceStatements = [] } = sourceBody;
            const candidate = factory.createBlock([
                factory.createExpressionStatement(right), ...sourceStatements
            ], true);
            const { expression: loweredExpression = {}, declarations: loweredDeclarations = [] } = getBranch(candidate, occupied, guardedRoot);
            const { kind: loweredKind = 0 } = loweredExpression;
            const loweredBody = loweredKind === Block
                ? loweredExpression
                : factory.createBlock([loweredExpression], true);
            const { statements: [{ kind: firstKind = 0, expression: firstExpression = {} } = {}, ...bodyStatements] = [] } = loweredBody;

            if (firstKind !== ExpressionStatementKind2 || !loweredDeclarations.length) return {};

            return factory.createIfStatement(
                left,
                factory.createBlock([
                    ...loweredDeclarations,
                    factory.createIfStatement(
                        firstExpression,
                        factory.createBlock(bodyStatements, true)
                    )
                ], true)
            );
        };
        const guardedAndLowered = lowerGuardedAnd();

        if (getObject(guardedAndLowered).kind === IfStatement) return guardedAndLowered;

        const root = getGuardName(condition);

        if (!root) return statement;

        const occupied = new Set(getBindingNames({ typescript, node: parent }));
        const lowerBranch = (branch) => {
            if (!branch) return branch;

            const { kind: branchKind = 0 } = branch;
            const body = branchKind === Block
                ? branch
                : factory.createBlock([branch], true);
            const reads = getReads(body);

            if (![...reads.values()].some(({ expression: { text = '' } = {} } = {}) => text === root)) return branch;

            const { expression: loweredExpression = {}, declarations: loweredDeclarations = [] } = getBranch(body, occupied, root);
            const { kind: loweredKind = 0 } = loweredExpression;
            const loweredBody = loweredKind === Block
                ? loweredExpression
                : factory.createBlock([loweredExpression], true);
            const { kind: loweredBodyKind = 0, statements: bodyStatements = [] } = loweredBody;
            const loweredStatements = loweredBodyKind === Block ? bodyStatements : [loweredBody];

            return factory.createBlock([
                ...loweredDeclarations,
                ...loweredStatements
            ], true);
        };

        return updateIfBranches({ factory, statement, transform: lowerBranch });
    };
    const hasIdentifier = (node, name = '') => {
        let found = false;
        const visit = (child) => {
            if (found || !child) return;

            const { kind: childKind = 0, text = '' } = child;

            if (childKind === Identifier && text === name) {
                found = true;

                return;
            }

            if (child !== node && childKind === ConditionalExpression) return;

            typescript.forEachChild(child, visit);
        };

        visit(node);

        return found;
    };
    const lowerGuardedDestructuring = (statement = {}, {
        kind: nextKind = 0,
        expression: nextExpression = false
    } = {}, parent = {}) => {
        const { kind: statementKind = 0, declarationList = {} } = statement;
        const { declarations: declarationNodes = [] } = declarationList;
        const [declaration = {}] = declarationNodes;
        const { name: pattern = {}, initializer = {} } = declaration;
        const { kind: patternKind = 0, elements: patternElements = [] } = pattern;
        const { kind: initializerKind = 0, text: initializerName = '' } = initializer;
        const expression = getObject(unwrap(nextExpression));
        const { arguments: args = [] } = expression;
        const getConditionalArgument = (value) => {
            const { kind: valueKind = 0, arguments: valueArgs = [] } = value;

            if (valueKind === ConditionalExpression) return value;

            if (valueKind !== CallExpression) return false;

            return valueArgs.find((argument) => {
                const { kind = 0 } = getObject(unwrap(argument));

                return kind === ConditionalExpression;
            });
        };
        const conditionalArgument = getConditionalArgument(expression);
        const conditional = unwrap(conditionalArgument);

        const { condition: conditionalCondition = {} } = getObject(unwrap(conditional));

        if (statementKind !== VariableStatementKind2 ||
            declarationNodes.length !== 1 ||
            patternKind !== ObjectBindingPatternKind3 ||
            initializerKind !== Identifier ||
            nextKind !== ReturnStatement ||
            !conditional ||
            !isGuard(conditionalCondition, initializerName)) return {};

        const elements = patternElements.filter(({ dotDotDotToken = false } = {}) => !dotDotDotToken);
        const getElementName = ({ name: { kind = 0, text = '' } = {} } = {}) => kind === Identifier ? text : '';
        let occupied = new Set(getBindingNames({ typescript, node: parent }));
        const createStatement = (branchElements) => {
            if (!branchElements.length) return false;

            const nextElements = branchElements.map((element) => {
                const { name: elementName = {} } = element;
                const { kind: nameKind = 0, text: nameText = '' } = elementName;
                const propertyName = getBindingPropertyName({ typescript, node: element });
                const checkerInfo = getPlacementContract({ typescript, node: elementName, placement });
                const { canonical: checkerInfoCanonical = '', kind: checkerInfoKind = '' } = checkerInfo;
                const agreementReason = !checkerInfoCanonical
                    ? getPlacementReason({ typescript, placement, node: elementName, kind: checkerInfoKind })
                    : '';
                const alias = elementName && nameKind === Identifier
                    ? nameText
                    : propertyName;
                const initializerForAgreement = getAgreementDefaultInitializer({
                    typescript,
                    factory,
                    decision: getBindingDecision({ agreement: getBindingAgreement({
                        canonical: checkerInfoCanonical || '',
                        guarded: agreementReason.startsWith('union branch'),
                        kind: agreementReason ? 'unknown' : '',
                        owner: agreementReason ? 'type-evidence' : 'caller',
                        evidence: agreementReason ? [agreementReason] : []
                    }) }),
                    name: alias
                });

                occupied = new Set([...occupied, alias]);

                return updateBindingInitializer({ factory, element, initializer: initializerForAgreement });
            });
            const nextPattern = factory.createObjectBindingPattern(nextElements);

            return updateVariableInitializer({
                factory, collection: { statement, declarationList, declaration },
                initializer, binding: nextPattern
            });
        };
        const getReturnExpression = (branch) => {
            if (expression === conditional) return branch;

            return updateCallArguments({
                factory, call: expression,
                args: args.map(argument => unwrap(argument) === conditional ? branch : argument)
            });
        };
        const lowerExpression = (branch) => {
            const candidate = unwrap(branch);
            const { kind: candidateKind = 0, condition = {}, whenTrue = {}, whenFalse = {} } = candidate;
            const { kind: conditionKind = 0, expression: { kind: guardKind = 0, text: guardName = '' } = {} } = condition;
            const guard = candidateKind === ConditionalExpression &&
                condition &&
                conditionKind === CallExpression &&
                guardKind === Identifier &&
                /^(?:_?[Ii]s[A-Z]|_?[Hh]as[A-Z]|is_)/.test(guardName);

            if (guard) {
                const trueStatements = lowerExpression(whenTrue);
                const falseStatements = lowerExpression(whenFalse);

                return [
                    factory.createIfStatement(
                        condition,
                        factory.createBlock(trueStatements, true)
                    ),
                    ...falseStatements
                ];
            }

            const used = elements.filter(element => hasIdentifier(
                candidate,
                getElementName(element)
            ));
            const declarationStatement = createStatement(used);

            return [
                ...(declarationStatement ? [declarationStatement] : []),
                factory.createReturnStatement(getReturnExpression(branch))
            ];
        };
        const statements = lowerExpression(conditional);

        const [{ kind: firstKind = 0 } = {}] = statements;

        return statements.length > 1 || firstKind === IfStatementKind3
            ? factory.createBlock(statements, true)
            : {};
    };
    const lowerBlock = (block) => {
        const lowerStatements = (remaining) => {
            const [rawStatement = {}, next = {}, ...rest] = remaining;
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

            const destructured = lowerGuardedDestructuring(statement, next, block);
            const { kind: destructuredKind = 0 } = getObject(destructured);

            if (destructuredKind === Block) {
                const { statements: destructuredStatements = [] } = getObject(lowerBlock(destructured));

                return [
                    ...destructuredStatements,
                    ...lowerStatements(rest)
                ];
            }

            const guarded = lowerGuardedIf(statement, block);
            const lowered = lowerReturn(guarded, block);
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
        const loweredExpression = bodyExpressionKind === ConditionalExpression ||
            bodyExpressionKind === BinaryExpression
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
