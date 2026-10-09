import {
    getCyclicRuntimeBindingNames,
    getRuntimeBindingNames,
    isRuntimeBindingStatement
} from './dependencies.js';
import {
    getDestructuringDecisionForNode
} from './destructuring-agreements.js';
import { getObject } from '../../../rules/support/object.js';
import { getSyntaxKinds, updateFunction } from '../../utils/ast-boundary.js';
import { readDirectiveComment } from '../grammar/emission-layout.js';
import { isReferenceIdentifier } from '../understand/imports.js';
import { getConsumerContractKey } from '../understand/type-evidence.js';

const annotateCyclicRuntimeBindingReferences = ({
    typescript = {},
    sourceFile = {},
    destructuringAgreements = {},
    runtimeBindingReferences = new Map(),
    context = {}
} = {}) => {
    const {
        ExtendsKeyword = -1,
        SingleLineCommentTrivia = -1,
        FunctionDeclaration = -1,
        Identifier = -1,
        MultiLineCommentTrivia = -1,
        Parameter = -1,
        ReturnStatement = -1,
        VariableStatement = -1,
        ExpressionStatement = -1,
        SourceFile: SourceFileKind = -1
    } = getSyntaxKinds(typescript);
    const {
        addSyntheticLeadingComment = false,
        addSyntheticTrailingComment = false,
        factory = {},
        getSyntheticLeadingComments = false,
        getSyntheticTrailingComments = false,
        setSyntheticLeadingComments = false,
        setSyntheticTrailingComments = false
    } = typescript;

    if (typeof addSyntheticTrailingComment !== 'function') return sourceFile;

    const { statements = [] } = getObject(sourceFile);
    // Completed imports are initialized at module instantiation. A retained
    // source reference to an alias lowered into an import no longer needs a
    // lexical forward-reference boundary.
    const importedNames = new Set(statements.filter(statement => typescript.isImportDeclaration(statement)).flatMap((statement) => {
        const { importClause = {} } = getObject(statement);
        const { name = {}, namedBindings = {}, isTypeOnly = false } = getObject(importClause);
        const { name: namespace = {}, elements = [] } = getObject(namedBindings);

        return isTypeOnly ? [] : [getObject(name).text, getObject(namespace).text,
            ...elements.filter(element => !getObject(element).isTypeOnly).map(element => getObject(getObject(element).name).text)].filter(Boolean);
    }));
    const { byKind = new Map() } = getObject(destructuringAgreements);
    const completedReferenceRanges = new Set([
        ...(byKind.get('hoisted-function-reference') || []),
        ...(byKind.get('native-function-reference') || []),
        ...(byKind.get('declaration-lifetime-reference') || [])
    ].map(({ contract = {} } = {}) => getObject(contract).sourceRange).filter(Boolean));
    const cyclicNames = getCyclicRuntimeBindingNames({ typescript, statements });
    const candidates = statements.filter(statement => isRuntimeBindingStatement({ typescript, node: statement }));
    let byName = new Map();

    candidates.forEach(statement => getRuntimeBindingNames({ typescript, node: statement }).forEach((name) => {
        if (!byName.has(name)) byName = new Map([...byName, [name, statement]]);
    }));

    let declarationIndex = new Map();
    statements.forEach((statement, index) => {
        const { body: statementBody = undefined, kind: statementKind = 0 } = getObject(statement);

        if (statementKind === FunctionDeclaration && !statementBody) return;

        getRuntimeBindingNames({ typescript, node: statement }).forEach((name) => {
            declarationIndex = new Map([...declarationIndex, [name, index]]);
        });
    });
    const statementIndex = new Map(statements.map((statement, index) => [statement, index]));
    const boundaryKinds = [FunctionDeclaration, ReturnStatement, VariableStatement, ExpressionStatement];
    let hoistedBoundaryOwners = new Map();
    let heritageBoundaryOwners = new Map();
    const addLeadingException = (node = {}, reason = 'authored order') => {
        const placed = addSyntheticLeadingComment(
            node,
            MultiLineCommentTrivia,
            ` eslint-disable no-use-before-define -- ${reason} `,
            true
        );

        if (typeof setSyntheticLeadingComments !== 'function' ||
            typeof getSyntheticLeadingComments !== 'function') return placed;

        const comments = getSyntheticLeadingComments(placed) || [];
        const boundary = comments.find(({ text = '' } = {}) => (
            text.includes('eslint-disable no-use-before-define')
        ));
        const [firstComment = {}] = comments;

        return boundary && boundary !== firstComment ? setSyntheticLeadingComments(placed, [
            boundary,
            ...comments.filter(comment => comment !== boundary)
        ]) : placed;
    };
    const addException = (node, reason = 'recursive agreement') => {
        const leading = typeof getSyntheticLeadingComments === 'function'
            ? getSyntheticLeadingComments(node) || []
            : [];
        const trailing = typeof getSyntheticTrailingComments === 'function'
            ? getSyntheticTrailingComments(node) || []
            : [];
        const comments = [...leading, ...trailing];
        const hasDisable = comments.some(({ text = '' } = {}) => (
            text.includes('eslint-disable') && text.includes('no-use-before-define')
        ));
        const hasEnable = trailing.some(({ text = '' } = {}) => text.includes('eslint-enable no-use-before-define'));

        if (hasDisable) return node;

        if (!boundaryKinds.includes(getObject(node).kind) || typeof addSyntheticLeadingComment !== 'function') {
            return addSyntheticTrailingComment(
                node,
                MultiLineCommentTrivia,
                ` eslint-disable-line no-use-before-define -- ${reason} `,
                false
            );
        }

        const disabled = addLeadingException(node, reason);

        if (hasEnable) return disabled;

        // A later standalone close can become leading trivia of a type-only
        // neighbor and disappear during transpilation. Keep this close first
        // on the completed owner's terminal line, before its other trivia.
        const closed = addSyntheticTrailingComment(
            disabled, MultiLineCommentTrivia, ` eslint-enable no-use-before-define -- ${reason} `, false
        );
        const closingComments = getSyntheticTrailingComments(closed) || [];
        const closing = closingComments.at(-1);

        return setSyntheticTrailingComments(closed, [closing, ...closingComments.slice(0, -1)]);
    };
    const clearOwnedException = (node = {}) => {
        if (typeof setSyntheticLeadingComments !== 'function' || typeof setSyntheticTrailingComments !== 'function') return node;

        const ownedReasons = ['authored order', 'recursive binding', 'recursive agreement', 'source lifetime',
            'source declaration lifetime preserves early-reference initialization'];
        const retained = comments => comments.filter(({ text = '' } = {}) => {
            const [, reason = ''] = text.match(/^\s*eslint-(?:disable|enable)(?:-(?:next-)?line)? no-use-before-define -- (.*?)\s*$/u) || [];

            return !ownedReasons.includes(reason);
        });
        const leading = typeof getSyntheticLeadingComments === 'function' ? getSyntheticLeadingComments(node) || [] : [];
        const trailing = typeof getSyntheticTrailingComments === 'function' ? getSyntheticTrailingComments(node) || [] : [];

        return setSyntheticTrailingComments(setSyntheticLeadingComments(node, retained(leading)), retained(trailing));
    };
    const preserveComments = (original, visited) => {
        const leading = typeof getSyntheticLeadingComments === 'function'
            ? getSyntheticLeadingComments(original) || []
            : [];
        const trailing = typeof getSyntheticTrailingComments === 'function'
            ? getSyntheticTrailingComments(original) || []
            : [];
        const addComments = (node, comments, addComment, getComments) => comments.reduce((next, comment) => {
            const { text: commentText = '', kind: commentKind = 0, hasTrailingNewLine: commentNL = false } = getObject(comment);
            const existing = typeof getComments === 'function' ? getComments(next) || [] : [];
            const present = existing.some(({ text = '' } = {}) => text === commentText);

            return present ? next : addComment(next, commentKind, commentText, commentNL);
        }, node);

        return addComments(
            addComments(visited, leading, addSyntheticLeadingComment, getSyntheticLeadingComments),
            trailing,
            addSyntheticTrailingComment,
            getSyntheticTrailingComments
        );
    };
    const visit = ({ node = {}, parent = {}, statement = {}, owner = {}, ancestors = [] } = {}) => {
        if (!node) return node;

        const { kind: nodeKind = 0, text: nodeText = '' } = getObject(node);
        const { kind: parentKind = 0 } = getObject(parent);

        // Type syntax disappears before ESLint sees the completed JavaScript.
        // Its references cannot require a runtime declaration-order boundary.
        const runtimeHeritage = typescript.isExpressionWithTypeArguments(node) &&
            getObject(parent).token === ExtendsKeyword &&
            typescript.isClassDeclaration(ancestors.at(-2));

        if (nodeKind === Parameter || typescript.isTypeNode(node) && !runtimeHeritage) return node;

        const currentStatement = nodeKind === SourceFileKind
            ? undefined
            : statement || (parentKind === SourceFileKind ? node : {});
        const currentOwner = boundaryKinds.includes(nodeKind) && !getObject(owner).kind ? node : owner;
        const currentIndex = statementIndex.get(currentStatement);
        const cleaned = clearOwnedException(node);
        const visited = preserveComments(cleaned, typescript.visitEachChild(
            cleaned,
            child => visit({ node: child, parent: node, statement: currentStatement, owner: currentOwner, ancestors: [...ancestors, node] }),
            context
        ));

        if (heritageBoundaryOwners.has(node)) {
            return addSyntheticLeadingComment(visited, SingleLineCommentTrivia,
                ' eslint-disable-next-line no-use-before-define -- source declaration lifetime preserves early-reference initialization', true);
        }

        if (hoistedBoundaryOwners.has(node)) {
            return addException(
                visited,
                hoistedBoundaryOwners.get(node)
            );
        }

        const { getOriginalNode = false } = typescript;
        const originalNode = typeof getOriginalNode === 'function' ? getOriginalNode(node) : node;
        const completedReference = nodeKind === Identifier && [
            getConsumerContractKey(originalNode),
            getConsumerContractKey(node)
        ].some(key => completedReferenceRanges.has(key));
        const { agreement: hoistedReference = {} } = nodeKind === Identifier
            ? getDestructuringDecisionForNode({
                typescript, node, destructuringAgreements,
                kinds: [
                    'hoisted-function-reference',
                    'native-function-reference',
                    'declaration-lifetime-reference'
                ]
            }) : {};
        const targetIdx = declarationIndex.get(nodeText || '');
        const retainedReference = completedReference || [
            'retain-hoisted-reference',
            'retain-native-function-reference',
            'retain-function-scoped-var-reference'
        ].includes(getObject(hoistedReference).action);
        const needsReferenceException = retainedReference && (
            !Number.isInteger(currentIndex) ||
            !Number.isInteger(targetIdx) ||
            currentIndex < targetIdx
        );

        const heritageOwner = ancestors.find(candidate => typescript.isClassDeclaration(candidate) &&
            (getObject(candidate).heritageClauses || []).some(({ types = [] }) => types.some(({ expression = {} }) => expression === node)));

        const { text: referenceText = '' } = getObject(sourceFile);
        const commentFreeHeritage = heritageOwner && !/\/\/|\/\*/u.test(referenceText.slice(heritageOwner.getStart(sourceFile), node.getStart(sourceFile)));

        if (needsReferenceException && !getObject(currentOwner).kind && commentFreeHeritage) {
            heritageBoundaryOwners = new Map([...heritageBoundaryOwners, [heritageOwner, true]]);

            return visited;
        }

        if (needsReferenceException) {
            const ownsBoundary = boundaryKinds.includes(getObject(currentOwner).kind);

            hoistedBoundaryOwners = ownsBoundary
                ? new Map([...hoistedBoundaryOwners, [
                    currentOwner,
                    'source lifetime'
                ]])
                : hoistedBoundaryOwners;

            return ownsBoundary ? visited : addException(
                visited,
                'source declaration lifetime preserves early-reference initialization'
            );
        }

        if (nodeKind !== Identifier || importedNames.has(nodeText) ||
            !isReferenceIdentifier({ typescript, node, parent }) ||
            !Number.isInteger(currentIndex) ||
            currentIndex >= declarationIndex.get(nodeText)) return visited;

        const [fromStatements = {}] = statements.slice(targetIdx, targetIdx + 1);
        const targetStatement = byName.get(nodeText || '') || fromStatements;
        const referenceRange = getConsumerContractKey(originalNode);
        const originalTarget = typeof getOriginalNode === 'function'
            ? getOriginalNode(targetStatement) : targetStatement;

        // Completed lifetime agreements above retain their own owner. For the
        // generic module-order boundary, a known lexical mismatch rejects the
        // spelling candidate; generated/programless references keep the prior
        // conservative policy when no original fact exists.
        if (runtimeBindingReferences.has(referenceRange) &&
            runtimeBindingReferences.get(referenceRange) !== getConsumerContractKey(originalTarget)) return visited;

        // Synthesized references can have no original checker identity. The
        // completed lexical owner still proves a prior local initialization.
        // Stop at the nearest matching declaration, including a later one.
        const localOwners = ancestors.toReversed();
        const initializedLocal = () => {
            // eslint-disable-next-line resilient/prefer-prototype-methods -- Nearest lexical binding decides ownership, including a later declaration that blocks outer lookup.
            for (const localOwner of localOwners) {
                // These completed scopes can introduce bindings outside a
                // statement list. Missing ownership proof cannot cross them.
                if (typescript.isForStatement(localOwner) || typescript.isForInStatement(localOwner) ||
                    typescript.isForOfStatement(localOwner) || typescript.isCatchClause(localOwner) ||
                    typescript.isCaseBlock(localOwner) || typescript.isClassLike(localOwner) ||
                    typescript.isFunctionExpression(localOwner) && getObject(getObject(localOwner).name).text === nodeText) return false;

                const { parameters = [], statements: localStatements = [] } = getObject(localOwner);
                const localDeclaration = localStatements.find(candidate => getRuntimeBindingNames({ typescript, node: candidate }).includes(nodeText));

                if (localDeclaration) {
                    const [childOwner = node] = ancestors.slice(ancestors.indexOf(localOwner) + 1);

                    return localStatements.indexOf(localDeclaration) < localStatements.indexOf(childOwner);
                }

                if (parameters.some(parameter => getRuntimeBindingNames({ typescript, node: parameter }).includes(nodeText))) return true;
            }

            return false;
        };

        if (!runtimeBindingReferences.has(referenceRange) && initializedLocal()) return visited;

        const mutuallyRecursive = cyclicNames.has(nodeText || '') ||
            (targetStatement &&
                isRuntimeBindingStatement({ typescript, node: currentStatement }) &&
                isRuntimeBindingStatement({ typescript, node: targetStatement }));

        if (!mutuallyRecursive) return visited;

        if (boundaryKinds.includes(getObject(currentOwner).kind)) {
            const reason = cyclicNames.has(nodeText)
                ? 'recursive binding'
                : 'authored order';

            hoistedBoundaryOwners = new Map([...hoistedBoundaryOwners, [currentOwner, reason]]);

            return visited;
        }

        return addException(visited);
    };

    return factory.updateSourceFile(
        sourceFile,
        statements.map(statement => visit({ node: statement, parent: sourceFile, statement }))
    );
};

