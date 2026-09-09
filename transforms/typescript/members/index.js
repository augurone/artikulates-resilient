import { getObject, hasContent } from '../../../rules/support/object.js';
import {
    getSyntaxKinds,
    updateBindingInitializer,
    updateFunction
} from '../../utils/ast-boundary.js';
import {
    hasEmptyArrayGuardAfter
} from '../grammar/guards.js';
import {
    getMemberAlias,
    getMemberBindingPattern,
    getMemberBindingStatement,
    getTupleIndex,
    isStaticMemberRead
} from '../grammar/member-access.js';
import {
    getBindingAgreementReason,
    getBindingElementCanonical,
    getBindingPropertyName,
    updateObjectBinding
} from '../grammar/resolvers.js';
import {
    getBindingAgreement,
    getBindingDecision,
    getAgreementDefaultInitializer,
    getDefaultInitializer,
    getMemberParameterDefault
} from '../policy/defaults.js';
import {
    findCapabilityConsumerDecision,
    getDestructuringDecisionForNode,
    hasCompletedDestructuringAgreement
} from '../policy/destructuring-agreements.js';
import {
    getPlacementContract,
    getPlacementBindingDecision,
    getPlacementReason,
    getPlacementTypeInfo,
    hasPlacementAbsence,
    isPlacementTuple,
    isPlacementArray,
    getPlacementSymbol
} from '../policy/placement.js';
import {
    getBindingNames,
    hasMutationFor
} from '../understand/imports.js';
import {
    getCallExpressionName,
    getCallIdentifierArgument,
    getConsumerContractKey,
    getDeclaration,
    getIdentifierName,
    getMembers,
    getName
} from '../understand/type-evidence.js';

const updateBindingPattern = ({
    typescript = {},
    pattern = {},
    typeNode = {},
    body = {},
    sourceFile = {},
    declarations = {},
    placement = {},
    destructuringAgreements = {}
} = {}) => {
    const {
        ObjectBindingPattern = -1,
        ArrayBindingPattern = -1
    } = getSyntaxKinds(typescript);
    const { factory = {} } = typescript;
    const { kind: patternKind = 0, elements: patternElements = [] } = getObject(pattern);

    if (![ObjectBindingPattern, ArrayBindingPattern].includes(patternKind)) return pattern;

    if (patternKind === ObjectBindingPattern) return updateObjectBinding({
        typescript, parameter: { name: pattern, type: typeNode }, body, sourceFile, declarations, placement, destructuringAgreements
    });

    let changed = false;
    const elements = patternElements.map((element) => {
        const { agreement: unusedBindingAgreement = {} } = getDestructuringDecisionForNode({
            typescript,
            node: element,
            destructuringAgreements,
            kinds: ['unused-binding']
        });
        const { action: unusedBindingAction = '' } = unusedBindingAgreement;

        if (unusedBindingAction === 'elide-unused-tuple-slot') {
            changed = true;

            return factory.createOmittedExpression();
        }

        const {
            dotDotDotToken = {},
            initializer: elemInit = undefined
        } = getObject(element);
        const hasRestToken = hasContent(dotDotDotToken);

        if (!element || hasRestToken || elemInit) return element;

        const canonical = getBindingElementCanonical({ typescript, element, placement });
        const agreementReason = !canonical
            ? getBindingAgreementReason({ typescript, element, placement })
            : '';
        const { name: bindingName = {} } = getObject(element);
        const { kind: bindingKind = '' } = getPlacementTypeInfo({ typescript, node: bindingName, placement });
        const initializer = getAgreementDefaultInitializer({
            typescript,
            factory,
            decision: getBindingDecision({ agreement: getBindingAgreement({
                canonical,
                kind: bindingKind,
                // An array carrier proves its own shape. A position becomes
                // required only when it is a callable agreement or a later
                // consuming operation establishes that requirement.
                owner: bindingKind ? 'typed-producer' : 'caller',
                evidence: agreementReason ? [agreementReason] : []
            }) }),
            name: getBindingPropertyName({ typescript, node: element }),
            propertyName: String(patternElements.indexOf(element))
        });

        if (initializer) changed = true;

        return initializer
            ? updateBindingInitializer({ factory, element, initializer })
            : element;
    });

    return changed
        ? factory.updateArrayBindingPattern(pattern, elements)
        : pattern;
};

