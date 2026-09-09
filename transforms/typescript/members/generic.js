import { getObject, hasContent } from '../../../rules/support/object.js';
import { getSyntaxKinds, updateFunction } from '../../utils/ast-boundary.js';
import {
    hasArrayLengthDecision,
    hasEmptyArrayGuardAfter
} from '../grammar/guards.js';
import {
    getMemberAlias,
    getMemberBindingPattern,
    getMemberBindingStatement,
    isStaticMemberRead
} from '../grammar/member-access.js';
import { getBindingPropertyName } from '../grammar/resolvers.js';
import {
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
    hasPlacementAbsence,
    isPlacementTuple,
    isPlacementArray,
    getPlacementSymbol,
    getPlacementFact
} from '../policy/placement.js';
import { getBindingNames } from '../understand/imports.js';
import {
    getCallExpressionName,
    getCallIdentifierArgument,
    getConsumerContractKey
} from '../understand/type-evidence.js';

const lowerGenericMemberAccess = ({
    typescript = {},
    node = {},
    placement = {},
    destructuringAgreements = {},
    context = {}
} = {}) => {
    const {
        NodeFlags: {
            Const: ConstKind7 = 0
        } = {},
        SyntaxKind: {
            SourceFile: SourceFileKind2 = -1,
            TypeOfExpression: TypeOfExpressionKind2 = -1,
            ReturnStatement: ReturnStatementKind2 = -1,
            EqualsGreaterThanToken: EqualsGreaterThanTokenKind5 = -1,
            ObjectBindingPattern: ObjectBindingPatternKind2 = -1
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
        ElementAccessExpression = -1,
        IfStatement = -1,
        CallExpression = -1,
        ConditionalExpression = -1,
        BinaryExpression = -1,
        EqualsEqualsToken = -1,
        EqualsEqualsEqualsToken = -1,
        ExclamationEqualsToken = -1,
        ExclamationEqualsEqualsToken = -1,
        NumericLiteral = -1,
        StringLiteral = -1,
        ReturnStatement = -1
    } = getSyntaxKinds(typescript);
    const { factory = {}, addSyntheticLeadingComment = false, SingleLineCommentTrivia = -1 } = typescript;
    const functionKinds = [FunctionDeclaration, FunctionExpression, ArrowFunction];
    const { body = {}, kind: nodeKind = 0, parameters: nodeParams = [] } = getObject(node);
    const { symbols = false } = placement;
    const { operationalTupleReads = new Set(), capturedRestParameters = new Set() } = destructuringAgreements;

    const { kind: bodyKind = 0 } = getObject(body);

    if ((bodyKind !== Block && nodeKind !== ArrowFunction) ||
        !symbols) return node;

    let bindings = [];
    const collectBindings = (child) => {
        const { kind: childKind11 = 0, declarationList: childDeclList = {} } = getObject(child);
        const { flags: declListFlags = 0, declarations: childDecls = [] } = getObject(childDeclList);

        if (!child || functionKinds.includes(childKind11)) return;

        if (childKind11 === VariableStatement &&
            childDeclList &&
            (declListFlags & ConstKind7)) {
            childDecls
                .filter((decl = {}) => {
                    const { name = {}, initializer = undefined, kind: declarationKind = 0 } = getObject(decl);
                    const { kind: nameKind = 0 } = getObject(name);

                    return !hasCompletedDestructuringAgreement({ typescript, node: decl, destructuringAgreements,
                        kinds: ['callable-operation'] }) && declarationKind === VariableDeclaration &&
                    name &&
                    nameKind === Identifier &&
                    initializer;
                })
                .forEach((declaration = {}) => {
                    const { name: declName = {} } = getObject(declaration);
                    const { text: name = "" } = getObject(declName);
                    const symbol = getPlacementSymbol({ typescript, placement, node: declName });
                    const { end: childEnd = -1 } = getObject(child);

                    if (name && symbol) bindings = [...bindings, {
                        name,
                        symbol,
                        end: childEnd,
                        statement: child,
                        parameter: false
                    }];
                });
        }

        typescript.forEachChild(child, collectBindings);
    };
    collectBindings(body);
    nodeParams
        .filter(parameter => !hasCompletedDestructuringAgreement({ typescript, node: parameter, destructuringAgreements,
            kinds: ['callable-operation'] }))
        .filter((parameter = {}) => {
            const { name = {}, dotDotDotToken = false } = getObject(parameter);
            const { kind = 0 } = getObject(name);
            const { getOriginalNode = false } = typescript;
            const original = typeof getOriginalNode === 'function' ? getOriginalNode(parameter) : parameter;
            const parameterRange = getConsumerContractKey(original);
            const capturedRestRead = dotDotDotToken && capturedRestParameters.has(parameterRange);

            return kind === Identifier && !capturedRestRead;
        })
        .filter(parameter => !hasPlacementAbsence({ typescript, parameter, placement }))
        .forEach((parameter = {}) => {
            const { name: paramName = {} } = getObject(parameter);
            const { text: name = "" } = getObject(paramName);
            const symbol = getPlacementSymbol({ typescript, placement, node: paramName });

            if (name) bindings = [...bindings, {
                name,
                symbol,
                end: -1,
                statement: undefined,
                parameter: true
            }];
        });

    if (!bindings.length) return node;

    let occupied = new Set(getBindingNames({ typescript, node: body }));
    let rewrites = new Map();
    let groups = new Map();
    const getKey = ({
        pos = 0,
        end = 0,
        name: { text: nameText = "" } = {},
        argumentExpression: { text: argumentText = "" } = {}
    } = {}) => pos + ":" + end + ":" + (nameText || argumentText);
    const getAccess = (nodeArg = {}) => {
        const { argumentExpression = {}, name = {}, kind: childKind = 0 } = getObject(nodeArg);
        const { text: argText = "" } = getObject(argumentExpression);
        const { text: nameText = "" } = getObject(name);
        const isElement = childKind === ElementAccessExpression;
        const propertyName = isElement
            ? argText
            : nameText;

        return {
            kind: isElement ? "array" : "object",
            propertyName
        };
    };
    const hasCompletedAgreement = (candidate = {}) => {
        const completed = hasCompletedDestructuringAgreement({
            typescript,
            node: candidate,
            destructuringAgreements
        });

        return completed || hasCompletedDestructuringAgreement({
            typescript,
            node: candidate,
            destructuringAgreements,
            kinds: ['receiver-ordered-projection']
        });
    };
    const getExactPositionReason = ({
        agreementReason = '', exactPositionCanonical = '', checkerInfoCanonical = '', child = {}, checkerInfoKind = ''
    } = {}) => [
        agreementReason,
        exactPositionCanonical
            ? 'checker-proven static tuple position preserves exact undefined while container failure remains native'
            : '',
        !checkerInfoCanonical
            ? getPlacementReason({ typescript, placement, node: child, kind: checkerInfoKind })
            : ''
    ].find(Boolean) || '';
    const getReadGuardRoot = (condition = {}) => {
        const {
            kind: conditionKind = 0,
            operatorToken = {},
            left = {},
            right = {}
        } = getObject(condition);
        const { kind: operatorKind = 0 } = getObject(operatorToken);

        if (conditionKind === CallExpression) {
            const guardName = getCallExpressionName({ typescript, node: condition });
            const guardMember = guardName.split('.').at(-1) || '';
            const isGuard = /^(?:_?[Ii]s[A-Z]|_?[Hh]as[A-Z]|is_)/.test(guardMember);

            return isGuard
                ? getCallIdentifierArgument({ typescript, node: condition })
                : "";
        }

        if (conditionKind === BinaryExpression &&
            [EqualsEqualsToken, EqualsEqualsEqualsToken, ExclamationEqualsToken, ExclamationEqualsEqualsToken].includes(operatorKind)) {
            const member = [left, right].find((cand = {}) => {
                const { expression = {}, name = {}, kind: candidateKind = 0 } = getObject(cand);
                const { kind: candExprKind = 0 } = getObject(expression);
                const { text: candNameText = "" } = getObject(name);

                return candidateKind === PropertyAccessExpression &&
                    candExprKind === Identifier &&
                    ["_tag", "tag"].includes(candNameText);
            });

            const { expression: memberExpr = {} } = getObject(member);
            const { text: memberExprText = "" } = getObject(memberExpr);

            return member ? memberExprText : "";
        }

        return "";
    };
    const getGuardReturnRoot = (stmt = {}) => {
        const { thenStatement = {}, expression = {}, kind: statementKind = 0 } = getObject(stmt);

        if (statementKind !== IfStatement) return "";

        const { kind: thenKind = 0, statements: thenBody = [] } = getObject(thenStatement);
        const thenStatements = thenKind === Block
            ? thenBody
            : [thenStatement];
        const [first = {}] = thenStatements;
        const { kind: firstKind = 0 } = getObject(first);

        return firstKind === ReturnStatement
            ? getReadGuardRoot(expression)
            : "";
    };
    const isGuardedRead = (child = {}) => {
        const { expression: childExpr = {} } = getObject(child);
        const { text: objectName = "" } = getObject(childExpr);
        const { parent: childParent = false } = getObject(child);
        let current = childParent;

        // eslint-disable-next-line resilient/prefer-prototype-methods -- Guard discovery stops before SourceFile parent Get; matching guards read parent first.
        while (current && getObject(current).kind !== SourceFileKind2) {
            const {
                kind: currKind = 0,
                condition: currCond = {},
                expression: currExpr = {},
                parent: currParent = undefined
            } = getObject(current);

            if (currKind === ConditionalExpression &&
                getReadGuardRoot(currCond) === objectName) return true;

            if (currKind === IfStatement &&
                getReadGuardRoot(currExpr) === objectName) return true;

            current = currParent;
        }

        return false;
    };
    const getStatementKey = (statement = {}) => {
        const { pos = 0, end = 0 } = getObject(statement);

        return pos + ":" + end;
    };
    const getSelectedTagBinding = (statement = {}) => {
        const { kind: statementKind = 0, declarationList = {} } = getObject(statement);
        const { declarations = [] } = getObject(declarationList);
        const [declaration = {}] = declarations;
        const { name: pattern = {}, initializer = {} } = getObject(declaration);
        const { kind: patternKind = 0, elements = [] } = getObject(pattern);
        const { kind: initializerKind = 0, text: sourceName = '' } = getObject(initializer);
        const [element = {}] = elements;
        const { name: alias = {} } = getObject(element);
        const { text: aliasName = '' } = getObject(alias);
        const { unionProperties = [] } = getPlacementFact({ typescript, placement, node: initializer });
        const propertyName = getBindingPropertyName({ typescript, node: element });

        return statementKind === VariableStatement && patternKind === ObjectBindingPatternKind2 &&
            elements.length === 1 && initializerKind === Identifier && sourceName &&
            unionProperties.includes(propertyName) && aliasName
            ? { aliasName, sourceName }
            : {};
    };
    const getTerminatingSelectedAlias = (statement = {}) => {
        const { kind: statementKind = 0, expression = {}, thenStatement = {} } = getObject(statement);
        const { kind: expressionKind = 0, left = {}, right = {}, operatorToken = {} } = getObject(expression);
        const { kind: operatorKind = 0 } = getObject(operatorToken);
        const [identifier = {}] = [left, right].filter((candidate = {}) => getObject(candidate).kind === Identifier);
        const [literal = {}] = [left, right].filter((candidate = {}) => getObject(candidate).kind === StringLiteral);
        const { text: aliasName = '' } = getObject(identifier);
        const { kind: thenKind = 0, statements = [] } = getObject(thenStatement);
        const [first = {}] = statements;
        const { kind: firstKind = 0 } = getObject(first);
        const returns = thenKind === ReturnStatement || thenKind === Block && firstKind === ReturnStatement;

        return statementKind === IfStatement && expressionKind === BinaryExpression &&
            [EqualsEqualsToken, EqualsEqualsEqualsToken].includes(operatorKind) &&
            getObject(literal).kind === StringLiteral && returns
            ? aliasName
            : '';
    };
    const collectReads = (child, parent = {}, guardedRoots = new Set(), guardedAfter = new Map()) => {
        if (!child) return;

        if (hasCompletedDestructuringAgreement({ typescript, node: child, destructuringAgreements,
            kinds: ['callable-operation'] })) return;

        const {
            kind: childKind = 0,
            statements: childStmts = [],
            condition: childCond = {},
            whenTrue: childWhenTrue = {},
            whenFalse: childWhenFalse = {},
            expression: childExpr = {},
            thenStatement: childThen = {},
            elseStatement: childElse = {},
            argumentExpression: childArg = {},
            pos: childPos = -1
        } = getObject(child);

        if (childKind === Block) {
            let nextGuardedAfter = new Map(guardedAfter);
            let selectedTagSources = new Map();
            let selectedAfter = new Set();

            childStmts.forEach((statement = {}) => {
                const selectedAlias = getTerminatingSelectedAlias(statement);
                const branchSource = selectedTagSources.get(selectedAlias);
                collectReads(
                    statement,
                    child,
                    new Set([...guardedRoots, ...selectedAfter, ...[branchSource].filter(Boolean)]),
                    nextGuardedAfter
                );
                const root = getGuardReturnRoot(statement);
                const { aliasName = '', sourceName = '' } = getSelectedTagBinding(statement);

                if (root) nextGuardedAfter = new Map([...nextGuardedAfter, [root, statement]]);

                if (aliasName && sourceName) {
                    selectedTagSources = new Map([...selectedTagSources, [aliasName, sourceName]]);
                }

                if (selectedAlias && selectedTagSources.has(selectedAlias)) {
                    selectedAfter = new Set([...selectedAfter, selectedTagSources.get(selectedAlias)]);
                }
            });

            return;
        }

        if (childKind === ConditionalExpression) {
            const root = getReadGuardRoot(childCond);
            const nextGuardedRoots = root
                ? new Set([...guardedRoots, root])
                : guardedRoots;

            collectReads(childCond, child, guardedRoots, guardedAfter);
            collectReads(childWhenTrue, child, nextGuardedRoots, guardedAfter);
            collectReads(childWhenFalse, child, nextGuardedRoots, guardedAfter);

            return;
        }

        if (childKind === IfStatement) {
            const root = getReadGuardRoot(childExpr);
            const nextGuardedRoots = root
                ? new Set([...guardedRoots, root])
                : guardedRoots;

            collectReads(childExpr, child, guardedRoots, guardedAfter);
            collectReads(childThen, child, nextGuardedRoots, guardedAfter);
            collectReads(childElse, child, nextGuardedRoots, guardedAfter);

            return;
        }

        const { kind: argKind = 0 } = getObject(childArg);
        const { text: exprText = "" } = getObject(childExpr);
        const { kind: accessParentKind = 0, expression: parentExpression = {} } = getObject(parent);

        // A receiver-dependent method owns its lookup and `this` binding. It
        // is not a provider field and must not be detached into a destructured
        // callback, even when the checker reports a callable property.
        if (childKind === PropertyAccessExpression && accessParentKind === CallExpression && parentExpression === child) {
            typescript.forEachChild(child, next => collectReads(next, child, guardedRoots, guardedAfter));

            return;
        }

        const {
            kind: nestedContainerKind = 0,
            expression: nestedReceiver = {},
            name: nestedName = {}
        } = getObject(childExpr);
        const { kind: nestedReceiverKind = 0, text: nestedObjectName = '' } = getObject(nestedReceiver);
        const { text: nestedPropertyName = '' } = getObject(nestedName);
        const nestedStaticTuple = childKind === ElementAccessExpression &&
            childArg && argKind === NumericLiteral &&
            nestedContainerKind === PropertyAccessExpression &&
            nestedReceiverKind === Identifier && nestedObjectName && nestedPropertyName &&
            isPlacementTuple({ typescript, placement, node: childExpr });
        // In `receiver.method(tupleField[0], tupleField[1])`, a binding placed
        // before the call would move both tuple-field getter reads ahead of
        // the receiver's method lookup.  That lookup can itself be observable.
        // Keep this exact nested projection at its source location; final
        // placement records the retained-boundary reason on the access.
        const { parent: grandparent = {} } = getObject(parent);
        const {
            kind: grandparentKind = 0,
            expression: grandparentExpression = {},
            arguments: grandparentArguments = []
        } = getObject(grandparent);
        const { kind: callReceiverKind = 0 } = getObject(grandparentExpression);
        const nestedTupleHasObservableCallReceiver = nestedStaticTuple &&
            grandparentKind === CallExpression &&
            Array.isArray(grandparentArguments) &&
            grandparentArguments.includes(parent) &&
            [PropertyAccessExpression, ElementAccessExpression].includes(callReceiverKind);

        if (nestedTupleHasObservableCallReceiver && !operationalTupleReads.has(getConsumerContractKey(child))) {
            typescript.forEachChild(child, next => collectReads(next, child, guardedRoots, guardedAfter));

            return;
        }

        if (childKind === ElementAccessExpression &&
            childArg &&
            argKind === NumericLiteral &&
            isPlacementArray({ typescript, placement, node: childExpr }) &&
            hasArrayLengthDecision({
                typescript,
                node: child,
                sourceName: exprText
            })) return;

        const isStaticMember = (nestedStaticTuple || isStaticMemberRead({ typescript, node: child, parent })) &&
            [PropertyAccessExpression, ElementAccessExpression].includes(childKind);

        if (!isStaticMember) {
            typescript.forEachChild(child, next => collectReads(next, child, guardedRoots, guardedAfter));

            return;
        }

        const { name: childName = {} } = getObject(child);
        const { text: childMember = '' } = getObject(childName);
        const { text: childIndex = '' } = getObject(childArg);
        const objectName = nestedStaticTuple ? nestedObjectName : exprText;
        const memberPropertyName = nestedStaticTuple ? childIndex : childMember || childIndex;
        const childKey = getConsumerContractKey(child);

        const { agreement: repeatedReadAgreement = {} } = getDestructuringDecisionForNode({
            typescript, node: child, destructuringAgreements, kinds: ['repeated-parameter-read']
        });

        if (getObject(repeatedReadAgreement).action === 'retain-source-phase-read') return;

        const { contract: sortContract = {} } = findCapabilityConsumerDecision({
            typescript, node: child, destructuringAgreements
        });
        const sortOwnedAtConsumer = Boolean(Object.keys(sortContract).length);
        const { contract: callbackContract = {} } = getDestructuringDecisionForNode({
            typescript, node: child, destructuringAgreements, kinds: ['consumer', 'consumer-callback']
        });

        if (Object.keys(callbackContract).length || sortOwnedAtConsumer ||
            operationalTupleReads.has(childKey) || hasCompletedAgreement(child)) return;

        const binding = bindings.find((candidate = {}) => {
            const {
                name: candName = "",
                end: candEnd = -1,
                parameter: candParam = false,
                symbol: candSymbol = undefined
            } = getObject(candidate);

            return candName === objectName &&
                    childPos > candEnd &&
                    (candParam || getPlacementSymbol({ typescript, placement, node: nestedStaticTuple ? nestedReceiver : childExpr }) === candSymbol);
        });

        if (!binding) {
            typescript.forEachChild(child, next => collectReads(next, child, guardedRoots, guardedAfter));

            return;
        }

        // A fixed position is an exact projection when either the checker
        // proves a tuple or a preceding terminating empty-array branch has
        // established cardinality.  `= undefined` records only the source
        // result for a short container; it neither supplies `=[]` nor makes a
        // non-array receiver iterable.
        const exactStaticPosition = childKind === ElementAccessExpression &&
            /^\d+$/.test(childMember || getObject(childArg).text || '') && (
            isPlacementTuple({ typescript, placement, node: childExpr }) ||
                hasEmptyArrayGuardAfter({
                    typescript,
                    node: child,
                    sourceName: objectName
                })
        );

        if (guardedRoots.has(objectName) || isGuardedRead(child)) return;

        const checkerInfo = getPlacementContract({ typescript, node: child, placement });
        const { kind: checkerInfoKind = "", canonical: checkerInfoCanonical = "", optional: checkerOptional = false } = checkerInfo;

        // A source-optional object field has no canonical missing value.
        // Tuple positions have a separate exact-undefined agreement below.
        if (childKind === PropertyAccessExpression && checkerOptional && checkerInfoKind !== 'function') return;

        const access = nestedStaticTuple
            ? { kind: 'nested-array', propertyName: memberPropertyName, outerPropertyName: nestedPropertyName }
            : getAccess(child);
        const { kind = '', propertyName = '', outerPropertyName = '' } = access;
        const exactPositionCanonical = exactStaticPosition && kind === 'array'
            ? 'undefined'
            : '';
        const { name: bindingName = "", end: bindingEnd = 0, statement: bindingStmt = undefined, parameter: bindingParam = false, symbol: bindingSymbol = undefined } = getObject(binding);
        const { agreement: providerForwardAgreement = {} } = getDestructuringDecisionForNode({
            typescript,
            node: child,
            destructuringAgreements,
            kinds: ['exact-provider-forward']
        });
        const isExactProviderForward = getObject(providerForwardAgreement).action === 'exact-provider-forward';
        const getProviderForwardContract = () => ({
            state: 'known',
            canonical: 'undefined',
            evidence: getObject(providerForwardAgreement).evidence || []
        });
        const getAgreement = () => {
            if (isExactProviderForward) return getProviderForwardContract();

            if (bindingParam) return {};

            return getPlacementBindingDecision({ typescript, placement, node: child });
        };
        const agreement = getAgreement();
        const { state: agreementState = '', canonical: agreementCanonical = '', evidence: agreementEvidence = [] } = agreement;
        const [agreementReason = ''] = agreementEvidence;

        if (!bindingParam && ['unknown', 'contradictory'].includes(agreementState)) {
            typescript.forEachChild(child, next => collectReads(next, child, guardedRoots, guardedAfter));

            return;
        }

        const bindingKey = bindingName + ":" + bindingEnd;
        const group = groups.get(bindingKey);
        const { members: groupMembers = [] } = getObject(group);
        const existing = group &&
                    groupMembers.find(({
                        propertyName: memberPropertyName = "",
                        kind: memberKind = 0,
                        outerPropertyName: memberOuterPropertyName = ''
                    } = {}) => {
                        return (
                            memberKind === kind && memberPropertyName === propertyName &&
                            memberOuterPropertyName === outerPropertyName
                        );
                    });
        const { alias: existingAlias = "" } = getObject(existing);
        const alias = existing
            ? existingAlias
            : getMemberAlias({
                objectName: nestedStaticTuple
                    ? `${objectName}${nestedPropertyName.charAt(0).toUpperCase()}${nestedPropertyName.slice(1)}`
                    : objectName,
                propertyName,
                occupied
            });

        rewrites = new Map([...rewrites, [getKey(child), alias]]);

        if (!groups.has(bindingKey)) groups = new Map([...groups, [bindingKey, {
            objectName,
            statement: bindingStmt,
            guardStatement: guardedAfter.get(objectName),
            parameter: bindingParam,
            symbol: bindingSymbol,
            members: []
        }]]);

        const nextGroup = groups.get(bindingKey);
        const { kind: parentKind = 0 } = getObject(parent);

        if (!existing) {
            const memberAgreementReason = getExactPositionReason({
                agreementReason,
                exactPositionCanonical,
                checkerInfoCanonical,
                child,
                checkerInfoKind
            });

            const member = {
                kind,
                propertyName,
                outerPropertyName,
                alias,
                canonical: (() => {
                    if (isExactProviderForward) return 'undefined';

                    if (bindingParam) return exactPositionCanonical || checkerInfoCanonical;

                    return exactPositionCanonical || agreementCanonical;
                })(),
                agreement,
                guarded: parent && parentKind === TypeOfExpressionKind2,
                // The checker's type family, distinct from this member's access kind.
                family: checkerInfoKind,
                agreementReason: memberAgreementReason
            };
            const { members: nextMembers = [], guardStatement: existingGuardStatement = undefined } = getObject(nextGroup);
            occupied = new Set([...occupied, alias]);
            groups = new Map([...groups, [bindingKey, {
                ...nextGroup,
                guardStatement: guardedAfter.get(objectName) || existingGuardStatement,
                members: [...nextMembers, member]
            }]]);
        }

        typescript.forEachChild(child, next => collectReads(next, child, guardedRoots, guardedAfter));
    };
    collectReads(body);

    if (!rewrites.size) return node;

    let residualParameters = new Set();
    const parameterGroups = [...groups.values()].filter((group = {}) => {
        const { parameter = false } = getObject(group);

        return parameter;
    });
    const parameterByName = new Map(parameterGroups.map((group = {}) => {
        const { objectName = "" } = getObject(group);

        return [objectName, group];
    }));
    const collectResidualReferences = (child) => {
        if (!child) return;

        const {
            kind: childKind = 0,
            text: childText = "",
            parent: childParent = {}
        } = getObject(child);
        const {
            kind: parentKind = 0,
            name: parentName = {},
            expression: parentExpr = {}
        } = getObject(childParent);

        if (childKind !== Identifier || !parameterByName.has(childText)) {
            typescript.forEachChild(child, collectResidualReferences);

            return;
        }

        const group = parameterByName.get(childText);
        const { symbol: groupSymbol = undefined, objectName: groupObjName = '' } = getObject(group);
        const isPropertyName = parentKind === PropertyAccessExpression && parentName === child;
        const isLoweredMember = parentKind === PropertyAccessExpression &&
            parentExpr === child &&
            rewrites.has(getKey(childParent)) ||
            parentKind === ElementAccessExpression &&
            parentExpr === child &&
            rewrites.has(getKey(childParent));
        const referenceSymbol = symbols
            ? getPlacementSymbol({ typescript, placement, node: child })
            : undefined;
        const symbolMatches = !groupSymbol || !referenceSymbol || referenceSymbol === groupSymbol;
        const isResidualParameter = !isPropertyName && symbolMatches && !isLoweredMember;

        if (isResidualParameter) residualParameters = new Set([...residualParameters, groupObjName]);

        typescript.forEachChild(child, collectResidualReferences);
    };
    collectResidualReferences(body);

    const replace = (child) => {
        const { kind: childKind12 = 0 } = getObject(child);

        if (!child) return child;

        if ([PropertyAccessExpression, ElementAccessExpression].includes(childKind12) &&
            rewrites.has(getKey(child))) {
            return factory.createIdentifier(rewrites.get(getKey(child)));
        }

        return typescript.visitEachChild(child, replace, context);
    };
    let insertions = new Map();
    [...groups.values()]
        .filter((group = {}) => {
            const { parameter = false, statement = undefined } = getObject(group);

            return !parameter && statement;
        })
        .forEach((group = {}) => {
            const {
                guardStatement = undefined,
                statement = undefined,
                objectName: groupObj = "",
                members: groupMbrs = []
            } = getObject(group);
            const anchor = guardStatement || statement;
            const key = getStatementKey(anchor);
            const statements = insertions.get(key) || [];

            insertions = new Map([...insertions, [key, [
                ...statements,
                getMemberBindingStatement({
                    typescript,
                    factory,
                    objectName: groupObj,
                    members: groupMbrs
                })
            ]]]);
        });
    const signatureGroups = new Map(parameterGroups
        .filter((group = {}) => {
            const { objectName = "" } = getObject(group);

            return !residualParameters.has(objectName);
        })
        .map((group = {}) => {
            const { objectName = "" } = getObject(group);

            return [objectName, group];
        }));
    const getGuardRoot = (condition = {}) => {
        const { kind: conditionKind = 0 } = getObject(condition);

        if (conditionKind !== CallExpression) return "";

        const guardName = getCallExpressionName({ typescript, node: condition });

        return /^(?:_?[Ii]s[A-Z]|_?[Hh]as[A-Z]|is_)/.test(guardName)
            ? getCallIdentifierArgument({ typescript, node: condition })
            : "";
    };
    const isGuardReturn = (statement = {}) => {
        const { kind: stmtKind = 0, thenStatement = {}, expression: stmtExpr = {} } = getObject(statement);

        if (!statement || stmtKind !== IfStatement) return "";

        const { kind: thenKind = 0, statements: thenStmts = [] } = getObject(thenStatement);
        const bodyStatements = thenKind === Block
            ? thenStmts
            : [thenStatement];
        const [first = {}] = bodyStatements;
        const { kind: firstKind = 0 } = getObject(first);

        return firstKind === ReturnStatementKind2
            ? getGuardRoot(stmtExpr)
            : "";
    };
    let guardedParameterGroups = new Map();
    let unguardedParameterGroups = [];
    const { statements: bodyStatementsList = [] } = getObject(body);
    parameterGroups
        .filter((group = {}) => {
            const { objectName = "" } = getObject(group);

            return residualParameters.has(objectName);
        })
        .forEach((group = {}) => {
            const { objectName: groupObj = "" } = getObject(group);
            const guardStatement = bodyStatementsList
                .find(candidate => isGuardReturn(candidate) === groupObj);

            if (guardStatement) {
                const key = getStatementKey(guardStatement);
                guardedParameterGroups = new Map([...guardedParameterGroups, [key, [
                    ...(guardedParameterGroups.get(key) || []),
                    group
                ]]]);

                return;
            }

            unguardedParameterGroups = [...unguardedParameterGroups, group];
        });
    const getScopedParameterExpression = ({ expression = {}, groups = [] } = {}) => (
        groups.reduceRight((current, { objectName = "", members = [] } = {}) => {
            const pattern = getMemberBindingPattern({
                typescript,
                factory,
                members,
                sourceName: objectName
            });
            const parameter = factory.createParameterDeclaration(
                undefined,
                undefined,
                pattern,
                undefined,
                undefined,
                undefined
            );
            const arrow = factory.createArrowFunction(
                undefined,
                undefined,
                // Defaults and full-object forwarding close over the original binding.
                // A duplicate source parameter would shadow it during initialization.
                [parameter],
                undefined,
                factory.createToken(EqualsGreaterThanTokenKind5),
                current
            );
            const { elements = [] } = getObject(pattern);
            const hasRetainedMemberBoundary = elements.some(({ initializer = false, dotDotDotToken = false } = {}) => (
                !initializer && !dotDotDotToken
            ));
            const documentedArrow = hasRetainedMemberBoundary && typeof addSyntheticLeadingComment === 'function'
                ? addSyntheticLeadingComment(
                    arrow,
                    SingleLineCommentTrivia,
                    ' eslint-disable-next-line resilient/prefer-safe-destructuring-defaults -- Generic member selection preserves the source missing-container failure.',
                    true
                )
                : arrow;

            return factory.createCallExpression(
                factory.createParenthesizedExpression(documentedArrow),
                undefined,
                [getObject(nodeParams.find(parameter => getObject(getObject(parameter).name).text === objectName)).name]
            );
        }, expression)
    );
    const parameters = nodeParams.map((parameter = {}) => {
        const {
            name: paramName = {},
            // eslint-disable-next-line resilient/prefer-safe-destructuring-defaults -- An omitted parameter rest token must remain absent in the factory update.
            dotDotDotToken,
            modifiers: paramModifiers = undefined,
            type: paramType = undefined,
            initializer: paramInit = undefined
        } = getObject(parameter);
        const { text: objectName = "" } = getObject(paramName);
        const group = signatureGroups.get(objectName);
        const { members: groupMbrs = [] } = getObject(group);

        if (!group || hasContent(dotDotDotToken)) return parameter;

        return factory.updateParameterDeclaration(
            parameter,
            paramModifiers,
            dotDotDotToken,
            getMemberBindingPattern({
                typescript,
                factory,
                members: groupMbrs
            }),
            undefined,
            paramType,
            getMemberParameterDefault({ factory, initializer: paramInit, members: groupMbrs })
        );
    });
    const sourceBody = bodyKind === Block || (!insertions.size && !unguardedParameterGroups.length)
        ? body
        : factory.createBlock([factory.createReturnStatement(body)], true);
    const { kind: sourceBodyKind = 0 } = getObject(sourceBody);
    const rewrittenBody = sourceBodyKind === Block
        ? typescript.visitEachChild(sourceBody, replace, context)
        : replace(sourceBody);
    const { kind: rewrittenBodyKind = 0, statements: rewrittenStatements = [] } = getObject(rewrittenBody);
    const getExistingBindings = (objectName = "") => {
        if (rewrittenBodyKind !== Block) return { members: [], statements: [] };

        return rewrittenStatements.reduce((result, statement) => {
            const { declarationList = {}, kind: statementKind = 0 } = getObject(statement);
            const { declarations: decls = [] } = getObject(declarationList);
            const [declaration = {}] = decls;
            const { name: pattern = {}, initializer = {} } = getObject(declaration);
            const { kind: patternKind = 0, elements: patternElements = [] } = getObject(pattern);
            const { kind: initKind = 0, text: initText = "" } = getObject(initializer);

            if (statementKind !== VariableStatement ||
                decls.length !== 1 ||
                patternKind !== ObjectBindingPatternKind2 ||
                initKind !== Identifier ||
                initText !== objectName) return result;

            const members = patternElements
                .filter((element = {}) => {
                    const {
                        dotDotDotToken = {}
                    } = getObject(element);

                    return !hasContent(dotDotDotToken);
                })
                .map((element = {}) => {
                    const { name: elemName = {}, initializer: elemInit = undefined } = getObject(element);
                    const { text: elemNameText = "" } = getObject(elemName);

                    return {
                        propertyName: getBindingPropertyName({
                            typescript,
                            node: element
                        }),
                        alias: elemNameText,
                        canonical: "",
                        defaultInitializer: elemInit
                    };
                })
                .filter(({ propertyName = "", alias = "" } = {}) => propertyName && alias);

            return {
                members,
                statements: [...result.statements, statement]
            };
        }, { members: [], statements: [] });
    };
    const scopedParameterGroups = unguardedParameterGroups.map((group = {}) => {
        const { objectName = "", members: groupMbrs = [] } = getObject(group);
        const existing = getExistingBindings(objectName);
        const { members: existingMembers = [], statements: existingStatements = [] } = getObject(existing);
        const known = new Set(groupMbrs.map(({ propertyName = "" } = {}) => propertyName));

        return {
            ...group,
            members: [
                ...groupMbrs,
                ...existingMembers.filter(({ propertyName = "" } = {}) => !known.has(propertyName))
            ],
            existingStatements
        };
    });
    const existingScopedStatements = new Set(scopedParameterGroups.flatMap(
        ({ existingStatements = [] } = {}) => existingStatements
    ));
    const scopedBody = existingScopedStatements.size && rewrittenBodyKind === Block
        ? factory.updateBlock(
            rewrittenBody,
            rewrittenStatements.filter(statement => !existingScopedStatements.has(statement))
        )
        : rewrittenBody;
    const rewriteBlocks = (child, root = false) => {
        const { kind: childKind13 = 0, statements: childStmts = [] } = getObject(child);

        if (!child || functionKinds.includes(childKind13)) return child;

        if (childKind13 !== Block) return typescript.visitEachChild(
            child,
            nextChild => rewriteBlocks(nextChild),
            context
        );

        let statements = childStmts.flatMap(statement => [
            statement,
            ...(insertions.get(getStatementKey(statement)) || [])
        ]);

        if (root && guardedParameterGroups.size) {
            [...guardedParameterGroups.entries()]
                .map(([key = '', groupsList = []]) => ({
                    index: statements.findIndex(statement => getStatementKey(statement) === key),
                    groups: groupsList
                }))
                .filter(({ index = -1 } = {}) => index >= 0)
                .toSorted((left, right) => {
                    const { index: leftIdx = -1 } = getObject(left);
                    const { index: rightIdx = -1 } = getObject(right);

                    return rightIdx - leftIdx;
                })
                .forEach(({ index = -1, groups: groupsList = [] } = {}) => {
                    const suffix = statements.slice(index + 1);

                    if (!suffix.length) return;

                    const scopedBlockBody = factory.createBlock(suffix, true);
                    const scoped = getScopedParameterExpression({
                        expression: scopedBlockBody,
                        groups: groupsList
                    });

                    statements = [
                        ...statements.slice(0, index + 1),
                        factory.createReturnStatement(scoped)
                    ];
                });
        }

        const updatedBlock = factory.updateBlock(child, statements);

        return typescript.visitEachChild(updatedBlock, nextChild => rewriteBlocks(nextChild), context);
    };
    const rewrittenFinalBody = rewriteBlocks(scopedBody, true);
    const finalBody = scopedParameterGroups.length
        ? factory.createBlock([
            factory.createReturnStatement(getScopedParameterExpression({
                expression: rewrittenFinalBody,
                groups: scopedParameterGroups
            }))
        ], true)
        : rewrittenFinalBody;

    return updateFunction({
        typescript,
        node,
        parameters,
        body: finalBody
    });
};

export {
    lowerGenericMemberAccess
};