const LOOP_BOUNDARY_ACTIONS = new Set([
    'indexed-local-staged-selection',
    'iterator-payload-local-binding',
    'iterator-payload-local-declaration',
    'mutable-selected-loop-binding',
    'operational-collection-builder',
    'operational-object-builder',
    'operational-work-queue',
    'retain-dynamic-arguments-loop',
    'retain-indexed-array-traversal',
    'retain-live-iterator-traversal',
    'retain-live-own-key-enumeration',
    'retain-live-object-enumeration',
    'retain-live-array-visitation',
    'retain-loop-carried-recurrence',
    'retain-numeric-range-builder',
    'retain-live-set-visitation',
    'retain-observable-set-union'
]);

const annotateCompletedLoopBoundaries = ({
    typescript = {}, sourceFile = {}, destructuringAgreements = {}, context = {}
} = {}) => {
    const {
        ForStatement = -1,
        ForInStatement = -1,
        ForOfStatement = -1,
        WhileStatement = -1,
        DoStatement = -1,
        SingleLineCommentTrivia = -1,
        MultiLineCommentTrivia = -1
    } = getSyntaxKinds(typescript);
    const loopKinds = [ForStatement, ForInStatement, ForOfStatement, WhileStatement, DoStatement];
    const { addSyntheticLeadingComment = false, addSyntheticTrailingComment = false,
        getSyntheticLeadingComments = false,
        setSyntheticLeadingComments = false } = typescript;
    const directive = 'eslint-disable-next-line resilient/prefer-prototype-methods';
    const { byLoop = new Map() } = destructuringAgreements;
    const getLoopDecision = (node = {}) => {
        const direct = getDestructuringDecisionForNode({
            typescript,
            node,
            destructuringAgreements
        });
        const { agreement: directAgreement = {} } = direct;

        if (LOOP_BOUNDARY_ACTIONS.has(getObject(directAgreement).action)) return direct;

        const { getOriginalNode = false } = typescript;
        const original = typeof getOriginalNode === 'function' ? getOriginalNode(node) : node;
        const loopRange = getConsumerContractKey(original);

        return (byLoop.get(loopRange) || [])
            .find(({ agreement = {}, contract = {} } = {}) => (
                LOOP_BOUNDARY_ACTIONS.has(getObject(agreement).action) &&
                getObject(contract).loopRange === loopRange
            )) || direct;
    };
    const visit = (node = {}) => {
        const visited = typescript.visitEachChild(node, visit, context);
        const { kind = 0 } = getObject(node);

        if (!loopKinds.includes(kind)) return visited;

        const { agreement = {}, contract = {} } = getLoopDecision(node);
        const { action = '' } = getObject(agreement);
        const { evidence = [] } = getObject(contract);
        const { nativeEntryBinding = false, mutationBoundary = false } = getObject(contract);
        const [reason = ''] = Array.isArray(evidence) ? evidence : [];
        const comments = typeof getSyntheticLeadingComments === 'function'
            ? getSyntheticLeadingComments(visited) || [] : [];

        if (!LOOP_BOUNDARY_ACTIONS.has(action) || !reason ||
            comments.some(({ text = '' } = {}) => text.includes(directive)) ||
            typeof addSyntheticLeadingComment !== 'function') return visited;

        const retained = action === 'retain-live-own-key-enumeration' &&
            typeof setSyntheticLeadingComments === 'function'
            ? setSyntheticLeadingComments(visited, comments.filter(({ text = '' } = {}) => (
                !text.includes('Source loop has unproven callback safety or sequential effects')
            ))) : visited;
        const entryRules = [
            action === 'retain-live-array-visitation' && nativeEntryBinding
                ? 'resilient/prefer-safe-destructuring-defaults' : '',
            action === 'retain-live-array-visitation' && mutationBoundary
                ? 'resilient/prefer-safe-transformations' : ''
        ].filter(Boolean);
        const entryReasons = [
            nativeEntryBinding ? 'Native entry binding preserves iterator failure.' : '',
            mutationBoundary ? 'Fresh accumulator identity remains source-owned.' : ''
        ].filter(Boolean);
        const entryBoundary = entryRules.length
            ? addSyntheticLeadingComment(retained, MultiLineCommentTrivia,
                ` eslint-disable ${entryRules.join(', ')} -- ${entryReasons.join(' ')} `,
                true)
            : retained;
        const loopBoundary = addSyntheticLeadingComment(
            entryBoundary,
            SingleLineCommentTrivia,
            ` ${directive} -- ${reason}.`,
            true
        );

        return entryRules.length && typeof addSyntheticTrailingComment === 'function'
            ? addSyntheticTrailingComment(loopBoundary, MultiLineCommentTrivia,
                ` eslint-enable ${entryRules.join(', ')} `, true)
            : loopBoundary;
    };

    return typescript.visitNode(sourceFile, visit);
};