const lowerParameterMemberAccess = ({
    typescript = {},
    node = {},
    declarations = {},
    placement = {},
    destructuringAgreements = {},
    context = {}
} = {}) => {
    const {
        NodeFlags: {
            Const: ConstKind2 = 0
        } = {}
    } = typescript;

    const {
        Block = -1,
        FunctionDeclaration = -1,
        FunctionExpression = -1,
        ArrowFunction = -1,
        Identifier = -1,
        PropertyAccessExpression = -1,
        ElementAccessExpression = -1,
        NumericLiteral = -1,
        StringLiteral = -1,
        CallExpression = -1
    } = getSyntaxKinds(typescript);
    const { factory = {} } = typescript;
    const { body = {}, parameters: nodeParams = [] } = getObject(node);
    const functionKinds = [FunctionDeclaration, FunctionExpression, ArrowFunction];
    const parameters = nodeParams
        .filter(parameter => !hasCompletedDestructuringAgreement({ typescript, node: parameter, destructuringAgreements,
            kinds: ['callable-operation'] }))
        .filter((parameter = {}) => {
            const { name = {}, questionToken = false } = getObject(parameter);
            const { kind = 0 } = getObject(name);

            return kind === Identifier && !questionToken;
        })
        .filter(parameter => !hasPlacementAbsence({ typescript, parameter, placement }));
    const parameterNames = new Set(parameters.map((parameter = {}) => {
        const { name = {} } = getObject(parameter);
        const { text = '' } = getObject(name);

        return text;
    }).filter(Boolean));
    const hasObservableCallReceiverAfterTupleRead = (member = {}) => {
        const { parent: element = {} } = getObject(member);
        const {
            kind: elementKind = 0,
            expression: elementExpression = {},
            argumentExpression: elementArgument = {},
            parent: call = {}
        } = getObject(element);
        const { kind: elementArgumentKind = 0 } = getObject(elementArgument);
        const {
            kind: callKind = 0,
            expression: callReceiver = {},
            arguments: callArguments = []
        } = getObject(call);
        const { kind: callReceiverKind = 0 } = getObject(callReceiver);

        return elementKind === ElementAccessExpression &&
            elementExpression === member &&
            [NumericLiteral, StringLiteral].includes(elementArgumentKind) &&
            callKind === CallExpression &&
            Array.isArray(callArguments) &&
            callArguments.includes(element) &&
            [PropertyAccessExpression, ElementAccessExpression].includes(callReceiverKind);
    };
    let memberInfo = new Map(parameters.flatMap((parameter = {}) => {
        const { type: typeNode = {}, name: paramName = {} } = getObject(parameter);
        const { text: paramNameText = '' } = getObject(paramName);
        const typeName = getIdentifierName({ typescript, node: typeNode });
        const declaration = getDeclaration({
            declarations,
            name: typeName,
            fallback: { type: typeNode }
        });
        const members = getMembers({
            typescript,
            declaration,
            declarations,
            node: typeNode
        });

        return members.map((member = {}) => {
            const propertyName = getName({ typescript, node: member });
            const { type: memberType = false, questionToken = false } = getObject(member);
            const info = memberType
                ? getPlacementTypeInfo({ typescript, node: memberType, placement })
                : {};
            const { canonical = '', optional = false } = getObject(info);
            // A required tuple container must retain the source member read.
            // Parameter extraction with `= []` turns its missing-container
            // failure into an invented empty tuple.
            const memberCanonical = canonical === '[]' && !(questionToken || optional)
                ? ''
                : canonical;

            return [`${paramNameText}.${propertyName}`, {
                canonical: memberCanonical,
                propertyName
            }];
        });
    }).filter(([key = '', { canonical = '', propertyName = '' } = {}]) => key && canonical && propertyName));

    if (!parameterNames.size) return node;

    let reads = new Map();
    let structuralReadKeys = new Set();
    const isRepeatedSourceRead = (candidate = {}) => {
        const { agreement = {} } = getDestructuringDecisionForNode({
            typescript,
            node: candidate,
            destructuringAgreements,
            kinds: ['repeated-parameter-read']
        });

        return getObject(agreement).action === 'retain-source-phase-read';
    };
    const collectStructuralRead = (child) => {
        if (hasCompletedDestructuringAgreement({ typescript, node: child, destructuringAgreements,
            kinds: ['callable-operation'] })) return;

        const {
            kind: childKind = 0,
            expression: childExpr = {},
            name: childName = {}
        } = getObject(child);
        const { text: childExprText = '' } = getObject(childExpr);
        const { text: childNameText = '' } = getObject(childName);
        const { agreement: structuralAgreement = {} } = getDestructuringDecisionForNode({
            typescript, node: child, destructuringAgreements, kinds: ['closed-structural-model']
        });
        const { action: structuralAction = '', canonical: structuralCanonical = '' } = structuralAgreement;
        const isStructuralRead = structuralAction === 'exact-structural-field' &&
            childKind === PropertyAccessExpression && parameterNames.has(childExprText);
        const isOwnedRead = isStructuralRead || isStaticMemberRead({ typescript, node: child }) &&
            childKind === PropertyAccessExpression && parameterNames.has(childExprText);

        if (hasObservableCallReceiverAfterTupleRead(child)) {
            typescript.forEachChild(child, collectStructuralRead);

            return;
        }

        if (!isOwnedRead || structuralAction !== 'exact-structural-field' || isRepeatedSourceRead(child)) {
            typescript.forEachChild(child, collectStructuralRead);

            return;
        }

        const key = `${childExprText}.${childNameText}`;

        if (!memberInfo.has(key)) memberInfo = new Map([
            ...memberInfo,
            [key, { canonical: structuralCanonical, propertyName: childNameText }]
        ]);

        if (!reads.has(key)) reads = new Map([...reads, [key, child]]);

        structuralReadKeys = new Set([...structuralReadKeys, key]);

        typescript.forEachChild(child, collectStructuralRead);
    };
    const collect = (child) => {
        const {
            kind: childKind2 = 0,
            expression: childExpr = {},
            name: childName = {}
        } = getObject(child);
        const { text: childExprText = '' } = getObject(childExpr);
        const { text: childNameText = '' } = getObject(childName);

        if (!child) return;

        if (functionKinds.includes(childKind2)) {
            typescript.forEachChild(child, collectStructuralRead);

            return;
        }

        const childKey = getConsumerContractKey(child);
        const { contract: callbackOwnedContract = {} } = getDestructuringDecisionForNode({
            typescript,
            node: child,
            destructuringAgreements,
            kinds: ['collection-reconstruction']
        });
        const { collection: callbackOwnedCollection = {} } = getObject(callbackOwnedContract);
        const { callbackParameterOwned = false, aliasReadRange = '', selectionRanges = [] } = getObject(callbackOwnedCollection);
        const projectionOwned = hasCompletedDestructuringAgreement({
            typescript,
            node: child,
            destructuringAgreements,
            kinds: ['receiver-ordered-projection']
        });
        const { agreement: structuralAgreement = {} } = getDestructuringDecisionForNode({
            typescript, node: child, destructuringAgreements, kinds: ['closed-structural-model']
        });
        const { contract: consumerDecision = {} } = findCapabilityConsumerDecision({
            typescript, node: child, destructuringAgreements, kinds: ['direct-capability', 'sort-capability']
        });

        const { contract: callbackDecision = {} } = getDestructuringDecisionForNode({
            typescript, node: child, destructuringAgreements, kinds: ['consumer', 'consumer-callback']
        });
        const { action: structuralAction = '' } = structuralAgreement;
        const isStructuralRead = structuralAction === 'exact-structural-field' &&
            childKind2 === PropertyAccessExpression && parameterNames.has(childExprText);
        const isOwnedRead = isStructuralRead || isStaticMemberRead({ typescript, node: child }) &&
            childKind2 === PropertyAccessExpression &&
            parameterNames.has(childExprText);

        if (hasObservableCallReceiverAfterTupleRead(child)) {
            typescript.forEachChild(child, collect);

            return;
        }

        if (hasCompletedDestructuringAgreement({ typescript, node: child, destructuringAgreements,
            kinds: ['callable-operation'] }) || projectionOwned || callbackParameterOwned &&
            (aliasReadRange === childKey || selectionRanges.includes(childKey)) ||
            Object.keys(callbackDecision).length || Object.keys(consumerDecision).length) return;

        if (!isOwnedRead || isRepeatedSourceRead(child)) {
            typescript.forEachChild(child, collect);

            return;
        }

        const key = `${childExprText}.${childNameText}`;
        const checkerInfo = getPlacementContract({ typescript, node: child, placement });
        const { canonical: checkerInfoCanonical = '', optional: checkerOptional = false, kind: checkerKind = '' } = checkerInfo;
        const { canonical: knownCanonical = '' } = getObject(memberInfo.get(key));
        const { canonical: structuralCanonical = '' } = structuralAgreement;

        if (childKind2 === PropertyAccessExpression && checkerOptional && checkerKind !== 'function') return;

        const canonical = structuralAction === 'exact-structural-field'
            ? structuralCanonical
            : knownCanonical || (
                checkerInfoCanonical === '[]' && !checkerOptional
                    ? ''
                    : checkerInfoCanonical
            ) || '';

        if (structuralAction === 'exact-structural-field') {
            structuralReadKeys = new Set([...structuralReadKeys, key]);
        }

        if (canonical && !memberInfo.has(key)) memberInfo = new Map([
            ...memberInfo,
            [key, { canonical, propertyName: childNameText }]
        ]);

        if (canonical && !reads.has(key)) reads = new Map([...reads, [key, child]]);

        typescript.forEachChild(child, collect);
    };

    collect(body);

    const ownedReads = [...reads.values()];

    if (!ownedReads.length) return node;

    let occupied = new Set([
        ...parameters.map((parameter = {}) => {
            const { name = {} } = getObject(parameter);
            const { text = '' } = getObject(name);

            return text;
        }).filter(Boolean),
        ...getBindingNames({ typescript, node: body })
    ]);
    let aliases = new Map();
    let structuralAliases = new Map();
    let groups = new Map();

    ownedReads.forEach((member) => {
        const { expression: memberExpr = {}, name: memberName = {} } = getObject(member);
        const { text: objectName = '' } = getObject(memberExpr);
        const { text: propertyName = '' } = getObject(memberName);
        const alias = getMemberAlias({ objectName, propertyName, occupied });
        const key = `${objectName}.${propertyName}`;
        const { canonical = '' } = getObject(memberInfo.get(key));

        aliases = new Map([...aliases, [key, alias]]);

        if (structuralReadKeys.has(key)) structuralAliases = new Map([...structuralAliases, [key, alias]]);

        occupied = new Set([...occupied, alias]);
        const group = groups.get(objectName) || [];

        groups = new Map([...groups, [objectName, [
            ...group,
            { propertyName, alias, canonical }
        ]]]);
    });

    const hasShadowingParameter = (child = {}) => {
        const { parameters: nestedParameters = [] } = getObject(child);
        const owners = [...structuralAliases.keys()].map(key => key.split('.')[0]);

        return nestedParameters.some(({ name = {} } = {}) => owners.includes(getObject(name).text));
    };
    const replaceStructuralDescendants = (child) => {
        const {
            kind: childKind = 0,
            expression: childExpr = {},
            name: childName = {}
        } = getObject(child);
        const { kind: exprKind = 0, text: exprText = '' } = getObject(childExpr);
        const { text: nameText = '' } = getObject(childName);

        if (!child || functionKinds.includes(childKind) && hasShadowingParameter(child)) return child;

        const alias = childKind === PropertyAccessExpression && exprKind === Identifier
            ? structuralAliases.get(`${exprText}.${nameText}`)
            : false;

        if (alias) return factory.createIdentifier(alias);

        return typescript.visitEachChild(child, replaceStructuralDescendants, context);
    };
    const replace = (child) => {
        const {
            kind: childKind3 = 0,
            expression: childExpr = {},
            name: childName = {}
        } = getObject(child);
        const { kind: exprKind = 0, text: exprText = '' } = getObject(childExpr);
        const { text: nameText = '' } = getObject(childName);

        if (!child) return child;

        if (functionKinds.includes(childKind3)) return structuralAliases.size
            ? replaceStructuralDescendants(child)
            : child;

        const alias = childKind3 === PropertyAccessExpression && exprKind === Identifier
            ? aliases.get(`${exprText}.${nameText}`)
            : false;

        if (alias) return factory.createIdentifier(alias);

        return typescript.visitEachChild(child, replace, context);
    };
    const { kind: bodyKind = 0 } = getObject(body);
    const rewrittenBody = bodyKind === Block
        ? typescript.visitEachChild(body, replace, context)
        : factory.createBlock([
            factory.createReturnStatement(replace(body))
        ], true);
    let residualParameters = new Set();
    const collectResidualReferences = (child) => {
        const {
            kind: childKind4 = 0,
            text: childText = '',
            parent: childParent = {}
        } = getObject(child);
        const {
            kind: parentKind = 0,
            expression: parentExpr = {},
            name: parentName = {}
        } = getObject(childParent);
        const { text: parentNameText = '' } = getObject(parentName);

        if (!child || functionKinds.includes(childKind4)) return;

        const isLoweredMember = parentKind === PropertyAccessExpression &&
            parentExpr === child &&
            aliases.has(`${childText}.${parentNameText}`);

        if (childKind4 === Identifier && parameterNames.has(childText) && !isLoweredMember) {
            residualParameters = new Set([...residualParameters, childText]);
        }

        typescript.forEachChild(child, collectResidualReferences);
    };
    collectResidualReferences(body);
    const signatureGroups = new Map([...groups.entries()]
        .filter(([objectName = '']) => !residualParameters.has(objectName)));
    const declarationStatements = [...groups.entries()]
        .filter(([objectName = '']) => !signatureGroups.has(objectName))
        .map(([objectName = '', members = []]) => (
            factory.createVariableStatement(
                undefined,
                factory.createVariableDeclarationList([
                    factory.createVariableDeclaration(
                        factory.createObjectBindingPattern(members.map(({ propertyName = '', alias = '', canonical = '' } = {}) => (
                            propertyName === alias
                                ? factory.createBindingElement(
                                    undefined,
                                    undefined,
                                    factory.createIdentifier(alias),
                                    getAgreementDefaultInitializer({
                                        typescript,
                                        factory,
                                        decision: getBindingDecision({ agreement: getBindingAgreement({ canonical }) }),
                                        name: propertyName,
                                        sourceName: objectName,
                                        propertyName
                                    })
                                )
                                : factory.createBindingElement(
                                    undefined,
                                    factory.createIdentifier(propertyName),
                                    factory.createIdentifier(alias),
                                    getAgreementDefaultInitializer({
                                        typescript,
                                        factory,
                                        decision: getBindingDecision({ agreement: getBindingAgreement({ canonical }) }),
                                        name: propertyName,
                                        sourceName: objectName,
                                        propertyName
                                    })
                                )
                        ))),
                        undefined,
                        undefined,
                        getObject(parameters.find(parameter => getObject(getObject(parameter).name).text === objectName)).name
                    )
                ], ConstKind2)
            )
        ));
    const { statements: bodyStatements = [] } = getObject(rewrittenBody);
    const directiveIndex = bodyStatements.findIndex(({ expression = {} } = {}) => {
        const { kind: expressionKind = 0 } = expression;

        return expressionKind !== StringLiteral;
    });
    const insertionIndex = directiveIndex < 0 ? bodyStatements.length : directiveIndex;
    const nextStatements = [
        ...bodyStatements.slice(0, insertionIndex),
        ...declarationStatements,
        ...bodyStatements.slice(insertionIndex)
    ];
    const nextBody = factory.updateBlock(rewrittenBody, nextStatements);
    const nextParameters = nodeParams.map((parameter) => {
        const {
            name: paramName = {},
            // eslint-disable-next-line resilient/prefer-safe-destructuring-defaults -- An omitted parameter rest token must remain absent in the factory update.
            dotDotDotToken,
            modifiers: paramModifiers = undefined,
            type: paramType = undefined,
            initializer: paramInit = undefined
        } = getObject(parameter);
        const { text: objectName = '' } = getObject(paramName);
        const members = signatureGroups.get(objectName);

        if (!members || hasContent(dotDotDotToken)) return parameter;

        return factory.updateParameterDeclaration(
            parameter,
            paramModifiers,
            dotDotDotToken,
            getMemberBindingPattern({
                typescript,
                factory,
                members
            }),
            undefined,
            paramType,
            getMemberParameterDefault({ factory, initializer: paramInit, members })
        );
    });

    return updateFunction({
        typescript,
        node,
        parameters: nextParameters,
        body: nextBody
    });
};

