import { getObject } from '../../../rules/support/object.js';
import { getDestructuringDecisionForNode } from '../policy/destructuring-agreements.js';
import { getConsumerContractKey } from '../understand/type-evidence.js';

// Only the binding declaration moves. Every initializer stays at its original
// statement or loop phase, including failure before the assignment PutValue.
const lowerScopeEntryVarDeclarations = ({ typescript = {}, sourceFile = {},
    destructuringAgreements = {}, context = {} } = {}) => {
    const { factory = {}, SyntaxKind: {
        SourceFile = -1, Block = -1, VariableStatement = -1,
        ForStatement = -1, ForInStatement = -1, ForOfStatement = -1,
        StringLiteral = -1, SingleLineCommentTrivia = -1, ExpressionStatement = -1
    } = {}, NodeFlags: { Let = 0 } = {}, getOriginalNode = node => node } = typescript;
    const { byKind = new Map() } = getObject(destructuringAgreements);
    const decisions = byKind.get('declaration-lifetime') || [];
    const entryBindings = new Map();
    const entryPriorObservations = new Set(decisions
        .filter(({ agreement: { action = '' } = {}, contract: { hasPriorObservation = false } = {} } = {}) => action === 'lower-scope-entry-var-let' && hasPriorObservation)
        .map(({ contract: { entryAnchorRange = '' } = {} } = {}) => entryAnchorRange));
    const retainedWrites = new Set(decisions
        .filter(({ agreement: { action = '' } = {} } = {}) => action === 'lower-scope-entry-var-let')
        .flatMap(({ contract: { writeRanges = [] } = {} } = {}) => writeRanges));

    decisions.filter(({ agreement: { action = '' } = {} } = {}) => action === 'lower-scope-entry-var-let').forEach(({ contract = {} } = {}) => {
        const { entryAnchorRange = '', bindingSymbols = [], bindingNames = [], parameterSymbols = [] } = contract;
        const owned = entryBindings.get(entryAnchorRange) || new Map();

        bindingSymbols.forEach((symbol, index) => {
            if (symbol && !parameterSymbols.includes(symbol) && !owned.has(symbol)) {
                // eslint-disable-next-line resilient/prefer-safe-transformations, resilient/prefer-destructured-member-access -- The fresh owner-local binding map is built once before AST traversal.
                owned.set(symbol, bindingNames[index]);
            }
        });
        // eslint-disable-next-line resilient/prefer-safe-transformations -- The private entry map is built once before AST traversal.
        entryBindings.set(entryAnchorRange, owned);
    });

    const originalOf = node => typeof getOriginalNode === 'function' ? getOriginalNode(node) : node;
    const annotateAssignment = node => typescript.addSyntheticLeadingComment(node,
        SingleLineCommentTrivia,
        ' eslint-disable-next-line prefer-const -- Scope-entry let preserves var availability before source-position assignment.',
        true);
    const decisionOf = list => getDestructuringDecisionForNode({
        typescript, node: list, destructuringAgreements, kinds: ['declaration-lifetime']
    });
    const assignmentsOf = list => (getObject(list).declarations || []).flatMap((declaration) => {
        const { name = {}, initializer = false } = getObject(declaration);

        return initializer ? [factory.createAssignment(name, initializer)] : [];
    });
    const comma = (expressions) => {
        const [first = false] = expressions;

        if (expressions.length === 1) return first;

        return factory.createCommaListExpression(expressions);
    };
    const withEntry = (node, visited) => {
        const entryRange = getConsumerContractKey(originalOf(node));
        const names = entryBindings.get(entryRange);

        if (!names || !names.size) return visited;

        const statements = getObject(visited).statements || [];
        const directiveEnd = statements.findIndex(statement => getObject(statement).kind !== ExpressionStatement ||
            getObject(getObject(statement).expression).kind !== StringLiteral);
        const insertAt = directiveEnd < 0 ? statements.length : directiveEnd;
        const bindings = [...names.values()].map(name => factory.createVariableDeclaration(factory.createIdentifier(name)));
        const entry = factory.createVariableStatement(undefined,
            factory.createVariableDeclarationList(bindings, Let));
        const placedEntry = entryPriorObservations.has(entryRange) ? annotateAssignment(entry) : entry;
        const next = [...statements.slice(0, insertAt), placedEntry, ...statements.slice(insertAt)];

        return getObject(node).kind === SourceFile
            ? factory.updateSourceFile(visited, next)
            : factory.updateBlock(visited, next);
    };
    const containsWrite = (candidate) => {
        if (retainedWrites.has(getConsumerContractKey(originalOf(candidate)))) return true;

        let found = false;

        typescript.forEachChild(candidate, (child) => { found = found || containsWrite(child); });

        return found;
    };
    const lowerVariableStatement = (node, assignments) => {
        if (assignments.length) return annotateAssignment(factory.createExpressionStatement(comma(assignments)));

        const { kind: parentKind = 0 } = getObject(getObject(originalOf(node)).parent);

        if (![SourceFile, Block].includes(parentKind)) return factory.createEmptyStatement();

        // eslint-disable-next-line resilient/prefer-falsey-returns -- Removing a no-write declaration from a statement list preserves its completed scope-entry binding.
        return undefined;
    };
    const visit = (node) => {
        if (!node) return node;

        const { kind = 0, declarationList = {}, initializer = {} } = getObject(node);
        const visited = typescript.visitEachChild(node, visit, context);

        if ([SourceFile, Block].includes(kind)) return withEntry(node, visited);

        if (kind === ExpressionStatement && retainedWrites.size && containsWrite(originalOf(node)))
            return annotateAssignment(visited);

        let list = false;

        if (kind === VariableStatement) list = declarationList;

        if ([ForStatement, ForInStatement, ForOfStatement].includes(kind)) list = initializer;

        const { agreement: { action = '' } = {} } = list ? decisionOf(list) : {};

        if (action !== 'lower-scope-entry-var-let') return visited;

        const visitedList = kind === VariableStatement ? getObject(visited).declarationList
            : getObject(visited).initializer;
        const assignments = assignmentsOf(visitedList);

        if (kind === VariableStatement) return lowerVariableStatement(node, assignments);

        if (kind === ForStatement) {
            const lowered = factory.updateForStatement(visited,
                assignments.length ? comma(assignments) : undefined,
                getObject(visited).condition, getObject(visited).incrementor, getObject(visited).statement);

            return assignments.length ? annotateAssignment(lowered) : lowered;
        }

        const [declaration = {}] = getObject(visitedList).declarations || [];
        const { name: target = {} } = getObject(declaration);

        return kind === ForInStatement
            ? factory.updateForInStatement(visited, target, getObject(visited).expression,
                getObject(visited).statement)
            : factory.updateForOfStatement(visited, getObject(visited).awaitModifier, target,
                getObject(visited).expression, getObject(visited).statement);
    };

    return typescript.visitNode(sourceFile, visit);
};

export { lowerScopeEntryVarDeclarations };