const annotateRetainedDynamicMemberAccess = ({
    typescript = {},
    sourceFile = {},
    destructuringAgreements = {},
    context = {},
    annotationsOnly = false
} = {}) => {
    const {
        ExpressionStatement = -1,
        VariableDeclaration = -1,
        VariableStatement = -1,
        BinaryExpression = -1,
        ElementAccessExpression = -1,
        PropertyAccessExpression = -1,
        ParenthesizedExpression = -1,
        AsExpression = -1,
        TypeAssertionExpression = -1,
        NonNullExpression = -1,
        SatisfiesExpression = -1,
        EqualsToken = -1,
        CommaToken = -1,
        ForOfStatement = -1,
        Parameter = -1,
        ArrayBindingPattern = -1,
        MultiLineCommentTrivia = -1,
        SingleLineCommentTrivia = -1
    } = getSyntaxKinds(typescript);
    const {
        addSyntheticTrailingComment = false,
        addSyntheticLeadingComment = false
    } = typescript;

    if (typeof addSyntheticTrailingComment !== 'function') return sourceFile;

    const { operationalStatements = new Map(), operationalLoops = new Set() } = destructuringAgreements;
    const annotateOperationalStatement = (node, bindingShape = '') => {
        const safe = addSyntheticLeadingComment(node, SingleLineCommentTrivia,
            ' eslint-disable-next-line resilient/prefer-safe-transformations -- live setter timing.', true);

        if (bindingShape === 'destructured-entry') return addSyntheticLeadingComment(
            safe,
            SingleLineCommentTrivia,
            ' eslint-disable-next-line resilient/prefer-destructured-member-access -- computed write retains live setter and __proto__ behavior',
            true
        );

        const member = addSyntheticLeadingComment(safe, SingleLineCommentTrivia,
            ' eslint-disable-next-line resilient/prefer-destructured-member-access -- key Get order', true);

        return addSyntheticLeadingComment(member, SingleLineCommentTrivia,
            ' eslint-disable-next-line prefer-destructuring -- value Get order', true);
    };

    // Source facts own eligibility. Completed syntax owns the diagnostic start;
    // comments never ask a linter to classify or rewrite the retained operation.
    const indexedComments = new Map();
    const indexedRules = ['resilient/prefer-destructured-member-access', 'prefer-destructuring',
        'resilient/prefer-safe-transformations', 'no-plusplus'];
    const ruleScope = (scope, comments = []) => comments.reduce((current, { text = '' } = {}) => {
        const [directive = ''] = text.trim().split(/\s+--(?:\s|$)/u);
        const match = directive.trim().match(/^eslint-(disable|enable)(?!-)(?:\s+(.*))?$/u);

        if (!match) return current;

        const [, action = '', names = ''] = match;
        const rules = names.split(',').map(name => name.trim()).filter(Boolean);

        if (action === 'disable') return new Set([...current, ...(rules.length ? rules : indexedRules)]);

        return rules.length ? new Set([...current].filter(rule => !rules.includes(rule))) : new Set();
    }, new Set(scope));
    // Later static and loop placement can own an enclosing exception. Reconcile
    // only this emitter's synthetic members after those scopes are complete;
    // the retained operation and its grouping remain exactly as placed.

    if (annotationsOnly) {
        const original = typescript.getOriginalNode(sourceFile);
        const { text: sourceText = '' } = getObject(original);
        const seenComments = new Set();
        let completedScope = new Set();
        // Authored endpoints can invalidate an enclosing generated scope;
        // authored disables never supply new pruning proof in this pass.
        const authored = (node, trailing = false) => {
            if (typescript.isSourceFile(node)) return [];

            const sourceNode = typescript.getOriginalNode(node);
            const { pos = -1, end = -1 } = getObject(sourceNode);
            const position = trailing ? end : pos;
            const ranges = position < 0 ? [] : (trailing
                ? typescript.getTrailingCommentRanges(sourceText, position)
                : typescript.getLeadingCommentRanges(sourceText, position)) || [];

            return ranges.filter(({ pos: start = -1 } = {}) => !seenComments.has(start)).map(({ pos: start = 0, end: finish = 0 } = {}) => {
                // eslint-disable-next-line resilient/prefer-safe-transformations -- Private visitation set consumes each authored comment once in emitted order.
                seenComments.add(start);

                return { text: sourceText.slice(start + 2, finish).replace(/\*\/$/u, '') };
            }).filter(({ text = '' } = {}) => /^\s*eslint-enable(?:\s|$)/u.test(text));
        };
        const reconcile = (node) => {
            if (typescript.isTypeNode(node) || typescript.isTypeAliasDeclaration(node) ||
                typescript.isInterfaceDeclaration(node) ||
                typescript.isFunctionDeclaration(node) && !getObject(node).body) return node;

            const leading = typescript.getSyntheticLeadingComments(node) || [];

            completedScope = ruleScope(completedScope, [...authored(node), ...leading]);
            const retained = leading.flatMap((comment) => {
                const { text = '' } = comment;
                const match = text.match(/^ eslint-disable-next-line (.*?) -- (Get order|Operand Get order|Indexed update preserves key, mutation and result phase)([.;].*)?$/u);

                if (!match) return [comment];

                const [, names = '', reason = '', suffix = ''] = match;
                const rules = names.split(', ').filter(rule => !completedScope.has(rule));

                return rules.length ? [{ ...comment, text: ` eslint-disable-next-line ${rules.join(', ')} -- ${reason}${suffix}` }] : [];
            });
            const cleaned = retained.length === leading.length && retained.every((comment, index) => leading.indexOf(comment) === index)
                ? node : typescript.setSyntheticLeadingComments(node, retained);
            const visited = typescript.visitEachChild(cleaned, reconcile, context);

            completedScope = ruleScope(completedScope, [...authored(node, true), ...typescript.getSyntheticTrailingComments(node) || []]);

            return visited;
        };

        return typescript.visitNode(sourceFile, reconcile);
    }

    const originalSource = typescript.getOriginalNode(sourceFile);
    const { text: authoredText = '' } = getObject(originalSource);
    const { byKind = new Map() } = destructuringAgreements;
    const [{ contract: { authoredComments = [] } = {} } = {}] = byKind.get('indexed-operation') || [];
    const authoredScope = (node) => {
        const original = typescript.getOriginalNode(node);
        const { pos = -1 } = getObject(original);
        const start = pos >= 0 ? original.getStart(originalSource) : -1;

        const preceding = authoredComments.filter(({ end = 0 } = {}) => end <= start);
        const scoped = ruleScope(new Set(), preceding
            .map(({ pos = 0, end = 0 } = {}) => ({ text: authoredText.slice(pos + 2, end).replace(/\*\/$/u, '') })));
        const { line = -1 } = start >= 0 ? originalSource.getLineAndCharacterOfPosition(start) : {};
        const nextLineRules = preceding.flatMap(({ pos = 0, end = 0 } = {}) => {
            const directive = authoredText.slice(pos + 2, end).replace(/\s+--[\s\S]*$/u, '').trim();
            const match = directive.match(/^eslint-disable-next-line(?:\s+(.*))?$/u);

            const [, names = ''] = match || [];
            const { line: commentLine = -1 } = originalSource.getLineAndCharacterOfPosition(end);

            if (!match || commentLine + 1 !== line) return [];

            return names ? names.split(',').map(rule => rule.trim()) : indexedRules;
        });

        return new Set([...scoped, ...nextLineRules]);
    };
    const addIndexedComment = (owner, rules = [], reason = 'Get order', scope = new Set()) => {
        const outer = new Set([...scope, ...authoredScope(owner)]);
        const necessary = rules.filter(rule => !outer.has(rule));
        const existing = indexedComments.get(owner) || [];

        // eslint-disable-next-line resilient/prefer-safe-transformations -- Private placement ledger combines exact rules and distinct reasons only at the same completed diagnostic owner.
        indexedComments.set(owner, [...existing, ...necessary.map(rule => ({ rule, reason }))]);
    };
    const placeIndexedComment = (original, node, ancestors = []) => {
        const entries = indexedComments.get(original) || [];
        const rules = [...new Set(entries.map(({ rule = '' } = {}) => rule))];
        const reasons = [...new Set(entries.map(({ reason = '' } = {}) => reason))];

        if (!rules.length) return node;

        const placed = addSyntheticLeadingComment(node, SingleLineCommentTrivia,
            ` eslint-disable-next-line ${rules.join(', ')} -- ${reasons.join('; ')}.`, true);

        // A declaration reports at its binding, rather than at its initializer.
        if (typescript.isVariableDeclaration(node)) {
            const { name = {}, exclamationToken = undefined, type = undefined, initializer = {} } = getObject(placed);
            const separated = typescript.isParenthesizedExpression(initializer) &&
                (typescript.getSyntheticTrailingComments(getObject(initializer).expression) || [])
                    .some(({ text = '' } = {}) => text === ' Retained indexed operation ends here.');
            const isolated = separated ? initializer
                : typescript.factory.createParenthesizedExpression(addSyntheticTrailingComment(
                    initializer, SingleLineCommentTrivia, ' Retained indexed initializer ends here.', true
                ));

            return typescript.factory.updateVariableDeclaration(placed, name, exclamationToken, type, isolated);
        }

        // The ordinary trailing comment separates the following operand from
        // this rule's physical target line. Wrap the completed receiver chain,
        // never an inner optional segment, preserving short-circuit semantics.
        const separated = addSyntheticTrailingComment(
            placed, SingleLineCommentTrivia, ' Retained indexed operation ends here.', true
        );
        const [consumer = {}] = ancestors;

        // A second value wrapper establishes its continuation independently
        // of the computed key's closer. Its own closer also keeps the native
        // comma adjacent, rather than isolating it after the trailing comment.
        const propertyValue = typescript.isPropertyAssignment(consumer) &&
            typescript.isComputedPropertyName(getObject(consumer).name) &&
            getObject(consumer).initializer === original;

        const isolated = typescript.factory.createParenthesizedExpression(separated);

        return propertyValue ? typescript.factory.createParenthesizedExpression(isolated) : isolated;
    };
    // The retained-read decision owns semantics; the completed consumer owns
    // rule placement. An indexed write may already have become a spread.
    const chainKinds = new Set([ElementAccessExpression, PropertyAccessExpression, ParenthesizedExpression,
        AsExpression, TypeAssertionExpression, NonNullExpression, SatisfiesExpression]);
    const rootReceiver = node => chainKinds.has(getObject(node).kind)
        ? rootReceiver(getObject(node).expression) : getObject(node);
    const optionalChain = node => typescript.isOptionalChain(getObject(node)) ||
        chainKinds.has(getObject(node).kind) && optionalChain(getObject(node).expression);
    const completedReadSite = (node, ancestors) => {
        const chain = ancestors.reduce((outer, candidate) => (
            chainKinds.has(getObject(candidate).kind) && getObject(candidate).expression === outer ? candidate : outer
        ), node);
        const consumerIndex = chain === node ? 0 : ancestors.indexOf(chain) + 1;
        const [rawConsumer = {}] = ancestors.slice(consumerIndex, consumerIndex + 1);
        const consumer = getObject(rawConsumer);
        const { kind = 0, initializer = {}, right = {}, operatorToken = {} } = consumer;
        const { kind: operator = 0 } = getObject(operatorToken);

        return {
            chain,
            consumer: rawConsumer,
            coreDestructuring: !optionalChain(chain) && (kind === VariableDeclaration && initializer === chain ||
                kind === BinaryExpression && right === chain && operator === EqualsToken)
        };
    };
    const authoredNextLine = (node) => {
        const original = typescript.getOriginalNode(node);
        const { pos = -1 } = getObject(original);
        const start = pos >= 0 ? original.getStart(originalSource) : -1;
        const { line = -1 } = start >= 0 ? originalSource.getLineAndCharacterOfPosition(start) : {};

        return authoredComments.some(({ pos: commentStart = 0, end = 0 } = {}) => (
            end <= start && /^\s*eslint-disable-next-line\b/u.test(authoredText.slice(commentStart + 2, end)) &&
            originalSource.getLineAndCharacterOfPosition(end).line + 1 === line
        ));
    };
    const finishAuthoredCollision = (node, visited, { members = [], targets = [], competing = false } = {}) => {
        const { declarationList = {} } = getObject(node);
        const { declarations = [] } = getObject(declarationList);
        const [{ initializer = {} } = {}] = declarations;
        const { body = {}, parameters = [] } = getObject(initializer);
        const original = typescript.getOriginalNode(node);
        const { pos = -1, end = -1 } = getObject(original);
        const singleLine = pos >= 0 && originalSource.getLineAndCharacterOfPosition(original.getStart(originalSource)).line
            === originalSource.getLineAndCharacterOfPosition(end).line;
        const [{ rules = [], reason = '', scope = new Set() } = {}] = targets;
        const [rule = ''] = rules;
        const [{ node: onlyMember = {} } = {}] = members.filter(({ callee = false } = {}) => !callee);
        const [{ node: target = {} } = {}] = targets;
        const internalDirective = authoredComments.some(({ pos: commentStart = 0, end: commentEnd = 0 } = {}) => (
            commentStart >= original.getStart(originalSource) && commentEnd <= end &&
            /^\s*eslint-(?:disable|enable)/u.test(authoredText.slice(commentStart + 2, commentEnd))
        ));
        const supported = !competing && !internalDirective && singleLine && declarations.length === 1 &&
            typescript.isArrowFunction(initializer) && !typescript.isBlock(body) &&
            parameters.every(({ name = {}, initializer: parameterInitializer = undefined } = {}) => (
                typescript.isIdentifier(name) && !parameterInitializer
            )) && targets.length === 1 && onlyMember === target &&
            members.filter(({ callee = false } = {}) => !callee).length === 1 &&
            typescript.isIdentifier(getObject(target).expression) && !typescript.isOptionalChain(target) &&
            rules.length === 1 && rule === 'resilient/prefer-destructured-member-access';

        // Unsupported authored line layouts retain the source unit and expose
        // the indexed finding. Never move an authored target to another line.
        if (!supported || scope.has(rule)) return visited;

        const open = addSyntheticLeadingComment(typescript.factory.createNotEmittedStatement(node),
            MultiLineCommentTrivia, ` eslint-disable ${rules.join(', ')} -- ${reason} `, true);
        const close = addSyntheticLeadingComment(typescript.factory.createNotEmittedStatement(node),
            MultiLineCommentTrivia, ` eslint-enable ${rules.join(', ')} `, true);

        return [open, visited, close];
    };
    const visit = ({ node = {}, ancestors = [], scope = new Set(), authoredCollision = false } = {}) => {
        if (!node) return node;

        const { kind: nodeKind = 0 } = getObject(node);

        const leading = typescript.getSyntheticLeadingComments(node) || [];
        const enclosingScope = ruleScope(scope, leading);
        let childScope = enclosingScope;
        const ownsCollision = nodeKind === VariableStatement && authoredNextLine(node);
        const { declarationList = {} } = getObject(node);
        const { declarations = [] } = getObject(declarationList);
        const [{ initializer: arrow = {} } = {}] = declarations;
        const collision = ownsCollision ? { members: [], targets: [], competing: false, arrow } : authoredCollision;
        const { arrow: collisionArrow = {} } = getObject(collision);

        if (collision && typescript.isFunctionLike(node) && node !== collisionArrow) {
            // eslint-disable-next-line resilient/prefer-safe-transformations, resilient/prefer-destructured-member-access -- Private collision proof rejects nested function owners whose lexical member scope differs.
            collision.competing = true;
        }

        if (collision && [...leading, ...typescript.getSyntheticTrailingComments(node) || []]
            .some(({ text = '' } = {}) => /^\s*eslint-(?:disable|enable)/u.test(text))) {
            // eslint-disable-next-line resilient/prefer-safe-transformations, resilient/prefer-destructured-member-access -- Private collision proof rejects competing generated scopes without altering source or caller-owned metadata.
            collision.competing = true;
        }

        const visitChild = (child) => {
            const result = visit({ node: child, ancestors: [node, ...ancestors], scope: childScope, authoredCollision: collision });

            childScope = ruleScope(childScope, [
                ...typescript.getSyntheticLeadingComments(child) || [],
                ...typescript.getSyntheticTrailingComments(child) || []
            ]);

            return result;
        };

        if ([Parameter, ArrayBindingPattern].includes(nodeKind)) return node;

        if (nodeKind === ForOfStatement && operationalLoops.has(getConsumerContractKey(node))) {
            const visitedLoop = typescript.visitEachChild(
                node,
                visitChild,
                context
            );
            const { initializer = {} } = getObject(visitedLoop);
            const { declarations = [] } = getObject(initializer);
            const [declaration = {}] = declarations;
            const { name: pattern = {} } = getObject(declaration);
            const { text: loopText = '' } = getObject(sourceFile);
            const { end: patternEnd = 0 } = getObject(pattern);
            const commentFreeBinding = !/\/\/|\/\*/u.test(loopText.slice(node.getStart(sourceFile), patternEnd));

            const placedBinding = commentFreeBinding
                ? addSyntheticLeadingComment(visitedLoop, SingleLineCommentTrivia,
                    ' eslint-disable-next-line resilient/prefer-safe-destructuring-defaults -- required entry iteration keeps native failure', true)
                : addSyntheticTrailingComment(pattern, MultiLineCommentTrivia,
                    ' eslint-disable-line resilient/prefer-safe-destructuring-defaults -- required entry iteration keeps native failure ', false);

            return addSyntheticLeadingComment(
                commentFreeBinding ? placedBinding : visitedLoop,
                SingleLineCommentTrivia,
                ' eslint-disable-next-line resilient/prefer-prototype-methods -- live entry iteration and setter behavior.',
                true
            );
        }

        if (nodeKind === ExpressionStatement && operationalStatements.has(getConsumerContractKey(node))) {
            return annotateOperationalStatement(node, operationalStatements.get(getConsumerContractKey(node)));
        }

        const visited = typescript.visitEachChild(
            node,
            visitChild,
            context
        );
        const { agreement: indexedAgreement = {} } = getDestructuringDecisionForNode({
            typescript,
            node,
            destructuringAgreements,
            kinds: ['indexed-operation']
        });
        const { action: indexedAction = '', operation: indexedOperation = '', staticPosition = false } = indexedAgreement;

        const { chain = node, consumer = {}, coreDestructuring = false } = completedReadSite(node, ancestors);

        if (collision && [ElementAccessExpression, PropertyAccessExpression].includes(nodeKind)) {
            const callee = typescript.isCallExpression(consumer) && getObject(consumer).expression === chain;

            // eslint-disable-next-line resilient/prefer-safe-transformations, resilient/prefer-destructured-member-access -- Private collision evidence records every completed member so a declaration pair cannot mask another target.
            collision.members = [...collision.members, { node, callee }];
        }

        const { memberBoundary = true } = indexedAgreement;
        const memberRules = memberBoundary && typescript.isIdentifier(rootReceiver(getObject(node).expression))
            ? ['resilient/prefer-destructured-member-access'] : [];

        if (collision && indexedAction === 'retain-indexed-read' && memberRules.length && chain === node && !coreDestructuring) {
            // eslint-disable-next-line resilient/prefer-safe-transformations, resilient/prefer-destructured-member-access -- Private collision proof records the existing retained decision; production never asks ESLint to select rules.
            collision.targets = [...collision.targets, { node, rules: memberRules, reason: 'Get order',
                scope: new Set([...enclosingScope, ...authoredScope(node)]) }];
        }

        if (collision) return ownsCollision ? finishAuthoredCollision(node, visited, collision) : visited;

        if (indexedAction === 'retain-dynamic-arguments-read' && staticPosition && coreDestructuring) {
            addIndexedComment(consumer, ['prefer-destructuring'],
                'Direct arguments index preserves its live alias and avoids iterator acquisition', enclosingScope);
        }

        if (indexedAction === 'retain-indexed-update') {
            const [operation = {}] = ancestors;
            const afterthought = ancestors.slice(1).reduce((outer, candidate) => {
                const { kind = 0, expression = {}, left = {}, right = {}, operatorToken = {} } = getObject(candidate);
                const transparent = [ParenthesizedExpression, AsExpression, TypeAssertionExpression,
                    NonNullExpression, SatisfiesExpression].includes(kind) && expression === outer;
                const sequence = kind === BinaryExpression &&
                    getObject(operatorToken).kind === CommaToken &&
                    (left === outer || right === outer);

                return transparent || sequence ? candidate : outer;
            }, operation);
            const [owner = {}] = ancestors.slice(ancestors.indexOf(afterthought) + 1);
            const loopAfterthought = typescript.isForStatement(owner) && getObject(owner).incrementor === afterthought;
            const rules = [indexedOperation === 'increment' && !loopAfterthought ? 'no-plusplus' : '',
                'resilient/prefer-safe-transformations'].filter(Boolean);

            addIndexedComment(operation, [...rules, ...memberRules], 'Indexed update preserves key, mutation and result phase', enclosingScope);
        }

        if (indexedAction === 'retain-indexed-read') {
            addIndexedComment(chain, memberRules,
                indexedOperation === 'binary-read' ? 'Operand Get order' : 'Get order', enclosingScope);
        }

        if (indexedAction === 'retain-indexed-read' && coreDestructuring) {
            addIndexedComment(consumer, ['prefer-destructuring'], 'Get order', enclosingScope);
        }

        return placeIndexedComment(node, visited, ancestors);
    };

    return typescript.visitNode(sourceFile, node => visit({ node }));
};