const lowerDiscriminatedSwitchAccess = ({
    typescript = {},
    node = {},
    reservedNames = new Set(),
    placement = {},
    destructuringAgreements = {},
    context = {}
} = {}) => {
    const {
        Block = -1,
        SwitchStatement = -1,
        CaseBlock = -1,
        CaseClause = -1,
        Identifier = -1,
        PropertyAccessExpression = -1,
        FunctionDeclaration = -1,
        FunctionExpression = -1,
        ArrowFunction = -1
    } = getSyntaxKinds(typescript);
    const { factory = {}, addSyntheticLeadingComment = false, SyntaxKind: { SingleLineCommentTrivia = -1 } = {} } = typescript;
    const functionKinds = [FunctionDeclaration, FunctionExpression, ArrowFunction];
    const { symbols = false } = placement;

    if (!symbols) return node;

    const { parameters = [] } = getObject(node);
    const parameterSymbols = new Set(parameters.flatMap(({ name = {}, dotDotDotToken = false } = {}) => (
        !dotDotDotToken && getObject(name).kind === Identifier
            ? [getPlacementSymbol({ typescript, node: name, placement }) || false] : []
    )));

    const getKey = ({
        pos = 0,
        end = 0,
        name: { text: nameText = '' } = {}
    } = {}) => `${pos}:${end}:${nameText}`;
    const getMemberAccess = ({ expression = {}, name = {}, kind: childKind = 0 } = {}) => {
        const { kind: exprKind = 0, text: exprText = '' } = getObject(expression);
        const { kind: nameKind = 0, text: nameText = '' } = getObject(name);

        return childKind === PropertyAccessExpression &&
        expression &&
        exprKind === Identifier &&
        name &&
        nameKind === Identifier
            ? {
                objectName: exprText,
                propertyName: nameText
            }
            : {};
    };
    const getCaseMembers = ({ clause = {}, objectName = '' } = {}) => {
        let accesses = [];
        const visit = (child) => {
            const { kind: childKind5 = 0 } = getObject(child);

            if (!child || functionKinds.includes(childKind5)) return;

            const { objectName: candidate = '', propertyName = '' } = getMemberAccess(child);

            if (candidate === objectName && propertyName) accesses = [...accesses, child];

            typescript.forEachChild(child, visit);
        };

        const { statements: clauseStatements = [] } = getObject(clause);
        clauseStatements.forEach(visit);

        return accesses;
    };
    const getSourceFunction = (child = {}) => {
        const { parent = false } = getObject(child);

        return !parent || typescript.isFunctionLike(parent) ? parent : getSourceFunction(parent);
    };
    const getCaseBinding = ({ access = {}, objectName = '' } = {}) => {
        const { propertyName = '', node: accessNode = {} } = access;
        const { contract: selectedContract = {}, agreement: selectedAgreement = {} } = getDestructuringDecisionForNode({
            typescript,
            node: accessNode,
            destructuringAgreements,
            kinds: ['selected-model-read']
        });
        const info = getPlacementContract({ typescript, node: accessNode, placement });
        const { canonical: infoCanonical = '', kind: infoKind = '' } = info;
        const receiverSymbol = getPlacementSymbol({ typescript, node: getObject(accessNode).expression, placement });
        const sourceOwner = getSourceFunction(typescript.getOriginalNode(accessNode));
        const sameOwner = sourceOwner && sourceOwner === typescript.getOriginalNode(node);

        return {
            kind: 'object',
            propertyName,
            alias: getMemberAlias({
                objectName,
                propertyName,
                occupied: reservedNames
            }),
            guarded: true,
            canonical: infoCanonical || '',
            signatureBoundary: getObject(selectedAgreement).action === 'selected-model-read' &&
                getObject(selectedContract).signatureBoundary === true &&
                (!sameOwner || !receiverSymbol || parameterSymbols.has(false) || parameterSymbols.has(receiverSymbol)),
            agreementReason: !infoCanonical
                ? getPlacementReason({ typescript, placement, node: accessNode, kind: infoKind })
                : ''
        };
    };
    const getSwitchObject = (statement) => {
        const { expression = {} } = getObject(statement);
        const { expression: object = {}, name: exprName = {} } = getObject(expression);
        const { kind: exprKind = 0 } = getObject(expression);
        const { kind: objKind = 0, text: objText = '' } = getObject(object);
        const { kind: exprNameKind = 0, text: exprNameText = '' } = getObject(exprName);
        const { kind: statementKind = 0 } = getObject(statement);

        return statementKind === SwitchStatement &&
            exprKind === PropertyAccessExpression &&
            objKind === Identifier &&
            exprName &&
            exprNameKind === Identifier
            ? {
                objectName: objText,
                propertyName: exprNameText
            }
            : {};
    };
    const transformSwitch = (statement) => {
        const { objectName = '' } = getSwitchObject(statement);
        const { caseBlock = {}, expression: switchExpr = {} } = getObject(statement);
        const { kind: statementKind = 0 } = getObject(statement);
        const { kind: caseBlockKind = 0, clauses = [] } = getObject(caseBlock);

        if (statementKind !== SwitchStatement ||
            caseBlockKind !== CaseBlock ||
            !objectName) return { statement, prelude: undefined };

        let occupied = new Set([
            ...reservedNames,
            objectName,
            ...getBindingNames({ typescript, node: statement })
        ]);
        const nextClauses = clauses.map((clause) => {
            const { kind: clauseKind = 0, expression: clauseExpr = {}, statements: clauseStmts = [] } = getObject(clause);

            if (![CaseClause].includes(clauseKind)) return clause;

            const accesses = getCaseMembers({ clause, objectName });
            let members = [];
            let rewrites = new Map();

            accesses.forEach((nodeAccess) => {
                const access = getMemberAccess(nodeAccess);
                const { propertyName: accessProp = '' } = getObject(access);
                const key = getKey(nodeAccess);
                const existing = members.find((member = {}) => {
                    const { propertyName: memberProp = '' } = getObject(member);

                    return memberProp === accessProp;
                });
                const member = existing || getCaseBinding({
                    objectName,
                    access: { ...access, node: nodeAccess }
                });
                const { alias: memberAlias = '' } = getObject(member);

                if (!existing) {
                    occupied = new Set([...occupied, memberAlias]);
                    members = [...members, member];
                }

                rewrites = new Map([...rewrites, [key, memberAlias]]);
            });

            if (!members.length) return clause;

            const replace = (child) => {
                if (!child) return child;

                const alias = rewrites.get(getKey(child));

                return alias
                    ? factory.createIdentifier(alias)
                    : typescript.visitEachChild(child, replace, context);
            };
            const rewrittenStatements = clauseStmts.map(caseStatement => (
                typescript.visitNode(caseStatement, replace)
            ));
            const binding = getMemberBindingStatement({
                typescript,
                factory,
                objectName,
                members
            });

            if (members.every(({ signatureBoundary = false } = {}) => signatureBoundary) &&
                typeof addSyntheticLeadingComment === 'function') addSyntheticLeadingComment(
                binding,
                SingleLineCommentTrivia,
                ' eslint-disable-next-line resilient/prefer-signature-destructuring -- selected payload Get remains after tag selection',
                true
            );

            const body = factory.createBlock([
                binding,
                ...rewrittenStatements
            ], true);

            return factory.updateCaseClause(clause, clauseExpr, [body]);
        });
        const nextSwitch = factory.updateSwitchStatement(
            statement,
            switchExpr,
            factory.updateCaseBlock(caseBlock, nextClauses)
        );

        return { statement: nextSwitch, prelude: undefined };
    };
    const visit = (child, root = false) => {
        const { kind: childKind6 = 0, statements: childStatements = [] } = getObject(child);

        if (!child || (!root && functionKinds.includes(childKind6))) return child;

        if (childKind6 === Block) {
            const statements = childStatements.flatMap((statement) => {
                const visited = typescript.visitEachChild(statement, visit, context);
                const transformed = transformSwitch(visited);
                const { statement: transformedStmt = {} } = getObject(transformed);

                return [transformedStmt];
            });

            return factory.updateBlock(child, statements);
        }

        return typescript.visitEachChild(child, visit, context);
    };

    return visit(node, true);
};

