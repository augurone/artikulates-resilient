import { getObject } from '../../../rules/support/object.js';
import { getSyntaxKinds, updateVariableDeclarationFields } from '../../utils/ast-boundary.js';
import {
    createFreshCollectionReconstruction,
    createMaterializedCollectionReduction
} from '../grammar/algebra.js';
import { getDestructuringDecisionForNode } from '../policy/destructuring-agreements.js';
import { getConsumerContractKey } from '../understand/type-evidence.js';

// This lowerer does not discover collection behavior. Understand has already
// established the fresh, unescaped collection agreement. Placement merely
// replaces one complete copy/update/return operation at its source-time scope.
const lowerCollectionAgreementPlacements = ({
    typescript = {}, node = {}, destructuringAgreements = {}, context = {}, annotationsOnly = false
} = {}) => {
    const {
        Block = -1,
        VariableStatement = -1,
        VariableDeclaration = -1,
        Identifier = -1,
        NewExpression = -1,
        CallExpression = -1,
        PropertyAccessExpression = -1,
        ExpressionStatement = -1,
        ReturnStatement = -1,
        ElementAccessExpression = -1,
        NumericLiteral = -1
    } = getSyntaxKinds(typescript);
    const {
        factory = {},
        NodeFlags: { Const = 0, Let = 0 } = {},
        SyntaxKind: { EqualsToken = -1, SingleLineCommentTrivia = -1, MultiLineCommentTrivia = -1 } = {},
        addSyntheticLeadingComment = false,
        addSyntheticTrailingComment = false,
        getSyntheticLeadingComments = false
    } = typescript;

    if (!node || getObject(node).kind === -1) return node;

    const {
        hasCollectionAnnotationAgreement = false, hasCallbackOwnedAgreement = false,
        collectionUpdates = new Map(), directLiveLoops = new Map()
    } = destructuringAgreements;

    if (annotationsOnly && !hasCollectionAnnotationAgreement) return node;

    const getStatementDeclaration = (statement = {}) => {
        const { kind = 0, declarationList = {} } = getObject(statement);
        const { declarations = [] } = getObject(declarationList);
        const [declaration = {}] = declarations;
        const { kind: declarationKind = 0, name = {}, initializer = {} } = getObject(declaration);
        const { kind: nameKind = 0, text: nameText = '' } = getObject(name);
        const { kind: initializerKind = 0, expression = {}, arguments: args = [] } = getObject(initializer);
        const { kind: expressionKind = 0, text: collectionType = '' } = getObject(expression);
        const [source = {}] = args;

        return kind === VariableStatement && declarations.length === 1 && declarationKind === VariableDeclaration &&
            nameKind === Identifier && initializerKind === NewExpression && expressionKind === Identifier &&
            ['Map', 'Set'].includes(collectionType) && args.length <= 1
            ? { declaration, declarationList, name: nameText, collectionType, source }
            : {};
    };
    const getStaticUpdate = ({ statement = {}, name = '', collectionType = '' } = {}) => {
        const { kind = 0, expression = {} } = getObject(statement);
        const { kind: expressionKind = 0, expression: callee = {}, arguments: args = [] } = getObject(expression);
        const { kind: calleeKind = 0, expression: receiver = {}, name: member = {} } = getObject(callee);
        const { kind: receiverKind = 0, text: receiverName = '' } = getObject(receiver);
        const { text: method = '' } = getObject(member);
        const mapUpdate = collectionType === 'Map' && method === 'set' && args.length === 2;
        const mapDelete = collectionType === 'Map' && method === 'delete' && args.length === 1;
        const setUpdate = collectionType === 'Set' && method === 'add' && args.length === 1;

        return kind === ExpressionStatement && expressionKind === CallExpression && calleeKind === PropertyAccessExpression &&
            receiverKind === Identifier && receiverName === name && (mapUpdate || mapDelete || setUpdate)
            ? { args, method }
            : {};
    };
    const getOwnedUpdate = (statement = {}) => {
        const { kind = 0, expression = {} } = getObject(statement);
        const { getOriginalNode = false } = typescript;
        const original = typeof getOriginalNode === 'function' ? getOriginalNode(expression) : expression;
        const originalKey = getConsumerContractKey(original);
        const directKey = getConsumerContractKey(expression);

        return kind === ExpressionStatement
            ? (collectionUpdates.has(originalKey)
                ? collectionUpdates.get(originalKey) : collectionUpdates.get(directKey)) || {}
            : {};
    };
    const annotateDirectLiveLoop = (candidate = {}) => {
        if (!directLiveLoops.size) return candidate;

        const { getOriginalNode = false } = typescript;
        const original = typeof getOriginalNode === 'function' ? getOriginalNode(candidate) : candidate;
        const key = getConsumerContractKey(original);
        const type = directLiveLoops.get(key) || '';
        const rules = new Map([
            ['Map', 'resilient/prefer-prototype-methods, resilient/prefer-safe-destructuring-defaults'],
            ['Set', 'resilient/prefer-prototype-methods']
        ]).get(type) || '';
        const comments = typeof getSyntheticLeadingComments === 'function'
            ? getSyntheticLeadingComments(candidate) || []
            : [];
        const hasBoundary = comments.some(({ text = '' } = {}) => text.includes('Owned live Map/Set builder'));

        return rules && !hasBoundary && typeof addSyntheticLeadingComment === 'function'
            ? addSyntheticLeadingComment(
                candidate,
                SingleLineCommentTrivia,
                ` eslint-disable-next-line ${rules} -- Owned live Map/Set builder preserves iterator timing and required entry failure.`,
                true
            )
            : candidate;
    };

    if (annotationsOnly && !collectionUpdates.size && !hasCallbackOwnedAgreement) return node;

    const annotateCallbackOwnedUpdates = (candidate = {}) => {
        const visitCallbackUpdate = (current = {}) => {
            const { contract = {}, agreement = {} } = getDestructuringDecisionForNode({
                typescript,
                node: current,
                destructuringAgreements,
                kinds: ['collection-reconstruction']
            });
            const { collection = {} } = getObject(contract);
            const { callbackOwned = false, callbackParameterOwned = false, mutationSites = [] } = getObject(collection);
            const { getOriginalNode = false } = typescript;
            const statementRange = getConsumerContractKey(typeof getOriginalNode === 'function'
                ? getOriginalNode.call(typescript, current)
                : current);
            const ownsStatement = mutationSites.some(({ statementRange: range = '' } = {}) => range === statementRange);
            const ownsExpression = mutationSites.some(({ key = '', statementRange: owner = '' } = {}) => (
                key === statementRange && !owner
            ));
            const visited = typescript.visitEachChild(current, visitCallbackUpdate, context);

            if (getObject(current).kind === CallExpression && callbackParameterOwned && ownsExpression &&
                getObject(agreement).action === 'operational-collection-builder' &&
                typeof addSyntheticTrailingComment === 'function') {
                return addSyntheticTrailingComment(
                    visited,
                    MultiLineCommentTrivia,
                    ' eslint-disable-line resilient/prefer-safe-transformations -- Provider can observe callback parameter identity. ',
                    false
                );
            }

            if (getObject(current).kind !== ExpressionStatement || !callbackOwned || !ownsStatement ||
                getObject(agreement).action !== 'operational-collection-builder' ||
                typeof addSyntheticLeadingComment !== 'function') return visited;

            const directive = 'eslint-disable-next-line resilient/prefer-safe-transformations';
            const comments = typeof getSyntheticLeadingComments === 'function'
                ? getSyntheticLeadingComments(visited) || []
                : [];

            return comments.some(({ text = '' } = {}) => text.includes(directive))
                ? visited
                : addSyntheticLeadingComment(
                    visited,
                    SingleLineCommentTrivia,
                    ` ${directive} -- Provider can observe ${callbackParameterOwned
                        ? 'callback parameter' : 'accumulator'} identity across callback calls.`,
                    true
                );
        };

        return typescript.visitNode(candidate, visitCallbackUpdate);
    };

    const retainedReasons = new Map([
        ['external-or-escaped', 'Collection identity is observable outside this update; copying changes the object seen by that observer.'],
        ['observable-loop', 'Live loop visitation observes native Map/Set mutation; copying changes iteration timing.']
    ]);
    const annotateCollectionDecisionSites = (candidate = {}) => {
        const record = getOwnedUpdate(candidate);
        const { action = '', boundaryReason = '' } = getObject(record);
        const withLiveLoop = annotateDirectLiveLoop(candidate);
        const visited = typescript.visitEachChild(withLiveLoop, annotateCollectionDecisionSites, context);
        const comments = typeof getSyntheticLeadingComments === 'function'
            ? getSyntheticLeadingComments(visited) || []
            : [];
        const hasBoundary = comments.some(({ text = '' } = {}) => (
            text.includes('eslint-disable-next-line resilient/prefer-safe-transformations')
        ));
        const retainedReason = retainedReasons.get(boundaryReason) ||
            'This collection update has no proved immutable reconstruction; native identity and failure timing remain source-owned.';
        const reason = action === 'retain-collection-boundary'
            ? retainedReason
            : 'Owned Map/Set builder preserves source iterator staging and transfers only at return.';

        if (['operational-collection-builder', 'retain-collection-boundary'].includes(action) &&
            !hasBoundary &&
            typeof addSyntheticLeadingComment === 'function') {
            return addSyntheticLeadingComment(
                visited,
                SingleLineCommentTrivia,
                ` eslint-disable-next-line resilient/prefer-safe-transformations -- ${reason}`,
                true
            );
        }

        return visited;
    };
    const getReturnWrapper = ({ statement = {}, name = '' } = {}) => {
        const { kind = 0, expression = {} } = getObject(statement);
        const {
            kind: expressionKind = 0, text = '', expression: callee = {},
            arguments: args = [], typeArguments = undefined
        } = getObject(expression);
        const { kind: calleeKind = 0, expression: receiver = {}, name: member = {} } = getObject(callee);
        const { kind: receiverKind = 0, text: receiverName = '' } = getObject(receiver);
        const { kind: memberKind = 0, text: memberName = '' } = getObject(member);
        const [argument = {}] = args;
        const { kind: argumentKind = 0, text: argumentName = '' } = getObject(argument);
        const isStaticWrapper = expressionKind === CallExpression && args.length === 1 && argumentKind === Identifier &&
            argumentName === name && (calleeKind === Identifier || calleeKind === PropertyAccessExpression &&
            receiverKind === Identifier && memberKind === Identifier && receiverName && memberName);

        if (kind !== ReturnStatement) return {};

        if (expressionKind === Identifier && text === name) return { kind: 'direct' };

        return isStaticWrapper ? { kind: 'static-wrapper', call: expression, callee, typeArguments } : {};
    };
    const getTuplePosition = ({ argument = {}, statement = {}, contract = {}, positions = [] } = {}) => {
        const { collection = {} } = getObject(contract);
        const { tuplePositions = [] } = getObject(collection);
        const candidates = positions.length ? positions : tuplePositions;
        const { getOriginalNode = false } = typescript;
        const original = typeof getOriginalNode === 'function' ? getOriginalNode(argument) : argument;
        const originalStatement = typeof getOriginalNode === 'function' ? getOriginalNode(statement) : statement;
        const key = getConsumerContractKey(original);
        const statementKey = getConsumerContractKey(originalStatement);
        const { kind = 0, expression: container = {}, argumentExpression = {} } = getObject(argument);
        const { kind: containerKind = 0, expression: receiver = {}, name: property = {} } = getObject(container);
        const { kind: receiverKind = 0, text: receiverName = '' } = getObject(receiver);
        const { kind: indexKind = 0, text: indexText = '' } = getObject(argumentExpression);
        const { text: propertyName = '' } = getObject(property);
        const index = Number(indexText);
        const [position = {}] = candidates.filter(({ key: positionKey = '', statementRange = '', index: positionIndex = -1 } = {}) => (
            positionKey === key || statementRange === statementKey && positionIndex === index
        ));
        const { key: positionKey = '' } = getObject(position);

        return positionKey && kind === ElementAccessExpression && containerKind === PropertyAccessExpression &&
            receiverKind === Identifier && propertyName && indexKind === NumericLiteral && index === getObject(position).index
            ? { key: positionKey, receiverName, propertyName, index }
            : {};
    };
    const getAvailableName = ({ block = {}, base = '' } = {}) => {
        const collect = (candidate = {}) => {
            const { kind = 0, text = '' } = getObject(candidate);
            let names = kind === Identifier && text ? new Set([text]) : new Set();

            typescript.forEachChild(candidate, (child = {}) => {
                names = new Set([...names, ...collect(child)]);
            });

            return names;
        };
        const used = collect(block);

        const next = (candidate = base, suffix = 2) => used.has(candidate)
            ? next(`${base}${suffix}`, suffix + 1)
            : candidate;

        return next();
    };
    const createTupleBinding = ({ tuple = {}, alias = '' } = {}) => {
        const { receiverName = '', propertyName = '', index = -1 } = tuple;

        const elements = Array.from({ length: index + 1 }, (_, position) => (
            position === index
                ? factory.createBindingElement(
                    undefined,
                    undefined,
                    factory.createIdentifier(alias),
                    factory.createIdentifier('undefined')
                )
                : factory.createOmittedExpression()
        ));
        const tuplePattern = factory.createArrayBindingPattern(elements);
        Object.defineProperty(tuplePattern, '__resilientExactTuplePosition', {
            configurable: true,
            enumerable: false,
            value: true
        });
        Object.defineProperty(tuplePattern, '__resilientCollectionTimingBoundary', {
            configurable: true,
            enumerable: false,
            value: true
        });
        const pattern = factory.createObjectBindingPattern([
            factory.createBindingElement(
                undefined,
                factory.createIdentifier(propertyName),
                tuplePattern,
                undefined
            )
        ]);

        return factory.createVariableStatement(
            undefined,
            factory.createVariableDeclarationList([
                factory.createVariableDeclaration(pattern, undefined, undefined, factory.createIdentifier(receiverName))
            ], Const)
        );
    };
    const createSourceEntries = ({ source = {}, alias = '' } = {}) => factory.createVariableStatement(
        undefined,
        factory.createVariableDeclarationList([
            factory.createVariableDeclaration(
                factory.createIdentifier(alias),
                undefined,
                undefined,
                factory.createArrayLiteralExpression([factory.createSpreadElement(source)], false)
            )
        ], Const)
    );
    const createRebindingStatement = ({ collectionType = '', name = '', args = [] } = {}) => {
        const collection = createFreshCollectionReconstruction({
            typescript,
            collection: collectionType,
            source: factory.createIdentifier(name),
            arguments: args
        });
        const assignment = factory.createBinaryExpression(
            factory.createIdentifier(name),
            factory.createToken(EqualsToken),
            collection
        );

        return factory.createExpressionStatement(assignment);
    };
    const createReturnedCollection = ({ collection = {}, name = '', wrapper = {}, block = {} } = {}) => {
        const { kind = '', call = {}, callee = {}, typeArguments = undefined } = getObject(wrapper);

        if (kind === 'direct') return [factory.createReturnStatement(collection)];

        if (kind !== 'static-wrapper') return [];

        const resultName = getAvailableName({ block, base: `${name}Result` });
        const declaration = factory.createVariableStatement(
            undefined,
            factory.createVariableDeclarationList([
                factory.createVariableDeclaration(
                    factory.createIdentifier(resultName),
                    undefined,
                    undefined,
                    collection
                )
            ], Const)
        );
        const callWithCollection = factory.updateCallExpression(
            call,
            callee,
            typeArguments,
            [factory.createIdentifier(resultName)]
        );

        return [declaration, factory.createReturnStatement(callWithCollection)];
    };
    const createLetDeclaration = ({ statement = {}, declarationList = {} } = {}) => {
        const { modifiers = [] } = getObject(statement);
        const { declarations = [] } = getObject(declarationList);
        const nextDeclarationList = factory.createVariableDeclarationList(declarations, Let);

        return factory.updateVariableStatement(statement, modifiers, nextDeclarationList);
    };
    // An operational iterator's `!step.done` condition selects the yielded
    // result branch.  Place that exact binding before local-member lowering so
    // no later pass can replace it with a family default or a second alias.
    const { iteratorResultBindings = [] } = destructuringAgreements;
    const iteratorBindings = annotationsOnly ? [] : iteratorResultBindings;
    const lowerIteratorResultBindings = (candidate = {}) => {
        const { kind = 0, declarationList = {}, modifiers = [] } = getObject(candidate);
        const { declarations = [] } = getObject(declarationList);
        const [declaration = {}] = declarations;
        const { kind: declarationKind = 0, name: alias = {}, initializer = {} } = getObject(declaration);
        const { kind: aliasKind = 0, text: aliasName = '' } = getObject(alias);
        const { kind: initializerKind = 0, expression: receiver = {}, name: member = {} } = getObject(initializer);
        const { kind: receiverKind = 0, text: receiverName = '' } = getObject(receiver);
        const { text: memberName = '' } = getObject(member);
        const key = getConsumerContractKey(initializer);
        const matchesIteratorBinding = iteratorBindings.some((binding = {}) => {
            const { key: bindingKey = '', stateName = '', aliasName: bindingAlias = '' } = getObject(binding);

            return bindingKey === key || stateName === receiverName && bindingAlias === aliasName && memberName === 'value';
        });

        if (kind === VariableStatement && declarations.length === 1 && declarationKind === VariableDeclaration &&
            aliasKind === Identifier && aliasName && initializerKind === PropertyAccessExpression &&
            receiverKind === Identifier && matchesIteratorBinding) {
            const binding = factory.createBindingElement(
                undefined,
                aliasName === 'value' ? undefined : factory.createIdentifier('value'),
                factory.createIdentifier(aliasName),
                factory.createIdentifier('undefined')
            );
            const pattern = factory.createObjectBindingPattern([binding]);

            return factory.updateVariableStatement(
                candidate,
                modifiers,
                factory.updateVariableDeclarationList(declarationList, [
                    factory.updateVariableDeclaration(declaration, pattern, undefined, undefined, receiver)
                ])
            );
        }

        return typescript.visitEachChild(candidate, lowerIteratorResultBindings, context);
    };
    const getContiguousUpdates = ({ statements = [], index = 0, name = '', collectionType = '' } = {}) => {
        let cursor = index + 1;
        let updates = [];

        // eslint-disable-next-line resilient/prefer-prototype-methods -- Consecutive update discovery stops before later statement Gets; eager snapshots change failures.
        while (cursor < statements.length) {
            const [statement = {}] = statements.slice(cursor, cursor + 1);
            const update = getStaticUpdate({ statement, name, collectionType });
            const { args = [] } = getObject(update);

            if (!args.length) break;

            updates = [...updates, update];
            cursor += 1;
        }

        const [returnStatement = {}] = statements.slice(cursor, cursor + 1);

        return { updates, returnStatement, end: cursor };
    };
    const getPrecedingTupleBindings = ({ statements = [], index = 0, contract = {} } = {}) => {
        const { collection = {} } = getObject(contract);
        const { precedingTuplePositions = [] } = getObject(collection);
        const bindings = statements.slice(0, index).flatMap((statement = {}, statementIndex = 0) => {
            const { declarationList = {} } = getObject(statement);
            const { declarations = [] } = getObject(declarationList);
            const [declaration = {}] = declarations;
            const { name: binding = {}, initializer = {} } = getObject(declaration);
            const { kind: bindingKind = 0, text: alias = '' } = getObject(binding);
            const tuple = getTuplePosition({
                argument: initializer,
                statement,
                contract,
                positions: precedingTuplePositions
            });
            const { key = '' } = tuple;

            return bindingKind === Identifier && alias && key ? [{ key, statementIndex, tuple, alias }] : [];
        });
        const matched = new Set(bindings.map(({ key = '' } = {}) => key));

        return !precedingTuplePositions.length || matched.size === precedingTuplePositions.length
            ? bindings
            : [];
    };
    const getMaterializedReplacement = ({ statements = [], index = 0 } = {}) => {
        const [declarationStatement = {}, loop = {}, returned = {}] = statements.slice(index, index + 3);
        const {
            declaration = {}, declarationList = {}, name = '', collectionType = ''
        } = getStatementDeclaration(declarationStatement);
        const { contract = {}, agreement = {} } = getDestructuringDecisionForNode({
            typescript,
            node: declaration,
            destructuringAgreements,
            kinds: ['collection-reconstruction']
        });
        const { action = '' } = getObject(agreement);
        const { collection = {} } = getObject(contract);
        const { reduction = {}, materialization = {} } = getObject(collection);
        const { form: materializationForm = '' } = getObject(materialization);
        const {
            source = {}, item = {}, values = [], condition = false, operation = '',
            loopRange = '', returnRange = ''
        } = getObject(reduction);
        const [setValue = {}] = values;
        const { name: declarationName = {} } = getObject(declaration);
        const { modifiers = [] } = getObject(declarationStatement);

        if (!name || action !== 'materialized-collection-reduce' ||
            loopRange !== getConsumerContractKey(loop) || returnRange !== getConsumerContractKey(returned)) return {};

        const value = collectionType === 'Map'
            ? factory.createArrayLiteralExpression(values, false)
            : setValue;
        const initializer = getObject(createMaterializedCollectionReduction({
            typescript,
            collection: collectionType,
            source,
            item,
            accumulator: `${name}${collectionType === 'Map' ? 'Entries' : 'Values'}`,
            operation,
            value,
            condition,
            materialized: Boolean(materializationForm)
        }));

        if (!getObject(initializer).kind) return {};

        const nextDeclaration = updateVariableDeclarationFields({
            factory, declaration, name: declarationName, initializer
        });
        const nextStatement = factory.updateVariableStatement(
            declarationStatement,
            modifiers,
            factory.updateVariableDeclarationList(declarationList, [nextDeclaration])
        );

        return { index, end: index + 2, replacement: [nextStatement, returned] };
    };
    const getReplacement = ({ block = {}, statements = [], index = 0 } = {}) => {
        const [declarationStatement = {}, updateStatement = {}, returnStatement = {}] = statements.slice(index, index + 3);
        const { declaration = {}, name = '', collectionType = '', source = {} } = getStatementDeclaration(declarationStatement);
        const { args = [], method = '' } = getStaticUpdate({ statement: updateStatement, name, collectionType });
        const { contract = {}, agreement = {} } = getDestructuringDecisionForNode({
            typescript,
            node: declaration,
            destructuringAgreements,
            kinds: ['collection-reconstruction']
        });
        const { action = '' } = getObject(agreement);

        const wrapper = getReturnWrapper({ statement: returnStatement, name });
        const { kind: wrapperKind = '' } = wrapper;

        if (!name || !args.length || !wrapperKind || ![
            'single-collection-update',
            'fresh-copy-reconstruction'
        ].includes(action)) {
            return {};
        }

        const precedingTupleBindings = wrapperKind === 'static-wrapper'
            ? getPrecedingTupleBindings({ statements, index, contract })
            : [];
        const { collection: collectionContract = {} } = getObject(contract);
        const { precedingTuplePositions = [] } = getObject(collectionContract);

        if (wrapperKind === 'static-wrapper' && precedingTuplePositions.length && !precedingTupleBindings.length) return {};

        const [key = {}] = args;
        const tuple = collectionType === 'Map' ? getTuplePosition({ argument: key, contract }) : {};
        const { receiverName = '' } = tuple;
        const sourceIsPresent = Boolean(getObject(source).kind);
        const directCollection = getObject(createFreshCollectionReconstruction({
            typescript,
            collection: collectionType,
            source: sourceIsPresent ? source : factory.createArrayLiteralExpression([], false),
            arguments: args,
            method
        }));
        const { kind: directCollectionKind = 0 } = directCollection;

        if (!receiverName && !directCollectionKind) return {};

        if (!receiverName) {
            return {
                end: index + 2,
                replacement: createReturnedCollection({ collection: directCollection, name, wrapper, block }),
                preceding: precedingTupleBindings.map(({ statementIndex = -1, tuple = {}, alias = '' } = {}) => ({
                    statementIndex,
                    statement: createTupleBinding({ tuple, alias })
                }))
            };
        }

        const entriesName = getAvailableName({ block, base: 'sourceEntries' });
        const { propertyName = '', index: tupleIndex = -1 } = tuple;
        const propertyInitial = propertyName.slice(0, 1).toUpperCase();
        const tupleAliasBase = `${receiverName}${propertyInitial}${propertyName.slice(1)}${tupleIndex}`;
        const tupleAlias = getAvailableName({ block, base: tupleAliasBase });
        const replacementArgs = [factory.createIdentifier(tupleAlias), ...args.slice(1)];
        const collection = getObject(createFreshCollectionReconstruction({
            typescript,
            collection: collectionType,
            source: factory.createIdentifier(entriesName),
            arguments: replacementArgs,
            method
        }));
        const { kind: collectionKind = 0 } = collection;

        if (!collectionKind) return {};

        return {
            end: index + 2,
            replacement: [
                createSourceEntries({ source, alias: entriesName }),
                createTupleBinding({ tuple, alias: tupleAlias }),
                ...createReturnedCollection({ collection, name, wrapper, block })
            ],
            preceding: precedingTupleBindings.map(({ statementIndex = -1, tuple: precedingTuple = {}, alias = '' } = {}) => ({
                statementIndex,
                statement: createTupleBinding({ tuple: precedingTuple, alias })
            }))
        };
    };
    const getRebindReplacement = ({ statements = [], index = 0 } = {}) => {
        const [declarationStatement = {}] = statements.slice(index, index + 1);
        const { declaration = {}, declarationList = {}, name = '', collectionType = '' } = getStatementDeclaration(declarationStatement);
        const { updates = [], returnStatement = {}, end = index } = getContiguousUpdates({
            statements,
            index,
            name,
            collectionType
        });
        const { contract = {}, agreement = {} } = getDestructuringDecisionForNode({
            typescript,
            node: declaration,
            destructuringAgreements,
            kinds: ['collection-reconstruction']
        });
        const { action = '' } = getObject(agreement);
        const { collection = {} } = getObject(contract);
        const { probeKeys = [] } = getObject(collection);
        const hasTupleArgument = updates.some(({ args = [] } = {}) => args.some((argument = {}) => {
            const { receiverName = '' } = getTuplePosition({ argument, contract });

            return receiverName;
        }));

        const { kind: returnKind = '' } = getReturnWrapper({ statement: returnStatement, name });

        if (!name || action !== 'fresh-collection-rebind' || updates.length < 2 || returnKind !== 'direct' ||
            probeKeys.length || hasTupleArgument) return {};

        return {
            end,
            statements: [
                createLetDeclaration({ statement: declarationStatement, declarationList }),
                ...updates.map(({ args = [] } = {}) => createRebindingStatement({ collectionType, name, args })),
                returnStatement
            ]
        };
    };
    const visit = (candidate = {}) => {
        const { kind = 0, statements = [] } = getObject(candidate);

        if (kind !== Block) return typescript.visitEachChild(candidate, visit, context);

        const replacements = statements.reduce((result = [], _, index) => {
            const materialized = getMaterializedReplacement({ statements, index });
            const replacement = getReplacement({ block: candidate, statements, index });
            const rebind = getRebindReplacement({ statements, index });
            const { replacement: materializedStatements = [], end: materializedEnd = index } = materialized;
            const { replacement: directStatements = [], end: directEnd = index } = replacement;
            const { statements: rebindStatements = [], end = index } = rebind;

            if (materializedStatements.length) return [...result, {
                index,
                end: materializedEnd,
                replacement: materializedStatements
            }];

            if (directStatements.length) return [...result, {
                index,
                end: directEnd,
                replacement: directStatements,
                preceding: getObject(replacement).preceding || []
            }];

            if (rebindStatements.length) return [...result, { index, end, replacement: rebindStatements }];

            return result;
        }, []);
        const [replacement = {}] = replacements;
        const { index = -1, end = -1, replacement: statementsReplacement = [], preceding = [] } = replacement;

        if (index < 0) return typescript.visitEachChild(candidate, visit, context);

        const precedingStatements = statements.slice(0, index).map((statement = {}, statementIndex = 0) => {
            const [rewrite = {}] = preceding.filter(({ statementIndex: rewriteIndex = -1 } = {}) => rewriteIndex === statementIndex);
            const { statement: replacementStatement = {} } = getObject(rewrite);

            return getObject(replacementStatement).kind ? replacementStatement : statement;
        });

        return factory.updateBlock(candidate, [
            ...precedingStatements,
            ...statementsReplacement,
            ...statements.slice(end + 1)
        ]);
    };

    const iteratorBound = annotationsOnly ? node : lowerIteratorResultBindings(node);
    const annotated = annotateCollectionDecisionSites(iteratorBound);

    return annotationsOnly ? annotateCallbackOwnedUpdates(annotated) : visit(annotated);
};

export {
    lowerCollectionAgreementPlacements
};
