import { getObject } from '../../../rules/support/object.js';
import { getSourceRange, getSyntaxKinds, hasAuthoredLayoutDirective, updateFunction, updateVariableDeclarationFields } from '../../utils/ast-boundary.js';
import {
    hasArrayLengthDecision,
    hasEmptyArrayGuardAfter
} from '../grammar/guards.js';
import {
    getMemberAlias
} from '../grammar/member-access.js';
import {
    createTupleCarrier,
    createTupleCarrierExpression,
    createTupleCarrierPattern
} from '../grammar/tuple-carrier.js';
import { getDefaultInitializer } from '../policy/defaults.js';
import {
    findCapabilityConsumerDecision,
    getDestructuringDecisionForNode,
    hasCompletedDestructuringAgreement
} from '../policy/destructuring-agreements.js';
import { getPlacementContract, getPlacementReason, isPlacementArray, getPlacementFact } from '../policy/placement.js';
import { getBindingNames } from '../understand/imports.js';

const lowerResidualMemberAccess = ({
    typescript = {},
    sourceFile = {},

    placement = {},
    destructuringAgreements = {},
    standard = {},
    agreements = new Set(),
    context = {}
} = {}) => {
    const {
        SyntaxKind: {
            VariableStatement: VariableStatementKind3 = -1,
            ReturnStatement: ReturnStatementKind = -1,
            ExpressionStatement: ExpressionStatementKind = -1,
            ConditionalExpression: ConditionalExpressionKind = -1,
            CallExpression: CallExpressionKind = -1,
            TemplateExpression: TemplateExpressionKind = -1
        } = {},
        NodeFlags: {
            Const: ConstKind = 0
        } = {}
    } = typescript;

    const {
        ArrowFunction = -1,
        FunctionDeclaration = -1,
        FunctionExpression = -1,
        Identifier = -1,
        Parameter = -1,
        VariableDeclaration = -1,
        BindingElement = -1,
        ObjectBindingPattern = -1,
        ArrayBindingPattern = -1,
        PropertyAccessExpression = -1,
        ElementAccessExpression = -1,
        NumericLiteral = -1,
        EqualsToken = -1,
        EqualsEqualsEqualsToken = -1,
        PlusEqualsToken = -1,
        MinusEqualsToken = -1,
        AsteriskEqualsToken = -1,
        AsteriskAsteriskEqualsToken = -1,
        SlashEqualsToken = -1,
        PercentEqualsToken = -1,
        AmpersandEqualsToken = -1,
        BarEqualsToken = -1,
        CaretEqualsToken = -1,
        LessThanLessThanEqualsToken = -1,
        GreaterThanGreaterThanEqualsToken = -1,
        GreaterThanGreaterThanGreaterThanEqualsToken = -1,
        AmpersandAmpersandEqualsToken = -1,
        BarBarEqualsToken = -1,
        QuestionQuestionEqualsToken = -1,
        PrefixUnaryExpression = -1,
        PostfixUnaryExpression = -1,
        DeleteExpression = -1,
        ExclamationToken = -1,
        BinaryExpression = -1,
        CallExpression = -1,
        Block = -1,
        EqualsGreaterThanToken = -1,
        SingleLineCommentTrivia = -1,
        MultiLineCommentTrivia = -1
    } = getSyntaxKinds(typescript);
    const { factory = {} } = typescript;
    const { function: functionStandard = '' } = standard;
    const functionKinds = [FunctionDeclaration, FunctionExpression, ArrowFunction];
    const memberKinds = [PropertyAccessExpression, ElementAccessExpression];
    const assignmentOperators = [
        EqualsToken,
        PlusEqualsToken,
        MinusEqualsToken,
        AsteriskEqualsToken,
        AsteriskAsteriskEqualsToken,
        SlashEqualsToken,
        PercentEqualsToken,
        AmpersandEqualsToken,
        BarEqualsToken,
        CaretEqualsToken,
        LessThanLessThanEqualsToken,
        GreaterThanGreaterThanEqualsToken,
        GreaterThanGreaterThanGreaterThanEqualsToken,
        AmpersandAmpersandEqualsToken,
        BarBarEqualsToken,
        QuestionQuestionEqualsToken
    ];
    const isFunction = node => functionKinds.includes(getObject(node).kind);
    const isMember = node => memberKinds.includes(getObject(node).kind);
    const isBindingIdentifier = node => node && getObject(node).kind === Identifier;
    const getKey = (node = {}) => {
        const { pos = 0, end = 0 } = getObject(node);

        return pos + ":" + end;
    };

    const getChain = (node) => {
        const get = (current) => {
            if (!isMember(current)) return { root: current, segments: [] };

            const {
                expression: currentExpr = {},
                name: currentName = {},
                argumentExpression: currentArg = {},
                kind: currentKind = 0,
                questionDotToken = false
            } = getObject(current);

            // Optional access can skip both the receiver Get and the field Get;
            // an eager binding cannot preserve that source-owned branch.
            if (questionDotToken) return { root: current, segments: [] };

            const previous = get(currentExpr);
            const { text: currentNameText = "" } = getObject(currentName);
            const segment = currentKind === PropertyAccessExpression
                ? { kind: "property", name: currentNameText, node: current }
                : { kind: "element", argument: currentArg, node: current };

            const { root = {}, segments = [] } = getObject(previous);

            return {
                root,
                segments: [...segments, segment]
            };
        };
        const { root = {}, segments = [] } = get(node);

        return isBindingIdentifier(root)
            ? { root, segments }
            : {};
    };
    const isWrite = (node, parentParam) => {
        const parent = parentParam || getObject(node).parent || {};
        const { left = false, operatorToken = {}, kind: parentKind = 0 } = getObject(parent);
        const { kind: opTokenKind = 0 } = getObject(operatorToken);

        return (parentKind === BinaryExpression &&
            left === node &&
            assignmentOperators.includes(opTokenKind)) ||
            [PrefixUnaryExpression, PostfixUnaryExpression, DeleteExpression].includes(parentKind);
    };
    const getStaticIndex = (segment = {}) => {
        const { argument = {} } = getObject(segment);
        const { kind: argumentKind = 0, text: argumentText = "" } = getObject(argument);

        return argumentKind === NumericLiteral &&
            Number.isInteger(Number(argumentText)) &&
            Number(argumentText) >= 0
            ? Number(argumentText)
            : -1;
    };
    const hasDynamicLookup = ({ segments = [] } = {}) => {
        const [first = {}] = segments;
        const { kind = "" } = getObject(first);

        return kind === "element" && getStaticIndex(first) < 0;
    };
    const getSegmentName = (segment = {}) => {
        const { kind = "", name = "", argument = {} } = getObject(segment);
        const { text: argText = "" } = getObject(argument);

        return kind === "property"
            ? name
            : argText;
    };
    const getDefault = (segment = {}) => {
        const { node: segNode = {} } = getObject(segment);
        const { residualCanonical = '' } = getPlacementFact({ typescript, node: segNode, placement });

        if (residualCanonical) return getDefaultInitializer({ factory, canonical: residualCanonical });

        // A residual static read has no honest per-member throw default.
        // Preserve the source binding/failure rather than changing its phase.
        // eslint-disable-next-line resilient/prefer-falsey-returns -- Result enters the binding factory initializer slot; false is not an omitted compiler node.
        return undefined;
    };
    const getPattern = ({
        segment = {},
        alias = "",
        sourceNode = {},
        argument = {},
        indexedContainer = false
    } = {}) => {
        const staticIndex = getStaticIndex(segment);
        const { typeText: sourceTypeText = '' } = getPlacementFact({ typescript, placement, node: sourceNode });
        const isTuple = /^\s*(readonly\s*)?\[/.test(sourceTypeText);
        const { getText = false } = getObject(sourceNode);
        const generatedIndexedSource = sourceTypeText === "any" &&
            typeof getText === "function" &&
            !sourceNode.getText(sourceFile);
        const { kind: segKind = "", node: segNode = {}, argument: segArg = false, name: segName = "" } = getObject(segment);
        const isArray = segKind === "element" &&
            staticIndex >= 0 &&
            sourceNode &&
            (
                isPlacementArray({ typescript, placement, node: sourceNode }) ||
                isTuple ||
                indexedContainer ||
                generatedIndexedSource
            );
        const segmentInfo = getPlacementContract({ typescript, node: segNode, placement });
        const { canonical: segmentInfoCanonical = "", kind: segmentInfoKind = "" } = getObject(segmentInfo);
        const agreementReason = !segmentInfoCanonical
            ? getPlacementReason({ typescript, placement, node: segNode, kind: segmentInfoKind })
            : "";
        let defaultInitializer;

        if (!agreementReason && !defaultInitializer) defaultInitializer = getDefault(segment);

        const getPropertyName = () => {
            if (segKind === "property") return factory.createIdentifier(segName);

            // eslint-disable-next-line resilient/prefer-falsey-returns -- Static array binding omits propertyName; a computed name belongs only to object binding.
            if (staticIndex >= 0 && isArray) return undefined;

            return factory.createComputedPropertyName(argument || segArg || factory.createIdentifier("undefined"));
        };
        const binding = factory.createBindingElement(
            undefined,
            getPropertyName(),
            factory.createIdentifier(alias),
            defaultInitializer
        );

        if (!isArray) return factory.createObjectBindingPattern([binding]);

        return factory.createArrayBindingPattern(
            Array.from({ length: staticIndex + 1 }, (_, index) => (
                index === staticIndex ? binding : factory.createOmittedExpression()
            ))
        );
    };
    const { addSyntheticLeadingComment: addLeading = false, addSyntheticTrailingComment: addTrailing = false } = getObject(typescript);
    const addMutationComment = node => typeof addLeading === "function"
        ? addLeading(
            node,
            SingleLineCommentTrivia,
            " eslint-disable-next-line resilient/prefer-destructured-member-access -- member assignment retained because destructuring cannot express write semantics",
            true
        )
        : node;
    // Static reads belong to their enclosing statement. An extractor IIFE
    // creates a second fake function boundary and invents an object fallback;
    // carry the binding plan outward instead.
    const getReadPlan = ({ root = {}, segments = [], occupied = new Set() } = {}) => {
        const { text: rootText = "" } = getObject(root);
        let available = new Set([...occupied, rootText]);
        let source = factory.createIdentifier(rootText);
        let sourceNode = root;
        let declarations = [];
        let alias = '';

        segments.forEach((segment = {}, index = 0) => {
            const { kind: segKind = "", argument: segArg = false } = getObject(segment);
            const propertyName = getSegmentName(segment) || ("Value" + (index + 1));
            alias = getMemberAlias({
                objectName: rootText || "value",
                propertyName,
                occupied: available
            });
            available = new Set([...available, alias]);
            const argument = segKind === "element"
                ? segArg || factory.createIdentifier("undefined")
                : undefined;
            const pattern = getPattern({
                segment,
                alias,
                sourceNode,
                argument,
                indexedContainer: index > 0
            });
            const { kind: patternKind = 0, elements = [] } = getObject(pattern);
            const isTupleBinding = patternKind === ArrayBindingPattern;
            const carrier = createTupleCarrier({
                source,
                containerAgreement: { state: 'known', owner: 'typed-producer' },
                owner: 'typed-producer',
                placement: 'statement',
                positions: elements.map((element = {}, position) => ({
                    index: position,
                    agreement: { state: 'caller-owned', owner: 'typed-producer' },
                    consumer: 'member-read',
                    suppliedBy: element
                }))
            });
            declarations = [...declarations, factory.createVariableStatement(
                undefined,
                factory.createVariableDeclarationList([
                    factory.createVariableDeclaration(
                        isTupleBinding
                            ? createTupleCarrierPattern({ factory, elements })
                            : pattern,
                        undefined,
                        undefined,
                        isTupleBinding
                            ? createTupleCarrierExpression({ factory, carrier })
                            : source
                    )
                ], ConstKind)
            )];
            source = factory.createIdentifier(alias);
            sourceNode = getObject(segment).node || {};
        });

        return { statements: declarations, expression: factory.createIdentifier(alias) };
    };
    const getBindings = (node = {}) => {
        let names = new Set();
        const add = (declaration = {}) => {
            if (!declaration) return;

            const { text = "", kind: declarationKind = 0, name: declName = {}, elements = [] } = getObject(declaration);

            if (isBindingIdentifier(declaration)) {
                names = new Set([...names, text]);

                return;
            }

            if (declarationKind === BindingElement) {
                add(declName);

                return;
            }

            if (declarationKind === ObjectBindingPattern || declarationKind === ArrayBindingPattern) {
                elements.forEach(add);
            }
        };
        const { parameters = [], body: nodeBody = {} } = getObject(node);
        parameters.forEach((parameter = {}) => {
            const { name = {} } = getObject(parameter);

            return add(name);
        });
        const visit = (child) => {
            if (!child || isFunction(child)) return;

            const { kind: childKind = 0, name = {} } = getObject(child);

            if (childKind === VariableDeclaration) add(name);

            typescript.forEachChild(child, visit);
        };
        visit(nodeBody);

        return names;
    };
    const lowerFunction = (node = {}, inheritedBindings = new Set()) => {
        const { body: nodeBody = {}, parameters: nodeParameters = [] } = getObject(node);
        const localBindings = getBindings(node);
        const bindings = new Set([
            ...[...inheritedBindings].filter(name => !localBindings.has(name)),
            ...localBindings
        ]);

        if (!bindings.size) return node;

        let occupied = new Set([
            ...bindings,
            ...getBindingNames({ typescript, node: nodeBody })
        ]);
        let mutationKeys = new Set();
        const lowerMemberInitializer = (statement = {}) => {
            // eslint-disable-next-line resilient/prefer-safe-destructuring-defaults -- Absent statement modifiers must stay absent in factory update.
            const { kind: stmtKind = 0, declarationList = {}, modifiers } = getObject(statement);

            if (!statement || stmtKind !== VariableStatementKind3) return statement;

            let changed = false;
            const { declarations = [] } = getObject(declarationList);
            const nextDeclarations = declarations.flatMap((declaration = {}) => {
                const {
                    initializer = {},
                    name: declName = {}
                } = getObject(declaration);
                const { root = {}, segments = [] } = getChain(initializer);
                const [lastSegment = {}] = segments.slice(-1);
                const finalName = getSegmentName(lastSegment);
                const { text: rootText = "" } = getObject(root);
                const [firstSegment = {}] = segments;

                if (hasCompletedDestructuringAgreement({ typescript, node: initializer, destructuringAgreements }) || !rootText ||
                    !bindings.has(rootText) ||
                    !segments.length ||
                    (getObject(firstSegment).kind === "element" &&
                        getStaticIndex(firstSegment) >= 0 &&
                        isPlacementArray({ typescript, placement, node: root }) &&
                        hasEmptyArrayGuardAfter({
                            typescript,
                            node: statement,
                            sourceName: rootText
                        })) ||
                    (getObject(firstSegment).kind === "element" &&
                        getStaticIndex(firstSegment) >= 0 &&
                        isPlacementArray({ typescript, placement, node: root }) &&
                        hasArrayLengthDecision({
                            typescript,
                            node: statement,
                            sourceName: rootText
                        })) ||
                    ["length", "size"].includes(finalName) ||
                    hasDynamicLookup({ segments })) return [declaration];

                let source = factory.createIdentifier(rootText);
                let sourceNode = root;
                let extracted = [];
                let finalAlias = "";

                segments.forEach((segment, index) => {
                    const propertyName = getSegmentName(segment) || ("Value" + (index + 1));
                    const alias = getMemberAlias({
                        objectName: rootText,
                        propertyName,
                        occupied
                    });
                    const { argument: segArg = false, node: segNode = {} } = getObject(segment);
                    const pattern = getPattern({
                        segment,
                        alias,
                        sourceNode,
                        argument: segArg,
                        indexedContainer: index > 0
                    });
                    extracted = [...extracted, factory.createVariableDeclaration(
                        pattern,
                        undefined,
                        undefined,
                        source
                    )];
                    occupied = new Set([...occupied, alias]);
                    source = factory.createIdentifier(alias);
                    sourceNode = segNode;
                    finalAlias = alias;
                });

                changed = true;

                return [
                    ...extracted,
                    updateVariableDeclarationFields({
                        factory,
                        declaration,
                        name: declName,
                        initializer: factory.createIdentifier(finalAlias)
                    })
                ];
            });

            if (!changed) return statement;

            const nextStatement = factory.updateVariableStatement(
                statement,
                modifiers,
                factory.updateVariableDeclarationList(
                    declarationList,
                    nextDeclarations
                )
            );

            return nextStatement;
        };
        const getMemberPlan = (expression = {}, parent = {}) => {
            if (!isMember(expression) || isWrite(expression, parent)) return {};

            if (hasCompletedDestructuringAgreement({ typescript, node: expression, destructuringAgreements })) return {};

            const { root = {}, segments = [] } = getChain(expression);
            const [lastSegment = {}] = segments.slice(-1);
            const finalName = getSegmentName(lastSegment);
            const { text: rootText = '' } = getObject(root);

            if (!rootText ||
                !bindings.has(rootText) ||
                !segments.length ||
                hasDynamicLookup({ segments }) ||
                ['length', 'size'].includes(finalName)) return {};

            return getReadPlan({ root, segments, occupied });
        };
        // A receiver-dependent call must retain its callee expression.  When a
        // static member is one of its arguments, an expression-local extraction
        // keeps the source order: evaluate the callee, then evaluate the member
        // argument. Hoisting a declaration would read the member too early.
        const getScopedMemberArgument = (expression = {}, finalArgument = false) => {
            if (!isMember(expression)) return false;

            const { root = {}, segments = [] } = getChain(expression);
            const [segment = {}] = segments;
            const { kind: segmentKind = '', name = '' } = getObject(segment);
            const { text: rootText = '' } = getObject(root);

            if (!rootText ||
                !bindings.has(rootText) ||
                segments.length !== 1 ||
                segmentKind !== 'property' ||
                !name) return false;

            const { contract: sortContract = {} } = findCapabilityConsumerDecision({
                typescript, node: expression, destructuringAgreements
            });
            const isSortConsumerCapability = Boolean(Object.keys(sortContract).length);
            const { agreement: projectionAgreement = {} } = getDestructuringDecisionForNode({
                typescript,
                node: expression,
                destructuringAgreements,
                kinds: ['receiver-ordered-projection']
            });

            if (isSortConsumerCapability ||
                getObject(projectionAgreement).action === 'retain-receiver-ordered-projection') return false;

            const { optional = false, kind: contractKind = '' } = getPlacementContract({ typescript, node: expression, placement });

            if (optional && contractKind !== 'function') return false;

            const alias = getMemberAlias({
                objectName: rootText,
                propertyName: name,
                occupied
            });
            const pattern = factory.createObjectBindingPattern([
                factory.createBindingElement(
                    undefined,
                    factory.createIdentifier(name),
                    factory.createIdentifier(alias),
                    undefined
                )
            ]);
            const parameter = factory.createParameterDeclaration(
                undefined,
                undefined,
                pattern,
                undefined,
                undefined,
                undefined
            );
            const extractor = factory.createArrowFunction(
                undefined,
                undefined,
                [parameter],
                undefined,
                factory.createToken(EqualsGreaterThanToken),
                factory.createIdentifier(alias)
            );
            const documentedExtractor = typeof addLeading === 'function' && typeof addTrailing === 'function'
                ? addTrailing(addLeading(
                    extractor,
                    MultiLineCommentTrivia,
                    ` eslint-disable resilient/prefer-safe-destructuring-defaults -- Argument Get keeps source timing and failure.${finalArgument ? '\n ' : ' '}`,
                    true
                ), MultiLineCommentTrivia, ' eslint-enable resilient/prefer-safe-destructuring-defaults ', true)
                : extractor;

            return factory.createCallExpression(
                factory.createParenthesizedExpression(documentedExtractor),
                undefined,
                [root]
            );
        };
        const getExpressionPlan = (expression = {}) => {
            if (hasCompletedDestructuringAgreement({ typescript, node: expression, destructuringAgreements,
                kinds: ['callable-operation'] })) return {};

            const direct = getMemberPlan(expression);
            const { expression: directExpression = false } = getObject(direct);

            if (directExpression) return direct;

            const {
                kind = 0,
                expression: callee = {},
                arguments: argumentsList = []
            } = getObject(expression);
            const { kind: calleeKind = 0 } = getObject(callee);
            const { typeArguments = undefined } = getObject(expression);

            if (kind === TemplateExpressionKind) {
                const { head = {}, templateSpans = [] } = getObject(expression);
                const state = templateSpans.reduce((current = {}, span = {}) => {
                    const { expression: spanExpression = {}, literal = {} } = getObject(span);
                    const plan = getExpressionPlan(spanExpression);
                    const { statements = [], expression: replacement = false } = getObject(plan);
                    const nextSpan = replacement
                        ? factory.updateTemplateSpan(span, replacement, literal)
                        : span;

                    return {
                        changed: current.changed || Boolean(replacement),
                        statements: [...current.statements, ...statements],
                        spans: [...current.spans, nextSpan]
                    };
                }, { changed: false, statements: [], spans: [] });
                const { changed = false, statements = [], spans = [] } = state;

                return changed
                    ? {
                        statements,
                        expression: factory.updateTemplateExpression(expression, head, spans)
                    }
                    : {};
            }

            if (kind !== CallExpressionKind) return {};

            // Preserve a member call's receiver while making its owned static
            // base an explicit binding.  For example, `tree.forest.reduce()`
            // becomes `const { forest = [] } = tree; forest.reduce()`.
            // The method remains attached to `forest`; this does not detach a
            // protocol call or change its `this` value.
            const getCalleePlan = () => {
                if (calleeKind === Identifier) return {};

                const { expression: receiver = {} } = getObject(callee);
                const receiverPlan = getExpressionPlan(receiver);
                const { expression: receiverExpression = false } = getObject(receiverPlan);

                if (!receiverExpression) return {};

                const { kind: calleeMemberKind = 0, name = {}, argumentExpression = {} } = getObject(callee);
                const nextCallee = calleeMemberKind === PropertyAccessExpression
                    ? factory.updatePropertyAccessExpression(callee, receiverExpression, name)
                    : factory.updateElementAccessExpression(callee, receiverExpression, argumentExpression);

                return {
                    statements: getObject(receiverPlan).statements || [],
                    callee: nextCallee
                };
            };
            const calleePlan = getCalleePlan();
            const { callee: nextCallee = callee, statements: calleeStatements = [] } = getObject(calleePlan);

            // A named call, or a member call with its receiver retained, may
            // bind static arguments before the call.  Other callee forms stay
            // at their boundary.
            const retainedMemberCallee = [PropertyAccessExpression, ElementAccessExpression].includes(calleeKind);

            if (calleeKind !== Identifier && !retainedMemberCallee && nextCallee === callee) return {};

            const state = argumentsList.reduce((current = {}, argument = {}) => {
                const { contract: consumer = {}, agreement = {} } = getDestructuringDecisionForNode({
                    typescript,
                    node: argument,
                    destructuringAgreements,
                    kinds: ['consumer', 'consumer-callback']
                });
                const {
                    action: consumerAction = '',
                    evidence: consumerEvidence = []
                } = consumer;
                const { agreement: projectionAgreement = {} } = getDestructuringDecisionForNode({
                    typescript,
                    node: argument,
                    destructuringAgreements,
                    kinds: ['receiver-ordered-projection']
                });
                const { action = '', canonical = '', evidence = [] } = agreement;
                // Direct extraction before a retained receiver call is only
                // lawful when the checker established this exact consumer.
                // Without that evidence, leave the existing expression path
                // in charge of timing and native failure behavior.
                const plan = consumerAction === 'guard' &&
                    getObject(projectionAgreement).action !== 'retain-receiver-ordered-projection'
                    ? getExpressionPlan(argument)
                    : {};
                const { statements = [], expression: replacement = false } = getObject(plan);
                const [reason = ''] = [...consumerEvidence, ...evidence];
                const guard = consumerAction === 'guard' && action === 'guard-function' && replacement
                    ? (() => {
                        const condition = functionStandard
                            ? factory.createCallExpression(factory.createIdentifier('isFunction'), undefined, [replacement])
                            : factory.createBinaryExpression(
                                factory.createTypeOfExpression(replacement),
                                factory.createToken(EqualsEqualsEqualsToken),
                                factory.createStringLiteral('function', true)
                            );
                        const fallback = getDefaultInitializer({ factory, canonical, singleQuote: true });

                        if (!fallback) return false;

                        // eslint-disable-next-line resilient/prefer-safe-transformations -- Shared Set publishes before guard construction; copying loses caller-visible records.
                        agreements.add({
                            state: 'known',
                            owner: 'callback-consumer',
                            evidence: [reason].filter(Boolean),
                            canonical,
                            site: 'residual-callback-argument',
                            sourceRange: getSourceRange({ typescript, node: argument }),
                            action: 'guarded-function'
                        });

                        return factory.createIfStatement(
                            factory.createPrefixUnaryExpression(ExclamationToken, condition),
                            factory.createBlock([factory.createReturnStatement(fallback)], true)
                        );
                    })()
                    : false;

                return replacement
                    ? {
                        statements: [...current.statements, ...statements, ...(guard ? [guard] : [])],
                        arguments: [...current.arguments, replacement]
                    }
                    : {
                        statements: current.statements,
                        arguments: [...current.arguments, argument]
                    };
            }, { statements: [], arguments: [] });
            const { statements = [], arguments: nextArguments = [] } = state;

            if (!calleeStatements.length && !statements.length) return {};

            return {
                statements: [...calleeStatements, ...statements],
                // `updateCallExpression` preserves a parsed node's argument
                // range and can discard a rebuilt argument list.  A planned
                // call is a new grammar shape, so create it directly.
                expression: factory.createCallExpression(
                    nextCallee,
                    typeArguments,
                    nextArguments
                )
            };
        };
        const lowerConditionalReturn = (statement = {}) => {
            const { expression = {} } = getObject(statement);
            const { condition = {}, whenTrue = {}, whenFalse = {} } = getObject(expression);
            const truePlan = getExpressionPlan(whenTrue);
            const falsePlan = getExpressionPlan(whenFalse);
            const { expression: trueExpression = false, statements: trueStatements = [] } = getObject(truePlan);
            const { expression: falseExpression = false, statements: falseStatements = [] } = getObject(falsePlan);

            if (!trueExpression && !falseExpression) return [statement];

            return [
                factory.createIfStatement(
                    condition,
                    factory.createBlock([
                        ...trueStatements,
                        factory.createReturnStatement(trueExpression || whenTrue)
                    ], true),
                    undefined
                ),
                ...falseStatements,
                factory.createReturnStatement(falseExpression || whenFalse)
            ];
        };
        const lowerStatementHost = (statement = {}) => {
            const { kind = 0, expression = {} } = getObject(statement);
            const { kind: expressionKind = 0 } = getObject(expression);

            if (kind === ReturnStatementKind && expressionKind === ConditionalExpressionKind) return lowerConditionalReturn(statement);

            if (kind === ReturnStatementKind) {
                const plan = getExpressionPlan(expression);
                const { statements = [], expression: replacement = false } = getObject(plan);

                return replacement
                    ? [...statements, factory.updateReturnStatement(statement, replacement)]
                    : [statement];
            }

            if (kind === ExpressionStatementKind) {
                const plan = getExpressionPlan(expression);
                const { statements = [], expression: replacement = false } = getObject(plan);

                return replacement
                    ? [...statements, factory.updateExpressionStatement(statement, replacement)]
                    : [statement];
            }

            if (kind === VariableStatementKind3) {
                const {
                    declarationList = {},
                    // eslint-disable-next-line resilient/prefer-safe-destructuring-defaults -- An AST statement may deliberately omit modifiers; factory update preserves that absence.
                    modifiers
                } = getObject(statement);
                const { declarations = [] } = getObject(declarationList);
                const state = declarations.reduce((current = {}, declaration = {}) => {
                    const { initializer = {} } = getObject(declaration);
                    const plan = getExpressionPlan(initializer);
                    const { statements = [], expression: replacement = false } = getObject(plan);

                    return replacement
                        ? {
                            changed: true,
                            statements: [...current.statements, ...statements],
                            declarations: [...current.declarations, factory.updateVariableDeclaration(
                                declaration,
                                getObject(declaration).name,
                                getObject(declaration).exclamationToken,
                                getObject(declaration).type,
                                replacement
                            )]
                        }
                        : {
                            changed: current.changed,
                            statements: current.statements,
                            declarations: [...current.declarations, declaration]
                        };
                }, { changed: false, statements: [], declarations: [] });
                const { changed = false, statements = [], declarations: nextDeclarations = [] } = state;

                return changed
                    ? [
                        ...statements,
                        factory.updateVariableStatement(
                            statement,
                            modifiers,
                            factory.updateVariableDeclarationList(declarationList, nextDeclarations)
                        )
                    ]
                    : [statement];
            }

            return [statement];
        };
        const collect = (child, parent = {}, statement = {}) => {
            if (!child || isFunction(child)) return;

            if (hasCompletedDestructuringAgreement({ typescript, node: child, destructuringAgreements,
                kinds: ['callable-operation'] })) return;

            const { kind: parentKind = 0, expression: parentExpr = {} } = getObject(parent);

            if (isMember(child) && parentKind === CallExpression && parentExpr === child) {
                typescript.forEachChild(child, next => collect(next, child, statement));

                return;
            }

            const { kind: childKind = 0 } = getObject(child);
            const { isStatement = false } = getObject(typescript);
            const nextStatement = childKind !== Block &&
                typeof isStatement === "function" &&
                isStatement(child)
                ? child
                : statement;

            if (!isMember(child)) {
                typescript.forEachChild(child, next => collect(next, child, nextStatement));

                return;
            }

            const { root = {}, segments = [] } = getChain(child);
            const [lastSegment = {}] = segments.slice(-1);
            const finalName = getSegmentName(lastSegment);
            const { text: rootText = "" } = getObject(root);

            if (rootText &&
                bindings.has(rootText) &&
                segments.length &&
                !["length", "size"].includes(finalName) &&
                isWrite(child, parent)) {
                mutationKeys = new Set([
                    ...mutationKeys,
                    getKey(nextStatement)
                ]);
            }

            typescript.forEachChild(child, next => collect(next, child, nextStatement));
        };
        collect(nodeBody, {}, {});
        const replace = (child, parent = {}) => {
            if (!child || isFunction(child)) return child;

            const { kind: parentKind = 0, expression: parentExpr = {} } = getObject(parent);

            if (isMember(child) && parentKind === CallExpression && parentExpr === child) {
                return typescript.visitEachChild(child, next => replace(next, child), context);
            }

            const { kind: childKind = 0 } = getObject(child);

            const lowered = childKind === VariableStatementKind3
                ? lowerMemberInitializer(child)
                : child;

            if (lowered !== child) return typescript.visitEachChild(lowered, next => replace(next, child), context);

            const getInlineReceiverCall = () => {
                if (childKind !== CallExpressionKind) return child;

                const {
                    expression: callee = {},
                    typeArguments = undefined,
                    arguments: argumentsList = []
                } = getObject(child);

                if (!isMember(callee)) return child;

                const original = typescript.getOriginalNode(child);
                const statementOf = node => !node || typescript.isStatement(node) ? node : statementOf(getObject(node).parent);
                const statement = statementOf(original);
                const { end: callEnd = -1 } = getObject(original);
                const { end: statementEnd = -1 } = getObject(statement);
                const closingTail = callEnd >= 0 && statementEnd >= callEnd &&
                    /^[\s);]*$/u.test((getObject(sourceFile).text || '').slice(callEnd, statementEnd)) &&
                    !hasAuthoredLayoutDirective({ typescript, sourceFile, node: statement });

                const { changed = false, nextArguments = [] } = argumentsList.reduce((
                    { changed: hasChange = false, nextArguments: rewritten = [] } = {},
                    argument = {}, index = 0
                ) => {
                    // Admit only a final argument followed by closing tokens:
                    // no later operation may leave an inherited target line.
                    const nextArgument = getScopedMemberArgument(argument, closingTail && index === argumentsList.length - 1) || argument;

                    return {
                        changed: hasChange || nextArgument !== argument,
                        nextArguments: [...rewritten, nextArgument]
                    };
                }, { changed: false, nextArguments: [] });

                return changed
                    ? factory.createCallExpression(callee, typeArguments, nextArguments)
                    : child;
            };
            const inlineReceiverCall = getInlineReceiverCall();

            if (inlineReceiverCall !== child) {
                return typescript.visitEachChild(inlineReceiverCall, next => replace(next, inlineReceiverCall), context);
            }

            // Statement-host lowering owns eligible static reads. Unsupported
            // expressions keep their source read and recurse without an IIFE.
            return typescript.visitEachChild(child, next => replace(next, child), context);
        };
        const { kind: nodeBodyKind = 0, statements: bodyStatements = [] } = getObject(nodeBody);
        const originalStatements = nodeBodyKind === Block
            ? bodyStatements
            : [factory.createReturnStatement(nodeBody)];
        const initializedStatements = originalStatements.map(lowerMemberInitializer);
        const hostedStatements = initializedStatements.flatMap(lowerStatementHost);
        const hasStatementHosts = hostedStatements.length !== initializedStatements.length ||
            hostedStatements.some((statement, index) => {
                const [initialStatement = {}] = initializedStatements.slice(index, index + 1);

                return statement !== initialStatement;
            });
        const hostedBody = nodeBodyKind === Block
            ? factory.updateBlock(nodeBody, hostedStatements)
            : factory.createBlock(hostedStatements, true);
        const rewrittenBody = hasStatementHosts || nodeBodyKind === Block
            ? typescript.visitEachChild(hostedBody, child => replace(child, hostedBody), context)
            : replace(nodeBody, node);
        const annotate = (child) => {
            if (!child || isFunction(child)) return child;

            if (mutationKeys.has(getKey(child))) return addMutationComment(child);

            return typescript.visitEachChild(child, annotate, context);
        };
        const finalBody = mutationKeys.size
            ? annotate(rewrittenBody)
            : rewrittenBody;

        return updateFunction({
            typescript,
            node,
            parameters: nodeParameters,
            body: finalBody
        });
    };
    const visit = (node, inheritedBindings = new Set()) => {
        if (!node) return node;

        const { kind: nodeKind = 0 } = getObject(node);

        if (nodeKind === Parameter) return node;

        if (isFunction(node)) {
            const localBindings = getBindings(getObject(node));
            const visibleBindings = new Set([
                ...inheritedBindings,
                ...localBindings
            ]);
            const visited = typescript.visitEachChild(
                node,
                child => visit(child, visibleBindings),
                context
            );

            return lowerFunction(getObject(visited), inheritedBindings);
        }

        return typescript.visitEachChild(node, child => visit(child, inheritedBindings), context);
    };

    return typescript.visitNode(sourceFile, visit);
};

export {
    lowerResidualMemberAccess
};