// A static data selection normally belongs to the selected-binding grammar.
// When it survives that grammar it is an exact retained boundary: moving it
// into a binding would either merge repeated getter reads or move a later
// operand read ahead of another observable expression.  Keep the source read
// at its original evaluation point and document that single exception on the
// access itself.  Dynamic accesses have their own key-identity boundary above.
const annotateRetainedStaticMemberAccess = ({
    typescript = {},
    sourceFile = {},
    destructuringAgreements = {},
    context = {}
} = {}) => {
    const {
        ReturnStatement = -1,
        IfStatement = -1,
        ExpressionStatement = -1,
        VariableStatement = -1,
        ArrowFunction = -1,
        Block = -1,
        Identifier = -1,
        PropertyAccessExpression = -1,
        SingleLineCommentTrivia = -1,
        MultiLineCommentTrivia = -1
    } = getSyntaxKinds(typescript);
    const {
        addSyntheticLeadingComment = false,
        addSyntheticTrailingComment = false,
        getSyntheticLeadingComments = false,
        factory = {}
    } = typescript;

    if (typeof addSyntheticLeadingComment !== 'function') return sourceFile;

    const { hasCallableOperations = false, tupleArgumentFacts = [],
        orderedReadStatements = new Set(), operationalUpdateKeys = new Set() } = destructuringAgreements;
    const operationKinds = ['callable-operation', 'callable-operation-placement'];
    const getOperationBoundary = (node = {}) => {
        if (!hasCallableOperations) return {};

        const { agreement = {}, contract = {}, entry = {} } = getDestructuringDecisionForNode({
            typescript, node, destructuringAgreements, kinds: operationKinds
        });
        const { action = '', rules = [] } = agreement;
        const { placementRange = '', evidence = [] } = contract;
        const { key = '' } = entry;
        const [reason = ''] = evidence;

        return action === 'retain-callable-operation' && placementRange === key ? { reason, rules } : {};
    };
    // Completed callable owners supply exact rules and reasons for their full
    // statement span, independently of incoming rule count or prose width.
    const addOperationBoundary = (node = {}, { reason = '', rules: requestedRules = [] } = {}) => {
        if (!requestedRules.length || typeof addSyntheticTrailingComment !== 'function') return node;

        const comments = typeof getSyntheticLeadingComments === 'function' ? getSyntheticLeadingComments(node) || [] : [];
        const trailing = typescript.getSyntheticTrailingComments(node) || [];
        const previousIndex = comments.findLastIndex(({ kind = 0, text = '' }) => {
            const [, names = ''] = text.match(/^ eslint-disable ([^\n]+?) -- [\s\S]+ $/u) || [];

            return kind === MultiLineCommentTrivia && names && trailing.some(comment => (
                getObject(comment).kind === MultiLineCommentTrivia && getObject(comment).text === ` eslint-enable ${names} `
            ));
        });
        const previous = comments.at(previousIndex);
        const [, priorNames = '', priorReason = ''] = getObject(previous).kind === MultiLineCommentTrivia
            ? (getObject(previous).text || '').match(/^ eslint-disable ([^\n]+?) -- ([^\n]+) $/u) || [] : [];
        const closingIndex = trailing.findIndex(comment => getObject(comment).kind === MultiLineCommentTrivia &&
            getObject(comment).text === ` eslint-enable ${priorNames} `);
        const paired = previousIndex >= 0 && closingIndex >= 0;
        const rules = [...new Set([...(paired ? priorNames.split(', ') : []), ...requestedRules])];
        const includesReason = priorReason === reason || priorReason.startsWith(`${reason}; `) ||
            priorReason.endsWith(`; ${reason}`) || priorReason.includes(`; ${reason}; `);
        const existingReason = paired ? priorReason : reason;
        const explanation = paired && !includesReason ? `${priorReason}; ${reason}` : existingReason;
        // Every completed callable owner covers its full statement span,
        // including declarations with initializers on later physical lines.
        const directive = `eslint-disable ${rules.join(', ')}`;

        if (paired) {
            typescript.setSyntheticLeadingComments(node, comments.map((comment, index) => index === previousIndex
                ? { ...comment, text: ` ${directive} -- ${explanation} ` } : comment));

            return typescript.setSyntheticTrailingComments(node, trailing.map((comment, index) => index === closingIndex
                ? { ...comment, text: ` eslint-enable ${rules.join(', ')} ` } : comment));
        }

        const placed = addSyntheticLeadingComment(node, MultiLineCommentTrivia,
            ` ${directive} -- ${explanation} `, true);
        const leading = typescript.getSyntheticLeadingComments(placed) || [];
        const lineBoundary = leading.findIndex(({ text = '' }) => /^\s*eslint-disable-next-line\b/u.test(text));

        // The scope starts before code-owned next-line annotations, so their
        // physical target remains the statement rather than the new opener.
        if (lineBoundary >= 0) typescript.setSyntheticLeadingComments(placed, [
            ...leading.slice(0, lineBoundary), leading.at(-1), ...leading.slice(lineBoundary, -1)
        ]);

        return addSyntheticTrailingComment(
            placed,
            MultiLineCommentTrivia,
            ` eslint-enable ${rules.join(', ')} `,
            true
        );
    };
    const { byKey: operationDecisions = new Map() } = destructuringAgreements;
    const operationRules = [...new Set([...operationDecisions.values()].flatMap(records => records.flatMap(({
        agreement: { rules = [] } = {}
    } = {}) => rules)))];
    const applyScopes = (scope, comments = [], relevant = operationRules) => comments.reduce((active, { text = '' } = {}) => {
        const [directive = ''] = text.trim().split(/\s+--(?:\s|$)/u);
        const [, action = '', names = ''] = directive.trim().match(/^eslint-(disable|enable)(?!-)(?:\s+(.*))?$/u) || [];
        const rules = names ? names.split(',').map(name => name.trim()) : relevant;

        if (action === 'disable') return new Set([...active, ...rules]);

        return action === 'enable' ? new Set([...active].filter(rule => !rules.includes(rule))) : active;
    }, new Set(scope));
    const originalSource = typescript.getOriginalNode(sourceFile);
    const { text: authoredText = '' } = getObject(originalSource);
    const sourceComments = node => [
        ...typescript.getLeadingCommentRanges(authoredText, getObject(node).pos) || [],
        ...typescript.getTrailingCommentRanges(authoredText, getObject(node).end) || [],
        ...node.getChildren(originalSource).flatMap(sourceComments)
    ];
    const authoredComments = [...new Map(sourceComments(originalSource).map(({ pos = 0, end = 0 }) => (
        [pos, { end, text: authoredText.slice(pos + 2, end).replace(/\*\/$/u, '') }]
    ))).values()].toSorted((left, right) => getObject(left).end - getObject(right).end);
    const inheritedAuthoredRules = (node, relevant) => {
        const original = typescript.getOriginalNode(node);
        const { pos = -1 } = getObject(original);
        const start = pos >= 0 ? original.getStart(originalSource) : -1;

        return applyScopes(new Set(), authoredComments.filter(({ end = 0 }) => end <= start), relevant);
    };
    const statementKinds = [ReturnStatement, ExpressionStatement, VariableStatement];
    const placementKinds = [...statementKinds, IfStatement];
    let annotatedStatements = new Set();
    // Placement may need to carry a reason from a source statement to its
    // visited shell. Keep that ephemeral relation in this transform instead
    // of extending caller-owned TypeScript nodes with Resilient metadata.
    const retainedReasons = new WeakMap();
    const getOriginal = (node = {}) => {
        const { getOriginalNode = false } = typescript;

        return typeof getOriginalNode === 'function' ? getOriginalNode(node) : node;
    };
    const rememberRetainedReason = (node = {}, reason = '') => {
        if (!node || !reason) return;

        // eslint-disable-next-line resilient/prefer-safe-transformations -- Transform-owned identity state carries a placement reason without changing the caller-owned AST node.
        retainedReasons.set(node, reason);
        const original = getOriginal(node);

        if (original && original !== node) {
            // eslint-disable-next-line resilient/prefer-safe-transformations -- Original-node provenance needs the same transform-local placement reason.
            retainedReasons.set(original, reason);
        }
    };
    const getRetainedReason = (node = {}) => retainedReasons.get(node) || retainedReasons.get(getOriginal(node)) || '';
    const addBoundary = (node, reason = '') => {
        const comments = typeof getSyntheticLeadingComments === 'function'
            ? getSyntheticLeadingComments(node) || []
            : [];
        const directive = 'eslint-disable-next-line resilient/prefer-destructured-member-access';

        const explanation = operationalUpdateKeys.has(getConsumerContractKey(getObject(node).expression))
            ? 'method/key read precedes later value read'
            : reason || 'retained tuple read preserves getter and operand order';

        if (comments.some(({ text = '' } = {}) => text.includes(directive))) return node;

        return addSyntheticLeadingComment(
            node,
            SingleLineCommentTrivia,
            ` ${directive} -- ${explanation}`,
            true
        );
    };
    const visit = (node, owningStatement = {}, enclosingRules = new Set()) => {
        if (!node) return node;

        const childOwner = placementKinds.includes(getObject(node).kind) ? node : owningStatement;
        const operationBoundary = placementKinds.includes(getObject(node).kind) ? getOperationBoundary(node) : {};
        const arrowBoundary = getObject(node).kind === ArrowFunction && getObject(getObject(node).body).kind !== Block
            ? getOperationBoundary(getObject(node).body) : {};
        const boundary = getObject(operationBoundary).reason ? operationBoundary : arrowBoundary;
        const { rules: ownedRules = [] } = boundary;
        const authoredRules = inheritedAuthoredRules(node, ownedRules);
        const activeRules = applyScopes(new Set([...enclosingRules, ...authoredRules]),
            typescript.getSyntheticLeadingComments(node) || []);
        const rules = [...new Set(ownedRules)].filter(rule => !enclosingRules.has(rule) && !authoredRules.has(rule));
        let childRules = new Set([...activeRules, ...ownedRules]);
        const visited = typescript.visitEachChild(node, (child) => {
            const result = visit(child, childOwner, childRules);
            childRules = applyScopes(childRules, [...typescript.getSyntheticLeadingComments(child) || [],
                ...typescript.getSyntheticTrailingComments(child) || []]);

            return result;
        }, context);
        const { agreement: projectionAgreement = {} } = getDestructuringDecisionForNode({
            typescript,
            node,
            destructuringAgreements,
            kinds: ['receiver-ordered-projection']
        });
        const isOrderedProjection = getObject(projectionAgreement).action === 'retain-receiver-ordered-projection';
        const { agreement: tupleArgumentAgreement = {} } = getDestructuringDecisionForNode({
            typescript,
            node,
            destructuringAgreements,
            kinds: ['short-circuit-tuple-argument']
        });
        const isOrderedTuple = getObject(tupleArgumentAgreement).action === 'retain-receiver-ordered-tuple-argument';
        const isOrderedRead = statementKinds.includes(getObject(node).kind) &&
            orderedReadStatements.has(getConsumerContractKey(node));
        const { agreement: deferredFieldAgreement = {} } = getDestructuringDecisionForNode({
            typescript,
            node,
            destructuringAgreements,
            kinds: ['deferred-opaque-field-binding']
        });
        const retainedDeferredField = ['retain-deferred-opaque-field-read']
            .includes(getObject(deferredFieldAgreement).action);
        const { agreement: repeatedReadAgreement = {} } = getDestructuringDecisionForNode({
            typescript,
            node,
            destructuringAgreements,
            kinds: ['repeated-parameter-read']
        });
        // Identifier cardinality reads are outside the member-access rule even
        // when their source agreement must retain every observable Get.
        const { kind: readKind = 0, expression: readReceiver = {}, name: readName = {} } = getObject(visited);
        const cardinalityRead = readKind === PropertyAccessExpression &&
            getObject(readReceiver).kind === Identifier && ['length', 'size'].includes(getObject(readName).text);
        const retainedRepeatedRead = getObject(repeatedReadAgreement).action === 'retain-source-phase-read' &&
            !cardinalityRead;
        const statement = isOrderedRead ? node : childOwner;
        const { kind: statementKind = 0 } = getObject(statement);
        const orderedOwner = orderedReadStatements.has(getConsumerContractKey(statement));
        const tupleArgumentOwner = tupleArgumentFacts.some(({ ifRange = '' } = {}) => (
            ifRange === getConsumerContractKey(statement)
        ));
        const annotate = (isOrderedProjection || isOrderedTuple || isOrderedRead ||
            retainedDeferredField || retainedRepeatedRead && !orderedOwner && !tupleArgumentOwner) && statementKind &&
            !annotatedStatements.has(statement);

        if (annotate) {
            annotatedStatements = new Set([...annotatedStatements, statement]);
            const projectionReason = isOrderedProjection
                ? 'projected method getter follows receiver method lookup'
                : 'retained tuple read preserves getter and operand order';
            const boundaryReason = [
                retainedDeferredField && 'deferred generic field Get follows earlier callback calls',
                isOrderedTuple && 'short-circuit and receiver method lookup precede this tuple read',
                isOrderedRead && 'separate tuple property Gets retain call argument timing',
                retainedRepeatedRead && 'repeated parameter Get retains each getter call at its source phase',
                projectionReason
            ].find(Boolean);

            rememberRetainedReason(statement, boundaryReason);
        }

        const retainedReason = getRetainedReason(node);
        const retained = retainedReason
            ? addBoundary(visited, retainedReason)
            : visited;
        const { kind = 0, body = {}, parameters = [], statements = [] } = getObject(retained);

        const hasScopedOperation = kind === Block && statements.some((statement) => {
            const { rules = [] } = getOperationBoundary(statement);

            return Boolean(rules.length);
        });

        if (hasScopedOperation) {
            const block = factory.createBlock(statements, true);

            return typescript.setTextRange(typescript.setOriginalNode(block, retained), retained);
        }

        const { reason: operationReason = '' } = operationBoundary;

        if (operationReason) return addOperationBoundary(retained, { ...operationBoundary, rules });

        const { reason: arrowReason = '' } = arrowBoundary;

        return arrowReason ? updateFunction({
            typescript, node: retained, parameters,
            body: factory.createBlock([addOperationBoundary(factory.createReturnStatement(body), { ...arrowBoundary, rules })], true)
        }) : retained;
    };

    return typescript.visitNode(sourceFile, visit);
};

