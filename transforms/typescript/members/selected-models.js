import { isFunction } from '../../../analysis/host/function.js';
import { getObject } from '../../../analysis/host/object.js';
import { getSyntaxKinds, updateCallArguments, updateVariableDeclarationFields } from '../../utils/ast-boundary.js';
import { getDestructuringDecisionForNode } from '../policy/destructuring-agreements.js';
import { getPlacementPredicate } from '../policy/placement.js';
import { getBindingNames } from '../understand/imports.js';

// A completed source decision owns admission of a discriminator binding. The
// actual partition remains source evidence; retention decisions and missing
// decisions cannot be replaced by placement's union-property summaries.
const lowerSelectedModelDiscriminators = ({
    typescript = {},
    node = {},
    placement = {},
    destructuringAgreements = {},
    context = {}
} = {}) => {
    const {
        Block = -1,
        IfStatement = -1,
        WhileStatement = -1,
        ExpressionStatement = -1,
        VariableStatement = -1,
        ObjectBindingPattern = -1,
        BinaryExpression = -1,
        PropertyAccessExpression = -1,
        ArrayLiteralExpression = -1,
        ConditionalExpression = -1,
        CallExpression = -1,
        ReturnStatement = -1,
        Identifier = -1,
        StringLiteral = -1,
        NumericLiteral = -1,
        EqualsEqualsToken = -1,
        EqualsEqualsEqualsToken = -1,
        ExclamationEqualsToken = -1,
        ExclamationEqualsEqualsToken = -1,
        EqualsToken = -1
    } = getSyntaxKinds(typescript);
    const {
        NodeFlags: { Const: ConstKind = 0 } = {},
        factory = {},
        setOriginalNode,
        getOriginalNode
    } = typescript;
    // A selected tuple position that supplies an accepted collection update is
    // owned by collection placement.  Splitting it here would replace the
    // operation's one source-time read with an unrelated model binding before
    // collection grammar can reconstruct the update.
    const comparisons = new Set([
        EqualsEqualsToken,
        EqualsEqualsEqualsToken,
        ExclamationEqualsToken,
        ExclamationEqualsEqualsToken
    ]);
    const { kind: rootKind = 0 } = getObject(node);

    if (!node || rootKind === -1) return node;

    const getPredicateSelection = (expression = {}) => getPlacementPredicate({
        typescript,
        placement,
        expression
    });

    const getSelection = (statement = {}) => {
        const { kind = 0, expression = {} } = getObject(statement);
        const {
            kind: expressionKind = 0,
            left = {},
            right = {},
            operatorToken = {}
        } = getObject(expression);
        const { kind: operatorKind = 0 } = getObject(operatorToken);
        const candidates = [[left, right], [right, left]];

        if (kind !== IfStatement) return {};

        const predicate = getPredicateSelection(expression);

        const { receiverName: predicateReceiverName = '' } = getObject(predicate);

        if (predicateReceiverName) return predicate;

        if (expressionKind !== BinaryExpression || !comparisons.has(operatorKind)) return {};

        const [member = {}] = candidates.find(([candidate = {}, other = {}] = []) => {
            const { kind: candidateKind = 0, expression: receiver = {}, name = {} } = getObject(candidate);
            const { kind: receiverKind = 0 } = getObject(receiver);
            const { text: property = '' } = getObject(name);
            const { kind: literalKind = 0 } = getObject(other);

            return candidateKind === PropertyAccessExpression &&
                receiverKind === Identifier &&
                property &&
                [StringLiteral, NumericLiteral, getSyntaxKinds(typescript).TrueKeyword, getSyntaxKinds(typescript).FalseKeyword].includes(literalKind);
        }) || [];
        const { expression: receiver = {}, name = {} } = getObject(member);
        const { text: receiverName = '' } = getObject(receiver);
        const { text: property = '' } = getObject(name);

        const { agreement: { action = '' } = {}, contract: { operationRole = '' } = {} }
            = getDestructuringDecisionForNode({
                typescript, node: member, destructuringAgreements, kinds: ['selected-model-read']
            });

        return receiverName && property && action === 'selected-model-read' && operationRole === 'discriminator-read'
            ? { member, receiver, receiverName, property, expression }
            : {};
    };
    const getAvailableAlias = ({ receiverName = '', property = 'tag', occupied = new Set() } = {}) => {
        const normalized = property.replace(/^_+/, '') || 'tag';
        const base = `${receiverName}${normalized.slice(0, 1).toUpperCase()}${normalized.slice(1)}`;
        const next = (candidate = base, suffix = 2) => occupied.has(candidate)
            ? next(`${base}${suffix}`, suffix + 1)
            : candidate;

        return next();
    };
    const getAvailableName = ({ base = '', occupied = new Set() } = {}) => {
        const next = (candidate = base, suffix = 2) => occupied.has(candidate)
            ? next(`${base}${suffix}`, suffix + 1)
            : candidate;

        return next();
    };
    const isTerminating = (statement = {}) => {
        const { thenStatement = {}, kind = 0 } = getObject(statement);
        const { kind: thenKind = 0, statements = [] } = getObject(thenStatement);
        const [first = {}] = statements;

        const { kind: firstKind = 0 } = getObject(first);

        return kind === IfStatement && (thenKind === ReturnStatement ||
            thenKind === Block && firstKind === ReturnStatement);
    };
    const blockTerminatingBranch = (statement = {}) => {
        const { kind = 0, expression = {}, thenStatement = {}, elseStatement } = getObject(statement);

        const { kind: thenKind = 0 } = getObject(thenStatement);

        return kind === IfStatement && thenKind === ReturnStatement
            ? factory.updateIfStatement(
                statement,
                expression,
                factory.createBlock([thenStatement], true),
                elseStatement
            )
            : statement;
    };
    const getSelectedPayloadReturn = ({ statement = {}, occupied = new Set() } = {}) => {
        const { kind = 0, expression = {} } = getObject(statement);
        const { kind: expressionKind = 0, expression: receiver = {}, name = {} } = getObject(expression);
        const { kind: receiverKind = 0, text: receiverName = '' } = getObject(receiver);
        const { text: propertyName = '' } = getObject(name);

        const { agreement = {} } = getDestructuringDecisionForNode({
            typescript,
            node: expression,
            destructuringAgreements,
            kinds: ['selected-model-read']
        });
        const { action = '' } = agreement;

        if (kind !== ReturnStatement || expressionKind !== PropertyAccessExpression ||
            receiverKind !== Identifier || !propertyName ||
            action !== 'selected-model-read') return [statement];

        const alias = propertyName === 'value'
            ? getAvailableAlias({ receiverName, property: 'value', occupied })
            : getAvailableName({
                base: `${receiverName}${propertyName.slice(0, 1).toUpperCase()}${propertyName.slice(1)}`,
                occupied
            });
        const binding = factory.createBindingElement(
            undefined,
            factory.createIdentifier(propertyName),
            factory.createIdentifier(alias),
            factory.createVoidExpression(factory.createNumericLiteral(0))
        );
        const declaration = factory.createVariableStatement(
            undefined,
            factory.createVariableDeclarationList([
                factory.createVariableDeclaration(
                    factory.createObjectBindingPattern([binding]),
                    undefined,
                    undefined,
                    receiver
                )
            ], ConstKind)
        );

        if (isFunction(setOriginalNode)) setOriginalNode(declaration, expression);

        return [declaration, factory.updateReturnStatement(statement, factory.createIdentifier(alias))];
    };
    // A terminating branch selection also establishes one immediate static
    // payload argument to a plain local call.  The callee must be an
    // identifier and the payload its only argument: that keeps the source
    // evaluation order (callee, then payload) and turns exactly one selected
    // member read into a branch-local binding.  Member/dynamic callees and
    // multiple arguments remain outside this translation law.
    const getSelectedPayloadCallDeclaration = ({ statement = {}, sources = new Set(), occupied = new Set() } = {}) => {
        const { kind = 0, declarationList = {} } = getObject(statement);
        const { declarations = [] } = getObject(declarationList);
        const [declaration = {}] = declarations;
        const { initializer = {} } = getObject(declaration);
        const { kind: initializerKind = 0, expression: callee = {}, arguments: args = [] } = getObject(initializer);
        const [argument = {}] = args;
        const { kind: calleeKind = 0 } = getObject(callee);
        const { kind: argumentKind = 0, expression: receiver = {}, name = {} } = getObject(argument);
        const { kind: receiverKind = 0, text: receiverName = '' } = getObject(receiver);
        const { text: propertyName = '' } = getObject(name);

        if (kind !== VariableStatement || declarations.length !== 1 || initializerKind !== CallExpression ||
            calleeKind !== Identifier || args.length !== 1 || argumentKind !== PropertyAccessExpression ||
            receiverKind !== Identifier || !sources.has(receiverName) || !propertyName) return [statement];

        const { agreement: sourceAgreement = {} } = getDestructuringDecisionForNode({ typescript,
            node: argument, destructuringAgreements, kinds: ['selected-model-read'] });

        const { action: sourceAction = '' } = sourceAgreement;

        if (sourceAction !== 'selected-model-read') return [statement];

        const alias = getAvailableName({
            base: `${receiverName}${propertyName.slice(0, 1).toUpperCase()}${propertyName.slice(1)}`,
            occupied
        });
        const binding = factory.createVariableStatement(
            undefined,
            factory.createVariableDeclarationList([
                factory.createVariableDeclaration(
                    factory.createObjectBindingPattern([factory.createBindingElement(
                        undefined,
                        factory.createIdentifier(propertyName),
                        factory.createIdentifier(alias),
                        factory.createVoidExpression(factory.createNumericLiteral(0))
                    )]),
                    undefined,
                    undefined,
                    receiver
                )
            ], ConstKind)
        );
        const call = updateCallArguments({ factory, call: initializer, args: [factory.createIdentifier(alias)] });
        const updatedDeclaration = updateVariableDeclarationFields({
            factory, declaration, name: getObject(declaration).name, initializer: call
        });

        return [binding, factory.updateVariableStatement(
            statement,
            getObject(statement).modifiers,
            factory.updateVariableDeclarationList(declarationList, [updatedDeclaration])
        )];
    };
    // A terminating selector also establishes the opposite payload for the
    // immediately following simple array construction.  This is deliberately
    // narrower than a general expression hoist: `[result.right]` reads the
    // payload as its first and only observable work, so moving that one read
    // into the preceding branch-local binding preserves order and getter
    // timing.  Calls, computed members, and mixed expressions stay untouched.
    const getSelectedPayloadArrayDeclaration = ({ statement = {}, sources = new Set(), occupied = new Set() } = {}) => {
        const { kind = 0, declarationList = {} } = getObject(statement);
        const { declarations = [] } = getObject(declarationList);
        const [declaration = {}] = declarations;
        const { initializer = {} } = getObject(declaration);
        const { kind: initializerKind = 0, elements = [] } = getObject(initializer);
        const [element = {}] = elements;
        const { kind: elementKind = 0, expression: receiver = {}, name = {} } = getObject(element);
        const { kind: receiverKind = 0, text: receiverName = '' } = getObject(receiver);
        const { text: propertyName = '' } = getObject(name);

        if (kind !== VariableStatement || declarations.length !== 1 || initializerKind !== ArrayLiteralExpression ||
            elements.length !== 1 || elementKind !== PropertyAccessExpression || receiverKind !== Identifier ||
            !sources.has(receiverName) || !propertyName) return [statement];

        const { agreement: sourceAgreement = {} } = getDestructuringDecisionForNode({ typescript,
            node: element, destructuringAgreements, kinds: ['selected-model-read'] });

        const { action: sourceAction = '' } = sourceAgreement;

        if (sourceAction !== 'selected-model-read') return [statement];

        const alias = getAvailableName({
            base: `${receiverName}${propertyName.slice(0, 1).toUpperCase()}${propertyName.slice(1)}`,
            occupied
        });
        const binding = factory.createBindingElement(
            undefined,
            factory.createIdentifier(propertyName),
            factory.createIdentifier(alias),
            undefined
        );
        const selected = factory.createVariableStatement(
            undefined,
            factory.createVariableDeclarationList([
                factory.createVariableDeclaration(
                    factory.createObjectBindingPattern([binding]),
                    undefined,
                    undefined,
                    receiver
                )
            ], ConstKind)
        );
        const replacement = factory.updateArrayLiteralExpression(initializer, [factory.createIdentifier(alias)]);

        return [selected, factory.updateVariableStatement(
            statement,
            getObject(statement).modifiers,
            factory.updateVariableDeclarationList(declarationList, [updateVariableDeclarationFields({
                factory, declaration, name: getObject(declaration).name, initializer: replacement
            })])
        )];
    };
    // A discriminated recursive loop owns a repeating selection: each
    // iteration reads its checker-proven discriminator, terminates when the selected variant changes,
    // and only then reads the continuing payload.  `for (;;)` plus a direct
    // break states that ownership without hoisting either getter across an
    // iteration or inventing a value for the payload.
    const getSelectedModelLoop = ({ statement = {}, occupied = new Set() } = {}) => {
        const { kind = 0, expression: condition = {}, statement: body = {} } = getObject(statement);
        const { kind: conditionKind = 0, left = {}, right = {}, operatorToken = {} } = getObject(condition);
        const { kind: operatorKind = 0 } = getObject(operatorToken);
        const candidates = [[left, right], [right, left]];
        const [member = {}, literal = {}] = candidates.find(([candidate = {}, value = {}] = []) => {
            const { kind: candidateKind = 0, expression: receiver = {}, name = {} } = getObject(candidate);
            const { kind: receiverKind = 0, text: receiverName = '' } = getObject(receiver);
            const { text: propertyName = '' } = getObject(name);
            const { kind: literalKind = 0 } = getObject(value);

            return candidateKind === PropertyAccessExpression && receiverKind === Identifier && receiverName &&
                propertyName && [StringLiteral, NumericLiteral, getSyntaxKinds(typescript).TrueKeyword, getSyntaxKinds(typescript).FalseKeyword].includes(literalKind);
        }) || [];
        const { expression: receiver = {}, name: tagMember = {} } = getObject(member);
        const { text: receiverName = '' } = getObject(receiver);
        const { text: tagProperty = '' } = getObject(tagMember);

        const { kind: bodyKind = 0, statements = [] } = getObject(body);
        const [updateStatement = {}] = statements;
        const { kind: updateKind = 0, expression: update = {} } = getObject(updateStatement);
        const {
            kind: updateExpressionKind = 0,
            left: updateTarget = {},
            right: updateValue = {},
            operatorToken: updateOperator = {}
        } = getObject(update);
        const { kind: updateOperatorKind = 0 } = getObject(updateOperator);
        const { kind: targetKind = 0, text: targetName = '' } = getObject(updateTarget);
        let payload = {};
        const collectPayload = (candidate = {}) => {
            const { kind: candidateKind = 0, expression: candidateReceiver = {}, name = {} } = getObject(candidate);
            const { kind: candidateReceiverKind = 0, text: candidateReceiverName = '' } = getObject(candidateReceiver);
            const { text: propertyName = '' } = getObject(name);

            if (candidateKind === PropertyAccessExpression && candidateReceiverKind === Identifier &&
                candidateReceiverName === receiverName && propertyName && propertyName !== tagProperty) {
                payload = payload || {};
                payload = Object.keys(payload).length ? { ambiguous: true } : {
                    node: candidate,
                    receiver: candidateReceiver,
                    propertyName
                };

                return;
            }

            typescript.forEachChild(candidate, collectPayload);
        };
        collectPayload(updateValue);
        const { ambiguous = false, node: payloadNode = {}, receiver: payloadReceiver = {}, propertyName = '' } = getObject(payload);

        if (kind !== WhileStatement || conditionKind !== BinaryExpression ||
            ![EqualsEqualsToken, EqualsEqualsEqualsToken].includes(operatorKind) || !receiverName ||
            bodyKind !== Block || statements.length !== 1 ||
            updateKind !== ExpressionStatement || updateExpressionKind !== BinaryExpression ||
            updateOperatorKind !== EqualsToken || targetKind !== Identifier || targetName !== receiverName ||
            ambiguous || !getObject(payloadNode).kind || !propertyName) return statement;

        const { agreement: tagAgreement = {}, contract: { operationRole: tagRole = '' } = {} } = getDestructuringDecisionForNode({
            typescript, node: member, destructuringAgreements, kinds: ['selected-model-read']
        });
        const { agreement: fieldAgreement = {}, contract: fieldContract = {} } = getDestructuringDecisionForNode({
            typescript, node: payloadNode, destructuringAgreements, kinds: ['selected-model-read']
        });
        const { action: tagAction = '' } = tagAgreement;
        const { action: fieldAction = '' } = fieldAgreement;
        const { loopInput = false } = fieldContract;

        if (tagAction !== 'selected-model-read' || tagRole !== 'discriminator-read' || fieldAction !== 'selected-model-read' || !loopInput) return statement;

        const tagAlias = getAvailableAlias({ receiverName, property: tagProperty, occupied });
        const payloadAlias = getAvailableName({
            base: `${receiverName}${propertyName.slice(0, 1).toUpperCase()}${propertyName.slice(1)}`,
            occupied: new Set([...occupied, tagAlias])
        });
        const tagBinding = factory.createVariableStatement(
            undefined,
            factory.createVariableDeclarationList([
                factory.createVariableDeclaration(
                    factory.createObjectBindingPattern([factory.createBindingElement(
                        undefined,
                        factory.createIdentifier(tagProperty),
                        factory.createIdentifier(tagAlias),
                        factory.createVoidExpression(factory.createNumericLiteral(0))
                    )]),
                    undefined,
                    undefined,
                    receiver
                )
            ], ConstKind)
        );
        const stop = factory.createIfStatement(
            factory.createBinaryExpression(
                factory.createIdentifier(tagAlias),
                factory.createToken(ExclamationEqualsEqualsToken),
                literal
            ),
            factory.createBreakStatement(),
            undefined
        );
        const payloadBinding = factory.createVariableStatement(
            undefined,
            factory.createVariableDeclarationList([
                factory.createVariableDeclaration(
                    factory.createObjectBindingPattern([factory.createBindingElement(
                        undefined,
                        factory.createIdentifier(propertyName),
                        factory.createIdentifier(payloadAlias),
                        // A present-but-undefined payload remains exactly
                        // undefined. This default only records the native
                        // binding result; it does not normalize the model.
                        factory.createVoidExpression(factory.createNumericLiteral(0))
                    )]),
                    undefined,
                    undefined,
                    payloadReceiver
                )
            ], ConstKind)
        );

        if (isFunction(setOriginalNode)) {
            setOriginalNode(tagBinding, member);
            setOriginalNode(payloadBinding, payloadNode);
        }

        const replacePayload = (candidate = {}) => candidate === payloadNode
            ? factory.createIdentifier(payloadAlias)
            : typescript.visitEachChild(candidate, replacePayload, context);
        const replacementUpdate = replacePayload(updateStatement);

        const loweredLoop = factory.createForStatement(
            undefined,
            undefined,
            undefined,
            factory.createBlock([tagBinding, stop, payloadBinding, replacementUpdate], true)
        );

        return isFunction(setOriginalNode)
            ? setOriginalNode(loweredLoop, statement)
            : loweredLoop;
    };
    const getSelectedLoopReceiver = (statement = {}) => {
        const { kind = 0, expression = {} } = getObject(statement);
        const { kind: expressionKind = 0, left = {}, right = {}, operatorToken = {} } = getObject(expression);
        const { kind: operatorKind = 0 } = getObject(operatorToken);
        const [member = {}] = [[left, right], [right, left]].find(([
            candidate = {}, value = {}
        ] = []) => {
            const { kind: candidateKind = 0, expression: receiver = {}, name = {} } = getObject(candidate);
            const { kind: receiverKind = 0, text: receiverName = '' } = getObject(receiver);
            const { text: propertyName = '' } = getObject(name);
            const { kind: valueKind = 0, text: valueText = '' } = getObject(value);

            return candidateKind === PropertyAccessExpression && receiverKind === Identifier && receiverName &&
                propertyName && valueKind === StringLiteral && valueText;
        }) || [];
        const { expression: receiver = {}, name = {} } = getObject(member);
        const { text: receiverName = '' } = getObject(receiver);
        const { text: property = '' } = getObject(name);

        return kind === WhileStatement && expressionKind === BinaryExpression &&
            [EqualsEqualsToken, EqualsEqualsEqualsToken].includes(operatorKind) && receiverName && property
            ? receiverName
            : '';
    };
    // Generic member lowering precedes this loop rewrite. It may already have
    // turned the terminal read into `const { right: stepRight } = step;`.
    // Completing that one binding here carries the loop's terminal selection
    // through the actual pass order without a second analysis pass or a new
    // value: a present/missing `right` still resolves exactly to undefined.
    const completeSelectedLoopPayloadBinding = ({ statement = {}, sources = new Set() } = {}) => {
        const { kind = 0, declarationList = {} } = getObject(statement);
        const { declarations = [] } = getObject(declarationList);
        const [declaration = {}] = declarations;
        const { name: pattern = {}, initializer = {} } = getObject(declaration);
        const { kind: patternKind = 0, elements = [] } = getObject(pattern);
        const [element = {}] = elements;
        const { propertyName = {}, name = {}, initializer: elementInitializer } = getObject(element);
        const { kind: initializerKind = 0, text: sourceName = '' } = getObject(initializer);
        const { text: propertyNameText = '' } = getObject(propertyName);

        if (kind !== VariableStatement || declarations.length !== 1 || patternKind !== ObjectBindingPattern ||
            elements.length !== 1 || initializerKind !== Identifier || !sources.has(sourceName) ||
            !propertyNameText || elementInitializer) return statement;

        const { agreement: { action = '' } = {} } = getDestructuringDecisionForNode({
            typescript, node: element, destructuringAgreements, kinds: ['selected-model-read']
        });

        if (action !== 'selected-model-read') return statement;

        const nextElement = factory.updateBindingElement(
            element,
            propertyName,
            getObject(element).dotDotDotToken,
            name,
            factory.createVoidExpression(factory.createNumericLiteral(0))
        );
        const nextPattern = factory.updateObjectBindingPattern(pattern, [nextElement]);
        const nextDeclaration = updateVariableDeclarationFields({
            factory, declaration, name: nextPattern, initializer
        });

        return factory.updateVariableStatement(
            statement,
            getObject(statement).modifiers,
            factory.updateVariableDeclarationList(declarationList, [nextDeclaration])
        );
    };
    const completeSelectedLoopPayloadReturn = ({ statement = {}, occupied = new Set() } = {}) => getSelectedPayloadReturn({ statement, occupied });
    // A checker-proven predicate conditional already selects the inner model.
    // Keep the predicate at its source position, and move only the selected
    // generic payload reads into their respective branches. This is purposely
    // limited to one static payload per branch: calls, computed paths, and
    // repeated/escaped reads have different timing and remain untouched.
    const getSelectedPayloadConditionalReturn = ({ statement = {}, occupied = new Set() } = {}) => {
        const { kind = 0, expression = {} } = getObject(statement);
        const {
            kind: expressionKind = 0,
            condition = {},
            whenTrue = {},
            whenFalse = {}
        } = getObject(expression);
        const selection = getPredicateSelection(condition);
        const { receiver = {}, receiverName = '', property: discriminator = '' } = getObject(selection);
        const getSinglePayload = ({ branch = {} } = {}) => {
            let accesses = [];
            const collect = (candidate = {}) => {
                const { kind: candidateKind = 0, expression: candidateReceiver = {}, name = {} } = getObject(candidate);
                const { kind: receiverKind = 0, text: candidateReceiverName = '' } = getObject(candidateReceiver);
                const { text: propertyName = '' } = getObject(name);

                if (candidateKind === PropertyAccessExpression && receiverKind === Identifier &&
                    candidateReceiverName === receiverName && propertyName && propertyName !== discriminator) {
                    accesses = [...accesses, candidate];

                    return;
                }

                typescript.forEachChild(candidate, collect);
            };
            collect(branch);

            const [access = {}] = accesses;

            const { agreement: { action = '' } = {} } = getDestructuringDecisionForNode({
                typescript, node: access, destructuringAgreements, kinds: ['selected-model-read']
            });

            return accesses.length === 1 && branch === access && action === 'selected-model-read' ? access : {};
        };
        const trueAccess = getSinglePayload({ branch: whenTrue });
        const falseAccess = getSinglePayload({ branch: whenFalse });
        const { name: trueName = {} } = getObject(trueAccess);
        const { name: falseName = {} } = getObject(falseAccess);
        const { text: trueProperty = '' } = getObject(trueName);
        const { text: falseProperty = '' } = getObject(falseName);

        if (kind !== ReturnStatement || expressionKind !== ConditionalExpression || !receiverName ||
            !trueProperty || !falseProperty || !getObject(trueAccess).kind || !getObject(falseAccess).kind) return [statement];

        const trueAlias = getAvailableName({
            base: `${receiverName}${trueProperty.slice(0, 1).toUpperCase()}${trueProperty.slice(1)}`,
            occupied
        });
        const occupiedAfterTrue = new Set([...occupied, trueAlias]);
        const falseAlias = getAvailableName({
            base: `${receiverName}${falseProperty.slice(0, 1).toUpperCase()}${falseProperty.slice(1)}`,
            occupied: occupiedAfterTrue
        });
        const createBinding = ({ property = '', alias = '' } = {}) => factory.createVariableStatement(
            undefined,
            factory.createVariableDeclarationList([
                factory.createVariableDeclaration(
                    factory.createObjectBindingPattern([factory.createBindingElement(
                        undefined,
                        factory.createIdentifier(property),
                        factory.createIdentifier(alias),
                        factory.createVoidExpression(factory.createNumericLiteral(0))
                    )]),
                    undefined,
                    undefined,
                    receiver
                )
            ], ConstKind)
        );
        const replace = ({ branch = {}, access = {}, alias = '' } = {}) => {
            const visit = candidate => candidate === access
                ? factory.createIdentifier(alias)
                : typescript.visitEachChild(candidate, visit, context);

            return visit(branch);
        };
        const selectedBranch = factory.createIfStatement(
            condition,
            factory.createBlock([
                createBinding({ property: trueProperty, alias: trueAlias }),
                factory.createReturnStatement(replace({ branch: whenTrue, access: trueAccess, alias: trueAlias }))
            ], true),
            undefined
        );

        return [
            selectedBranch,
            createBinding({ property: falseProperty, alias: falseAlias }),
            factory.createReturnStatement(replace({ branch: whenFalse, access: falseAccess, alias: falseAlias }))
        ];
    };
    // A selected outer model can contain another discriminated model. Keep
    // each outer field read at its source-time use: an outer payload's discriminator and payload
    // are two reads in the source, so a successful inner branch deliberately extracts the outer
    // field twice. Hoisting it once would
    // change observable getter count and timing.
    const getNestedSelectedPayloadReturn = ({ statement = {}, sources = new Set(), occupied = new Set() } = {}) => {
        const { kind = 0, expression = {} } = getObject(statement);
        const {
            kind: expressionKind = 0,
            condition = {},
            whenTrue = {},
            whenFalse = {}
        } = getObject(expression);
        const { kind: conditionKind = 0, left = {}, right = {}, operatorToken = {} } = getObject(condition);
        const { kind: operatorKind = 0 } = getObject(operatorToken);
        const [tagRead = {}, tagLiteral = {}] = [[left, right], [right, left]].find(([
            candidate = {}, literal = {}
        ] = []) => {
            const { kind: candidateKind = 0, expression: inner = {}, name = {} } = getObject(candidate);
            const { kind: innerKind = 0, expression: outer = {}, name: outerName = {} } = getObject(inner);
            const { kind: outerKind = 0, text: sourceName = '' } = getObject(outer);
            const { text: member = '' } = getObject(outerName);
            const { text: tagName = '' } = getObject(name);
            const { kind: literalKind = 0, text: literalText = '' } = getObject(literal);

            return candidateKind === PropertyAccessExpression && innerKind === PropertyAccessExpression &&
                outerKind === Identifier && sources.has(sourceName) && member && tagName &&
                literalKind === StringLiteral && literalText;
        }) || [];
        const { expression: innerSource = {}, name: tagMember = {} } = getObject(tagRead);
        const { expression: source = {}, name: outerMember = {} } = getObject(innerSource);
        const { text: sourceName = '' } = getObject(source);
        const { text: outerProperty = '' } = getObject(outerMember);
        const { text: tagName = '' } = getObject(tagMember);
        let payloadReads = [];
        const collectPayload = (candidate = {}) => {
            const { kind: candidateKind = 0, expression: payloadInner = {}, name = {} } = getObject(candidate);
            const { kind: innerKind = 0, expression: payloadSource = {}, name: payloadOuterName = {} } = getObject(payloadInner);
            const { kind: sourceKind = 0, text: payloadSourceName = '' } = getObject(payloadSource);
            const { text: payloadOuterProperty = '' } = getObject(payloadOuterName);
            const { text: payloadName = '' } = getObject(name);

            if (candidateKind === PropertyAccessExpression && innerKind === PropertyAccessExpression &&
                sourceKind === Identifier && payloadSourceName === sourceName &&
                payloadOuterProperty === outerProperty && payloadName && payloadName !== tagName) {
                payloadReads = [...payloadReads, candidate];

                return;
            }

            typescript.forEachChild(candidate, collectPayload);
        };
        collectPayload(whenFalse);
        const [payloadRead = {}] = payloadReads;
        const { name: payloadMember = {} } = getObject(payloadRead);
        const { text: payloadProperty = '' } = getObject(payloadMember);

        const { agreement: { action: nestedTagAction = '' } = {}, contract: { operationRole: nestedTagRole = '' } = {} }
            = getDestructuringDecisionForNode({
                typescript, node: tagRead, destructuringAgreements, kinds: ['selected-model-read']
            });
        const { agreement: { action: nestedFieldAction = '' } = {} } = getDestructuringDecisionForNode({
            typescript, node: payloadRead, destructuringAgreements, kinds: ['selected-model-read']
        });

        if (kind !== ReturnStatement || expressionKind !== ConditionalExpression ||
            conditionKind !== BinaryExpression || ![EqualsEqualsToken, EqualsEqualsEqualsToken].includes(operatorKind) ||
            !sourceName || !outerProperty || nestedTagAction !== 'selected-model-read' ||
            nestedTagRole !== 'discriminator-read' || nestedFieldAction !== 'selected-model-read' ||
            payloadReads.length !== 1 || !payloadProperty) return [statement];

        const innerAlias = getAvailableName({
            base: `${sourceName}${outerProperty.slice(0, 1).toUpperCase()}${outerProperty.slice(1)}`,
            occupied
        });
        const innerAliasAgain = getAvailableName({
            base: `${innerAlias}Value`,
            occupied: new Set([...occupied, innerAlias])
        });
        const tagAlias = getAvailableAlias({ receiverName: innerAlias, occupied: new Set([...occupied, innerAlias, innerAliasAgain]) });
        const valueAlias = getAvailableName({
            base: `${innerAlias}Value`,
            occupied: new Set([...occupied, innerAlias, innerAliasAgain, tagAlias])
        });
        const createOuterBinding = (alias = '') => factory.createVariableStatement(
            undefined,
            factory.createVariableDeclarationList([
                factory.createVariableDeclaration(
                    factory.createObjectBindingPattern([factory.createBindingElement(
                        undefined,
                        factory.createIdentifier(outerProperty),
                        factory.createIdentifier(alias),
                        factory.createVoidExpression(factory.createNumericLiteral(0))
                    )]),
                    undefined,
                    undefined,
                    source
                )
            ], ConstKind)
        );
        const tagBinding = factory.createVariableStatement(
            undefined,
            factory.createVariableDeclarationList([
                factory.createVariableDeclaration(
                    factory.createObjectBindingPattern([factory.createBindingElement(
                        undefined,
                        factory.createIdentifier(tagName),
                        factory.createIdentifier(tagAlias),
                        factory.createStringLiteral('')
                    )]),
                    undefined,
                    undefined,
                    factory.createIdentifier(innerAlias)
                )
            ], ConstKind)
        );
        const valueBinding = factory.createVariableStatement(
            undefined,
            factory.createVariableDeclarationList([
                factory.createVariableDeclaration(
                    factory.createObjectBindingPattern([factory.createBindingElement(
                        undefined,
                        factory.createIdentifier(payloadProperty),
                        factory.createIdentifier(valueAlias),
                        factory.createVoidExpression(factory.createNumericLiteral(0))
                    )]),
                    undefined,
                    undefined,
                    factory.createIdentifier(innerAliasAgain)
                )
            ], ConstKind)
        );
        const replacePayload = candidate => candidate === payloadRead
            ? factory.createIdentifier(valueAlias)
            : typescript.visitEachChild(candidate, replacePayload, context);
        const tagComparison = factory.createBinaryExpression(
            factory.createIdentifier(tagAlias),
            getObject(condition).operatorToken,
            tagLiteral
        );

        return [
            createOuterBinding(innerAlias),
            tagBinding,
            factory.createIfStatement(tagComparison, factory.createBlock([
                factory.createReturnStatement(whenTrue)
            ], true), undefined),
            createOuterBinding(innerAliasAgain),
            valueBinding,
            factory.createReturnStatement(replacePayload(whenFalse))
        ];
    };
    const getSelectedPayloadBranch = ({ statement = {}, occupied = new Set() } = {}) => {
        const { kind = 0, statements = [] } = getObject(statement);

        if (kind === ReturnStatement) {
            const lowered = getSelectedPayloadReturn({ statement, occupied });

            return lowered.length > 1 ? factory.createBlock(lowered, true) : statement;
        }

        if (kind !== Block) return statement;

        if (statements.length !== 1) return statement;

        const [onlyStatement = {}] = statements;
        const lowered = getSelectedPayloadReturn({ statement: onlyStatement, occupied });

        return lowered.length > 1 ? factory.updateBlock(statement, lowered) : statement;
    };
    let rewrite = current => current;
    const rewriteBlock = (block = {}, selectedSources = new Set()) => {
        const { kind = 0, statements = [] } = getObject(block);

        if (kind !== Block) return typescript.visitEachChild(block, rewrite, context);

        let occupied = new Set(getBindingNames({ typescript, node: block }));
        let selectedPayloadSources = new Set(selectedSources);
        let loopTerminalSources = new Set();
        const nextStatements = statements.flatMap((statement = {}) => {
            const visited = typescript.visitEachChild(statement, rewrite, context);
            const loopLowered = getSelectedModelLoop({ statement: visited, occupied });

            if (loopLowered !== visited) {
                const loopReceiver = getSelectedLoopReceiver(visited);

                loopTerminalSources = loopReceiver ? new Set([loopReceiver]) : new Set();

                return [loopLowered];
            }

            const completedLoopBinding = completeSelectedLoopPayloadBinding({
                statement: visited,
                sources: loopTerminalSources
            });
            const completedLoopReturn = completeSelectedLoopPayloadReturn({
                statement: visited,
                occupied
            });
            const selectedConditionalReturn = getSelectedPayloadConditionalReturn({
                statement: visited,
                occupied
            });

            // The terminal selection applies solely to the immediately
            // following binding. A later reassignment or read must establish
            // its own source agreement.
            loopTerminalSources = new Set();

            if (completedLoopReturn.length > 1) return completedLoopReturn;

            if (completedLoopBinding !== visited) return [completedLoopBinding];

            if (selectedConditionalReturn.length > 1) return selectedConditionalReturn;

            const {
                member = {}, receiver = {}, receiverName = '', property = '', tag = '',
                predicate = false, expression = {}
            } = getSelection(visited);
            const { agreement: repeatedReadAgreement = {} } = getDestructuringDecisionForNode({
                typescript,
                node: member,
                destructuringAgreements,
                kinds: ['repeated-parameter-read']
            });

            if (getObject(repeatedReadAgreement).action === 'retain-source-phase-read') return [visited];

            if (!receiverName) {
                const directLowered = getSelectedPayloadReturn({
                    statement: visited,
                    occupied
                });
                const callLowered = getSelectedPayloadCallDeclaration({
                    statement: visited,
                    sources: selectedPayloadSources,
                    occupied
                });
                const nestedLowered = getNestedSelectedPayloadReturn({
                    statement: visited,
                    sources: selectedPayloadSources,
                    occupied
                });

                const arrayLowered = getSelectedPayloadArrayDeclaration({
                    statement: visited,
                    sources: selectedPayloadSources,
                    occupied
                });
                const lowered = [directLowered, callLowered, nestedLowered, arrayLowered]
                    .find(candidate => candidate.length > 1) || arrayLowered;

                return lowered;
            }

            if (predicate) {
                const { thenStatement = {} } = getObject(visited);
                const selectedThen = getSelectedPayloadBranch({ statement: thenStatement, occupied });
                const selectedBranch = selectedThen === thenStatement ? visited : factory.updateIfStatement(
                    visited, getObject(visited).expression, selectedThen, getObject(visited).elseStatement);

                selectedPayloadSources = isTerminating(visited) ? new Set([...selectedPayloadSources, receiverName]) : selectedPayloadSources;

                return [selectedBranch];
            }

            const alias = getAvailableAlias({ receiverName, property, occupied });
            occupied = new Set([...occupied, alias]);
            const binding = factory.createBindingElement(
                undefined,
                factory.createIdentifier(property),
                factory.createIdentifier(alias),
                factory.createVoidExpression(factory.createNumericLiteral(0))
            );
            const declaration = factory.createVariableStatement(
                undefined,
                factory.createVariableDeclarationList([
                    factory.createVariableDeclaration(
                        factory.createObjectBindingPattern([binding]),
                        undefined,
                        undefined,
                        receiver
                    )
                ], ConstKind)
            );
            const replacement = predicate
                ? factory.createBinaryExpression(
                    factory.createIdentifier(alias),
                    factory.createToken(EqualsEqualsEqualsToken),
                    factory.createStringLiteral(tag)
                )
                : factory.createIdentifier(alias);
            const target = predicate ? expression : member;
            const replace = (candidate = {}) => candidate === target
                ? replacement
                : typescript.visitEachChild(candidate, replace, context);

            const rewritten = predicate && isTerminating(visited)
                ? blockTerminatingBranch(replace(visited))
                : replace(visited);

            const { thenStatement = {} } = getObject(rewritten);
            const selectedThen = getSelectedPayloadBranch({
                statement: thenStatement,
                occupied
            });
            const selectedBranch = selectedThen === thenStatement
                ? rewritten
                : factory.updateIfStatement(
                    rewritten,
                    getObject(rewritten).expression,
                    selectedThen,
                    getObject(rewritten).elseStatement
                );

            if (isFunction(setOriginalNode) &&
                isFunction(getOriginalNode)) {
                setOriginalNode(selectedBranch, getOriginalNode(visited));
            }

            if (isTerminating(selectedBranch)) {
                selectedPayloadSources = new Set([...selectedPayloadSources, receiverName]);
            }

            if (isFunction(setOriginalNode)) setOriginalNode(declaration, member);

            return [declaration, selectedBranch];
        });

        return factory.updateBlock(block, nextStatements);
    };
    rewrite = (current = {}) => {
        const { kind = 0 } = getObject(current);

        return kind === Block
            ? rewriteBlock(current)
            : typescript.visitEachChild(current, rewrite, context);
    };

    return rewrite(node);
};

export {
    lowerSelectedModelDiscriminators
};