const lowerTupleDestructuring = ({
    typescript = {},
    node = {},
    placement = {},
    factory = getObject(typescript).factory || {}
} = {}) => {
    const {
        NodeFlags: {
            Const: ConstKind4 = 0
        } = {}
    } = typescript;

    const {
        VariableDeclarationList = -1,
        VariableDeclaration = -1,
        Identifier = -1,
        ElementAccessExpression = -1
    } = getSyntaxKinds(typescript);

    const { kind: nodeKind = 0, flags: nodeFlags = 0, declarations: nodeDeclarations = [] } = getObject(node);

    const { checked = false } = placement;

    if (nodeKind !== VariableDeclarationList ||
        !(nodeFlags & ConstKind4) ||
        !checked) return node;

    let changed = false;
    const nextDeclarations = nodeDeclarations.map((declaration) => {
        const {
            name = {},
            initializer = {}
        } = getObject(declaration);
        const { kind: nameKind = 0 } = getObject(name);
        const { kind: initKind = 0, expression: initExpr = {} } = getObject(initializer);
        const { text: initExprText = '' } = getObject(initExpr);
        const index = getTupleIndex({ typescript, node: initializer });

        const { kind: declarationKind = 0 } = getObject(declaration);

        if (declarationKind !== VariableDeclaration ||
            nameKind !== Identifier ||
            initKind !== ElementAccessExpression ||
            index < 0 ||
            !isPlacementTuple({ typescript, placement, node: initExpr }) ||
            hasEmptyArrayGuardAfter({
                typescript,
                node,
                sourceName: initExprText
            })) return declaration;

        const info = getPlacementContract({ typescript, node: initializer, placement });
        const { canonical: infoCanonical = '' } = info;

        if (!infoCanonical) return declaration;

        changed = true;
        const binding = factory.createBindingElement(
            undefined,
            undefined,
            name,
            getDefaultInitializer({
                factory,
                canonical: infoCanonical
            })
        );
        const elements = Array.from({ length: index + 1 }, (_, elementIndex) => (
            elementIndex === index ? binding : factory.createOmittedExpression()
        ));

        return factory.updateVariableDeclaration(
            declaration,
            factory.createArrayBindingPattern(elements),
            undefined,
            undefined,
            initExpr
        );
    });

    return changed
        ? factory.updateVariableDeclarationList(node, nextDeclarations)
        : node;
};