// The exact rest-array agreement creates a numeric object binding because an
// array binding would acquire an iterator absent from the source indexed read.
// Later passes can rebuild that statement, so attach its narrow policy boundary
// only to the completed block in the final emitted tree.
const annotateRestArraySelectionBoundaries = ({
    typescript = {}, sourceFile = {}, destructuringAgreements = {}, context = {}
} = {}) => {
    const {
        VariableStatement = -1,
        ReturnStatement = -1, SingleLineCommentTrivia = -1
    } = getSyntaxKinds(typescript);
    const { addSyntheticLeadingComment = false, getSyntheticLeadingComments = false } = typescript;

    if (typeof addSyntheticLeadingComment !== 'function') return sourceFile;

    const annotateOrderedRead = ({ visited = {}, kind = 0 } = {}) => {
        if (![ReturnStatement, VariableStatement].includes(kind)) return;

        let orderedRead = false;
        let nestedReturn = false;
        const inspectOrderedRead = (child = {}) => {
            if (getObject(child).kind === ReturnStatement) nestedReturn = true;

            const { agreement: readAgreement = {} } = getDestructuringDecisionForNode({
                typescript,
                node: child,
                destructuringAgreements,
                kinds: ['rest-array-fixed-selection']
            });
            const { action: readAction = '' } = readAgreement;

            if (readAction === 'rest-array-retained-effect-order') orderedRead = true;

            typescript.forEachChild(child, inspectOrderedRead);
        };

        typescript.forEachChild(visited, inspectOrderedRead);

        if (!orderedRead || kind === VariableStatement && nestedReturn) return;

        const directive = 'eslint-disable-next-line resilient/prefer-destructured-member-access';
        const comments = typeof getSyntheticLeadingComments === 'function'
            ? getSyntheticLeadingComments(visited) || []
            : [];

        if (comments.some(({ text: comment = '' } = {}) => comment.includes(directive))) return;

        addSyntheticLeadingComment(
            visited,
            SingleLineCommentTrivia,
            ` ${directive} -- captured rest index follows a call; early binding changes call and failure order`,
            true
        );
    };
    const visitRestBoundary = (node = {}) => {
        const visited = typescript.visitEachChild(node, visitRestBoundary, context);
        const { kind = 0 } = getObject(visited);

        annotateOrderedRead({ visited, kind });

        return visited;
    };

    return typescript.visitNode(sourceFile, visitRestBoundary);
};

// Independent completed decisions can attach next-line comments to the same
// emitted node. Only the final comment reaches that node when printed. Combine
// that consecutive synthetic suffix without crossing authored or scoped trivia.
const groupNextLineExceptions = ({ typescript = {}, sourceFile = {}, context = {} } = {}) => {
    const { SingleLineCommentTrivia = -1, MultiLineCommentTrivia = -1 } = getSyntaxKinds(typescript);
    const { EmitFlags: { NoLeadingComments = 0 } = {} } = typescript;
    const directive = ({ kind = 0, text = '', hasTrailingNewLine = false } = {}) => {
        const [, names = '', reason = ''] = text.trim().replace(/\s*\n\s*/gu, ' ').match(/^\s*eslint-disable-next-line\s+([^\r\n]+?)\s+--\s+(\S[^\r\n]*)$/u) || [];
        const rules = names.split(',').map(name => name.trim());

        return [SingleLineCommentTrivia, MultiLineCommentTrivia].includes(kind) && hasTrailingNewLine && reason &&
            rules.every(name => /^@?[a-z0-9][a-z0-9_./-]*$/iu.test(name))
            ? { rules, reason: reason.trim() }
            : {};
    };
    const wrap = text => text.split(/ +/u).reduce((lines, word) => {
        const last = lines.at(-1) || '';

        return last.length + word.length < 160
            ? [...lines.slice(0, -1), `${last}${last ? ' ' : ''}${word}`]
            : [...lines, word];
    }, ['']).join('\n');
    const visit = (node) => {
        const visited = typescript.visitEachChild(node, visit, context);
        const lineSpan = typescript.isStatement(visited);
        const original = typescript.getOriginalNode(visited);
        const originalSource = typescript.getOriginalNode(sourceFile);
        const { text: authoredText = '' } = getObject(originalSource);
        const { pos = -1 } = getObject(original);
        const ranges = pos >= 0 ? typescript.getLeadingCommentRanges(authoredText, pos) || [] : [];
        const lastAuthored = ranges.at(-1);
        const { end: authoredEnd = -1, pos: authoredStart = -1 } = getObject(lastAuthored);
        const targetStart = pos >= 0 ? original.getStart(originalSource) : -1;
        const collision = typescript.isStatement(visited) && authoredEnd >= 0 && targetStart >= 0 &&
            originalSource.getLineAndCharacterOfPosition(authoredStart).line === originalSource.getLineAndCharacterOfPosition(authoredEnd).line &&
            /^\s*eslint-disable-next-line\b/u.test(authoredText.slice(authoredStart + 2, authoredEnd)) &&
            originalSource.getLineAndCharacterOfPosition(authoredEnd).line + 1
            === originalSource.getLineAndCharacterOfPosition(targetStart).line;
        const authored = collision ? ranges.map(({ kind = 0, pos: begin = 0, end = 0, hasTrailingNewLine = false }) => ({
            kind, pos: -1, end: -1, hasTrailingNewLine,
            text: authoredText.slice(begin + 2, end - (kind === MultiLineCommentTrivia ? 2 : 0))
        })) : [];
        const migrated = collision && typescript.getEmitFlags(visited) & NoLeadingComments;
        const rawComments = typescript.getSyntheticLeadingComments(visited) || [];
        const comments = migrated ? rawComments.filter(comment => !authored.some(prior => getObject(prior).kind === getObject(comment).kind && getObject(prior).text === getObject(comment).text))
            .map(comment => /^\s*eslint-disable-next-line\b/u.test(getObject(comment).text || '')
                ? { ...comment, kind: SingleLineCommentTrivia, hasTrailingNewLine: true,
                    text: getObject(comment).text.trim().replace(/\s*\n\s*/gu, ' ') } : comment) : rawComments;
        const parsed = comments.map(directive);
        const start = parsed.findLastIndex(({ reason = '' }) => !reason) + 1;

        if (comments.length === start) return visited;

        const [previous = {}] = parsed.slice(start);
        const { rules: previousRules = [], reason: previousReason = '' } = previous;
        // Reason echoes are already retained synthetic prose on this owner.
        // Leave that prose intact; only omit a repeated contribution whose
        // rules are already covered and whose reason is already represented.
        const preceding = comments.slice(0, start).map(({ text = '' } = {}) => directive({
            kind: SingleLineCommentTrivia, hasTrailingNewLine: true,
            text: ` eslint-disable-next-line ${text.trim().replace(/\s*\n\s*/gu, ' ')}`
        }));
        const represented = preceding.slice(preceding.findLastIndex(({ reason: prose = '' }) => !prose) + 1);
        const group = parsed.slice(start).filter(({ rules: names = [], reason = '' }, index) => (
            index === 0 || !represented.some(({ reason: prose = '' }) => prose) ||
            !names.every(name => previousRules.includes(name)) ||
            reason !== previousReason && !represented.some(({ rules: covered = [], reason: prose = '' }) => (
                prose === reason && names.every(name => covered.includes(name))
            ))
        ));
        const rules = [...new Set(group.flatMap(({ rules: names = [] }) => names))];
        const { rules: authoredNames = [] } = collision
            ? readDirectiveComment(authoredText.slice(authoredStart + 2, authoredEnd).replace(/\*\/$/u, '')) : {};
        const conflictingAuthored = collision && (!authoredNames.length || authoredNames.some(name => rules.includes(name)));
        const last = comments.at(-1);
        const { reason: explanation = '' } = getObject(group.at(-1));
        // Keep distinct explanations adjacent as rule-specific prose. Joining
        // them into one long reason can leave an overlong comment after ESLint
        // removes an unused directive. Only the final line is a directive.
        const notes = group.filter(({ reason = '' }) => reason !== explanation);
        const noteTexts = [...new Set(notes.map(({ rules: names = [], reason = '' }) => `${names.join(', ')} -- ${reason}`))]
            .filter(text => !comments.slice(0, start).some(({ text: existing = '' }) => existing.trim().replace(/\s*\n\s*/gu, ' ') === text));

        if (collision && (!conflictingAuthored || migrated)) {
            // Re-emit only leading trivia. Source trailing ranges stay on
            // this node. Both directives end before the same emitted line.
            const placed = typescript.setTextRange(typescript.factory.cloneNode(visited), visited);
            typescript.setEmitFlags(placed, typescript.getEmitFlags(visited) | NoLeadingComments);

            return typescript.setSyntheticLeadingComments(placed, [
                ...comments.slice(0, start),
                ...noteTexts.map(text => ({ ...last,
                    kind: text.length > 160 ? MultiLineCommentTrivia : SingleLineCommentTrivia,
                    text: text.length > 160 ? ` ${wrap(text)} ` : ` ${text}`, hasTrailingNewLine: true })),
                ...authored.slice(0, -1),
                { ...last, kind: MultiLineCommentTrivia, hasTrailingNewLine: false,
                    text: ` eslint-disable-next-line ${rules.join(', ')} --\n${wrap(explanation)}\n` },
                ...authored.slice(-1)
            ]);
        }

        const canonical = [
            ...comments.slice(0, start),
            ...noteTexts.map(text => ({ ...last,
                kind: text.length > 160 ? MultiLineCommentTrivia : SingleLineCommentTrivia,
                text: text.length > 160 ? ` ${wrap(text)} ` : ` ${text}`, hasTrailingNewLine: true })),
            { ...last, kind: lineSpan && rules.length === 1 && `eslint-disable-next-line ${rules.join(', ')} -- ${explanation}`.length > 180
                ? MultiLineCommentTrivia : SingleLineCommentTrivia, hasTrailingNewLine: true,
            text: lineSpan && rules.length === 1 && `eslint-disable-next-line ${rules.join(', ')} -- ${explanation}`.length > 180
                ? ` ${wrap(`eslint-disable-next-line ${rules.join(', ')} -- ${explanation}`)} `
                : ` eslint-disable-next-line ${rules.join(', ')} -- ${explanation}` }
        ];

        if (canonical.length === comments.length && canonical.every((comment, index) => (
            getObject(comment).text === getObject(comments.at(index)).text
        ))) return visited;

        return typescript.setSyntheticLeadingComments(
            typescript.setTextRange(typescript.factory.cloneNode(visited), visited), canonical
        );
    };

    return typescript.visitNode(sourceFile, visit);
};

export {
    annotateCyclicRuntimeBindingReferences,
    annotateCompletedLoopBoundaries,
    annotateRetainedDynamicMemberAccess,
    annotateRetainedStaticMemberAccess,
    annotateRestArraySelectionBoundaries,
    groupNextLineExceptions
};