const lowerDynamicArrayDestructuring = ({
    typescript = {},
    node = {},
    placement = {},
    factory = getObject(typescript).factory || {}
} = {}) => {
    const {
        NodeFlags: {
            Const: ConstKind5 = 0
        } = {}
    } = typescript;

    const {
        VariableDeclarationList = -1,
        VariableDeclaration = -1,
        Identifier = -1,
        ElementAccessExpression = -1,
        NumericLiteral = -1,
        StringLiteral = -1
    } = getSyntaxKinds(typescript);

    const { kind: nodeKind = 0, flags: nodeFlags = 0, declarations: nodeDeclarations = [] } = getObject(node);

    const { checked = false } = placement;

    if (nodeKind !== VariableDeclarationList ||
        !(nodeFlags & ConstKind5) ||
        !checked) return node;

    let changed = false;
    const nextDeclarations = nodeDeclarations.map((declaration) => {
        const {
            name = {},
            initializer = {}
        } = getObject(declaration);
        const { kind: nameKind = 0 } = getObject(name);
        const {
            kind: initKind = 0,
            argumentExpression: argument = {},
            expression: initExpr = {}
        } = getObject(initializer);
        const { kind: argKind = 0 } = getObject(argument);
        const { kind: declarationKind = 0 } = getObject(declaration);

        if (declarationKind !== VariableDeclaration ||
            nameKind !== Identifier ||
            initKind !== ElementAccessExpression ||
            !argKind ||
            [NumericLiteral, StringLiteral].includes(argKind) ||
            !isPlacementArray({ typescript, placement, node: initExpr })) return declaration;

        const info = getPlacementContract({ typescript, node: initializer, placement });
        const { canonical: infoCanonical = '' } = info;
        const defaultInitializer = infoCanonical
            ? getDefaultInitializer({
                factory,
                canonical: infoCanonical
            })
            : undefined;

        // A dynamic array lookup is a value lookup, not a shape declaration.
        // Without a known element family, keep `items[index]` intact so the
        // boundary remains falsifiable instead of inventing an element value.
        if (!defaultInitializer) return declaration;

        const binding = factory.createBindingElement(
            undefined,
            factory.createComputedPropertyName(argument),
            name,
            defaultInitializer
        );

        changed = true;

        return factory.updateVariableDeclaration(
            declaration,
            factory.createObjectBindingPattern([binding]),
            undefined,
            undefined,
            initExpr
        );
    });

    if (!changed) return node;

    return factory.updateVariableDeclarationList(node, nextDeclarations);
};

const lowerLocalMemberAccess = ({
    typescript = {},
    node = {},
    placement = {},
    destructuringAgreements = {},
    context = {}
} = {}) => {
    const {
        NodeFlags: {
            Const: ConstKind6 = 0
        } = {}
    } = typescript;

    const {
        Block = -1,
        FunctionDeclaration = -1,
        FunctionExpression = -1,
        ArrowFunction = -1,
        VariableStatement = -1,
        VariableDeclaration = -1,
        Identifier = -1,
        PropertyAccessExpression = -1,
        IfStatement = -1,
        CallExpression = -1,
        ConditionalExpression = -1,
        ReturnStatement = -1,
        BinaryExpression = -1,
        EqualsEqualsToken = -1,
        EqualsEqualsEqualsToken = -1
    } = getSyntaxKinds(typescript);
    const { factory = {} } = typescript;
    const functionKinds = [FunctionDeclaration, FunctionExpression, ArrowFunction];
    const { body = {} } = getObject(node);
    const { symbols = false } = placement;

    const { kind: bodyKind = 0 } = getObject(body);

    if (bodyKind !== Block || !symbols) return node;

    let bindings = [];
    const collectBindings = (child) => {
        const { kind: childKind7 = 0, declarationList: childDeclList = {} } = getObject(child);
        const { flags: declListFlags = 0, declarations: childDecls = [] } = getObject(childDeclList);

        if (!child || functionKinds.includes(childKind7)) return;

        if (childKind7 === VariableStatement &&
            childDeclList &&
            (declListFlags & ConstKind6)) {
            childDecls
                .filter((decl = {}) => {
                    const { name = {}, initializer = undefined, kind: declarationKind = 0 } = getObject(decl);
                    const { kind: nameKind = 0 } = getObject(name);

                    return declarationKind === VariableDeclaration &&
                    name &&
                    nameKind === Identifier &&
                    initializer;
                })
                .forEach((declaration = {}) => {
                    const { name: declName = {} } = getObject(declaration);
                    const { text: name = '' } = getObject(declName);
                    const symbol = getPlacementSymbol({ typescript, placement, node: declName });

                    if (!name || !symbol || hasMutationFor({
                        typescript,
                        sourceFile: body,
                        name
                    })) return;

                    bindings = [...bindings, {
                        name,
                        symbol,
                        statement: child,
                        declaration
                    }];
                });
        }

        typescript.forEachChild(child, collectBindings);
    };
    collectBindings(body);

    if (!bindings.length) return node;

    let occupied = new Set(getBindingNames({ typescript, node: body }));
    let groups = new Map();
    let rewrites = new Map();
    const getKey = ({
        pos = 0,
        end = 0,
        name: { text: nameText = '' } = {},
        argumentExpression: { text: argumentText = '' } = {}
    } = {}) => `${pos}:${end}:${nameText || argumentText}`;
    const getReadGuardRoot = (condition) => {
        const {
            kind: conditionKind = 0,
            operatorToken = {},
            left = {},
            right = {}
        } = getObject(condition);
        const { kind: operatorKind = 0 } = getObject(operatorToken);

        if (conditionKind === BinaryExpression &&
            [EqualsEqualsToken, EqualsEqualsEqualsToken].includes(operatorKind)) {
            const member = [left, right]
                .find((cand = {}) => {
                    const { expression = {}, name = {}, kind: candidateKind = 0 } = getObject(cand);
                    const { kind: candExprKind = 0 } = getObject(expression);
                    const { text: candNameText = '' } = getObject(name);

                    return candidateKind === PropertyAccessExpression && candExprKind === Identifier && candNameText;
                });

            const { expression: memberExpr = {} } = getObject(member);
            const { text: memberExprText = '' } = getObject(memberExpr);

            return member ? memberExprText : '';
        }

        if (conditionKind !== CallExpression) return '';

        const guardName = getCallExpressionName({ typescript, node: condition });
        const isGuard = /^(?:_?[Ii]s[A-Z]|_?[Hh]as[A-Z]|is_)/.test(guardName);

        return isGuard
            ? getCallIdentifierArgument({ typescript, node: condition })
            : '';
    };
    const getGuardReturnRoot = ({ thenStatement = {}, expression = {}, kind: statementKind = 0 } = {}) => {
        if (statementKind !== IfStatement) return '';

        const { kind: thenKind = 0, statements: thenBody = [] } = thenStatement;
        const thenStatements = thenKind === Block
            ? thenBody
            : [thenStatement];
        const [first = {}] = thenStatements;
        const { kind: firstKind = 0 } = first;

        return firstKind === ReturnStatement
            ? getReadGuardRoot(expression)
            : '';
    };
    const collectReads = (child, parent = {}, guardedAfter = new Set()) => {
        const { kind: childKind8 = 0 } = getObject(child);

        if (!child || functionKinds.includes(childKind8)) return;

        if (childKind8 === Block) {
            let nextGuardedAfter = new Set(guardedAfter);
            const { statements = [] } = getObject(child);

            statements.forEach((statement) => {
                collectReads(statement, child, nextGuardedAfter);
                const root = getGuardReturnRoot(statement);

                if (root) nextGuardedAfter = new Set([...nextGuardedAfter, root]);
            });

            return;
        }

        if (childKind8 === ConditionalExpression) {
            const { condition = {}, whenTrue = {}, whenFalse = {} } = getObject(child);
            const root = getReadGuardRoot(condition);

            collectReads(condition, child, guardedAfter);
            collectReads(whenTrue, child, guardedAfter);
            collectReads(whenFalse, child, root ? new Set([...guardedAfter, root]) : guardedAfter);

            return;
        }

        if (childKind8 === IfStatement) {
            const { expression: ifExpr = {}, thenStatement: ifThen = {}, elseStatement: ifElse = {} } = getObject(child);
            const root = getReadGuardRoot(ifExpr);

            collectReads(ifExpr, child, guardedAfter);
            collectReads(ifThen, child, root ? new Set([...guardedAfter, root]) : guardedAfter);
            collectReads(ifElse, child, guardedAfter);

            return;
        }

        const isOwnedRead = isStaticMemberRead({ typescript, node: child, parent }) &&
            childKind8 === PropertyAccessExpression;

        if (hasCompletedDestructuringAgreement({
            typescript,
            node: child,
            destructuringAgreements,
            kinds: ['receiver-ordered-projection']
        })) return;

        const { contract: callbackOwner = {} } = getDestructuringDecisionForNode({
            typescript,
            node: child,
            destructuringAgreements,
            kinds: ['collection-reconstruction']
        });
        const { collection: callbackCollection = {} } = getObject(callbackOwner);
        const { callbackParameterOwned = false, aliasReadRange = '', selectionRanges = [] } = getObject(callbackCollection);

        if (callbackParameterOwned &&
            (aliasReadRange === getConsumerContractKey(child) ||
                selectionRanges.includes(getConsumerContractKey(child)))) return;

        if (!isOwnedRead) {
            typescript.forEachChild(child, next => collectReads(next, child, guardedAfter));

            return;
        }

        const { expression: childExpr = {}, name: childName = {} } = getObject(child);
        const { text: objectName = '' } = getObject(childExpr);
        const { text: propertyName = '' } = getObject(childName);
        const { pos: childPos = -1 } = getObject(child);

        if (guardedAfter.has(objectName)) return;

        const binding = bindings.find((candidate = {}) => {
            const { name: candName = '', statement: candStmt = {}, symbol: candSymbol = undefined } = getObject(candidate);
            const { end: candEnd = -1 } = getObject(candStmt);

            return candName === objectName &&
                    childPos > candEnd &&
                    getPlacementSymbol({ typescript, placement, node: childExpr }) === candSymbol;
        });

        if (!binding) {
            typescript.forEachChild(child, collectReads);

            return;
        }

        const checkerInfo = getPlacementContract({ typescript, node: child, placement });
        const { canonical: checkerInfoCanonical = '', kind: checkerInfoKind = '' } = checkerInfo;
        const agreement = getPlacementBindingDecision({ typescript, placement, node: child });
        const { state: agreementState = '', canonical: agreementCanonical = '', evidence: agreementEvidence = [] } = agreement;
        const [agreementReason = ''] = agreementEvidence;

        // Unknown evidence remains a direct member read. This is deliberately
        // before the rewrite map so uncertainty cannot turn into a broad lint
        // exemption later in the statement pass.
        if (['unknown', 'contradictory'].includes(agreementState)) {
            typescript.forEachChild(child, collectReads);

            return;
        }

        const { statement: bindingStmt = {}, name: bindingName = '' } = getObject(binding);
        const { pos: bindingPos = 0 } = getObject(bindingStmt);
        const bindingKey = `${bindingPos}:${bindingName}`;
        const group = groups.get(bindingKey);
        const { members: groupMembers = [] } = getObject(group);
        const existing = group &&
                    groupMembers.find((member = {}) => {
                        const { propertyName: memberProp = '' } = getObject(member);

                        return memberProp === propertyName;
                    });
        const { alias: existingAlias = '' } = getObject(existing);
        const alias = existing
            ? existingAlias
            : getMemberAlias({ objectName, propertyName, occupied });

        rewrites = new Map([...rewrites, [getKey(child), alias]]);

        if (!groups.has(bindingKey)) groups = new Map([...groups, [bindingKey, {
            statement: bindingStmt,
            objectName,
            members: []
        }]]);

        const nextGroup = groups.get(bindingKey);
        const { members: nextMembers = [] } = getObject(nextGroup);

        const member = {
            propertyName,
            alias,
            canonical: agreementCanonical,
            agreement,
            agreementReason: agreementReason || (!checkerInfoCanonical
                ? getPlacementReason({ typescript, placement, node: child, kind: checkerInfoKind })
                : '')
        };

        occupied = existing ? occupied : new Set([...occupied, alias]);
        groups = existing
            ? groups
            : new Map([...groups, [bindingKey, {
                ...nextGroup,
                members: [...nextMembers, member]
            }]]);

        typescript.forEachChild(child, collectReads);
    };
    collectReads(body);

    if (!groups.size) return node;

    const replace = (child) => {
        const { kind: childKind9 = 0 } = getObject(child);

        if (!child || functionKinds.includes(childKind9)) return child;

        if (childKind9 === PropertyAccessExpression && rewrites.has(getKey(child))) {
            return factory.createIdentifier(rewrites.get(getKey(child)));
        }

        return typescript.visitEachChild(child, replace, context);
    };
    const insert = new Map([...groups.values()].map((group = {}) => {
        const { statement: groupStmt = {}, objectName: groupObj = '', members: groupMbrs = [] } = getObject(group);

        return [
            groupStmt,
            getMemberBindingStatement({
                typescript,
                factory,
                objectName: groupObj,
                members: groupMbrs
            })
        ];
    }));
    const rewriteBlocks = (child) => {
        const { kind: childKind10 = 0, statements: childStatements = [] } = getObject(child);

        if (!child || functionKinds.includes(childKind10)) return child;

        if (childKind10 === Block) {
            const statements = childStatements.flatMap(statement => [
                statement,
                ...(insert.has(statement) ? [insert.get(statement)] : [])
            ]);
            const updatedBlock = factory.updateBlock(child, statements);

            return typescript.visitEachChild(updatedBlock, rewriteBlocks, context);
        }

        return typescript.visitEachChild(child, rewriteBlocks, context);
    };
    const rewrittenBody = rewriteBlocks(replace(body));
    const { parameters: nodeParams = [] } = getObject(node);

    return updateFunction({
        typescript,
        node,
        parameters: nodeParams,
        body: rewrittenBody
    });
};

export {
    lowerDiscriminatedSwitchAccess,
    lowerDynamicArrayDestructuring,
    lowerLocalMemberAccess,
    lowerParameterMemberAccess,
    lowerTupleDestructuring,
    updateBindingPattern
};
