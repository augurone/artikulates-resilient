import { append, forget, put, retain } from '../../../analysis/collections.js';
import { isFunction } from '../../../analysis/host/function.js';
import { getObject } from '../../../analysis/host/object.js';
import { getSourceRange, getSyntaxKinds, wrapExpressionArrowBody } from '../../utils/ast-boundary.js';
import { getDestructuringDecisionForNode } from '../policy/destructuring-agreements.js';
import { createAuthoredRuleScope } from '../policy/exceptions.js';
import { getPlacementSymbol, getExactUndefinedReason } from '../policy/placement.js';
import { getLiteralRuntimeKind } from '../understand/type-resolution.js';

// The source overload owns an arity-indexed return contract. Keep the one
// authored declaration intact and explain the exact analyzer boundary there.
const annotateCompletedReturnBoundaries = ({
    typescript = {}, sourceFile = {}, destructuringAgreements = {}, placement = {}, context = {}
} = {}) => {
    const { VariableStatement = -1, FunctionDeclaration = -1, IfStatement = -1,
        ReturnStatement = -1, ConditionalExpression = -1, ArrowFunction = -1,
        MultiLineCommentTrivia = -1, SingleLineCommentTrivia = -1, FunctionExpression = -1, Block = -1,
        ParenthesizedExpression = -1, AsExpression = -1, TypeAssertionExpression = -1,
        NonNullExpression = -1, SatisfiesExpression = -1, LiteralType = -1, ArrayLiteralExpression = -1,
        ObjectLiteralExpression = -1, NullKeyword = -1, VoidExpression = -1, TypeOfExpression = -1,
        CallExpression = -1, Identifier = -1, VariableDeclaration = -1, BinaryExpression = -1,
        FirstAssignment = -1, LastAssignment = -1, PrefixUnaryExpression = -1, PostfixUnaryExpression = -1,
        PlusPlusToken = -1, MinusMinusToken = -1 } = getSyntaxKinds(typescript);
    const { addSyntheticLeadingComment, addSyntheticTrailingComment } = typescript;
    const { partitions = new Map(), switchReturns = new Map() } = destructuringAgreements;
    const { exactUndefined = new Set() } = placement;

    if ((!partitions.size && !switchReturns.size && !exactUndefined.size) || !isFunction(addSyntheticLeadingComment) ||
        !isFunction(addSyntheticTrailingComment)) return sourceFile;

    // Only local source-owned function results survive this check. Index once;
    // imported/callback calls and generated aliases remain unknown.
    const functions = [ArrowFunction, FunctionExpression, FunctionDeclaration];
    const transparent = new Set([ParenthesizedExpression, AsExpression, TypeAssertionExpression,
        NonNullExpression, SatisfiesExpression]);
    const bindings = new Map();
    const writes = new Set();
    const index = (node = {}) => {
        const { kind = 0, name = {}, body = false, left = {}, operand = {}, operatorToken = {}, operator = -1 } = getObject(node);
        const { kind: operatorKind = -1 } = getObject(operatorToken);
        const assignment = kind === BinaryExpression && operatorKind >= FirstAssignment && operatorKind <= LastAssignment;
        const update = [PrefixUnaryExpression, PostfixUnaryExpression].includes(kind) && [PlusPlusToken, MinusMinusToken].includes(operator);
        const bindingSymbol = [VariableDeclaration, FunctionDeclaration].includes(kind) && (kind !== FunctionDeclaration || body)
            ? getPlacementSymbol({ typescript, node: name, placement }) : false;
        const writeSymbol = assignment || update
            ? getPlacementSymbol({ typescript, node: assignment ? left : operand, placement }) : false;

        if (bindingSymbol) put(bindings, bindingSymbol, node);

        if (writeSymbol) retain(writes, writeSymbol);

        typescript.forEachChild(node, index);
    };
    index(sourceFile);
    const returned = new WeakMap();
    const returnsOf = (owner = {}) => {
        if (returned.has(owner)) return returned.get(owner);

        const found = [];
        const visitReturn = (node = {}) => {
            const { kind = 0 } = getObject(node);

            if (functions.includes(kind)) return;

            if (kind === ReturnStatement) {
                append(found, node);

                return;
            }

            typescript.forEachChild(node, visitReturn);
        };
        visitReturn(getObject(owner).body);
        put(returned, owner, found);

        return found;
    };
    const returnValues = (owner = {}) => {
        const { body = {} } = getObject(owner);

        return getObject(body).kind === Block
            ? returnsOf(owner).map(({ expression = {} } = {}) => expression) : [body];
    };
    const bindingTarget = (reference = {}) => {
        const symbol = getObject(reference).kind === Identifier
            ? getPlacementSymbol({ typescript, node: reference, placement }) : false;
        const binding = bindings.get(symbol) || {};
        const { kind = 0, initializer = {} } = getObject(binding);

        if (writes.has(symbol)) return {};

        return kind === VariableDeclaration ? initializer : binding;
    };
    const active = new Set();
    const callableMemo = new WeakMap();
    const familyMemo = new WeakMap();
    let cycle = 0;
    const complete = parts => parts.every(part => part.length) ? [...new Set(parts.flat())] : [];
    const through = (memo, node, read) => {
        if (memo.has(node)) return memo.get(node);

        if (active.has(node)) {
            cycle += 1;

            return [];
        }

        const before = cycle;

        retain(active, node);

        try {
            const result = read();

            return before === cycle ? put(memo, node, result) : [];
        } finally {
            forget(active, node);
        }
    };
    const callableResults = (node = {}) => through(callableMemo, node, () => {
        const { kind = 0, expression = {}, whenTrue = {}, whenFalse = {} } = getObject(node);

        if (functions.includes(kind)) return [node];

        if (transparent.has(kind)) return callableResults(expression);

        if (kind === ConditionalExpression) return complete([whenTrue, whenFalse].map(callableResults));

        if (kind === CallExpression) return complete(callableResults(expression).map(owner => complete(returnValues(owner).map(callableResults))));

        return kind === Identifier ? callableResults(bindingTarget(node)) : [];
    });
    const valueKinds = (node = {}) => through(familyMemo, node, () => {
        const { kind = 0, expression = {}, whenTrue = {}, whenFalse = {} } = getObject(node);

        if (functions.includes(kind)) return ['function'];

        if (transparent.has(kind)) return valueKinds(expression);

        if (kind === ConditionalExpression) return complete([whenTrue, whenFalse].map(valueKinds));

        const literal = getLiteralRuntimeKind({ typescript, node: { kind: LiteralType, literal: node } });

        if (literal) return [literal];

        if (kind === ArrayLiteralExpression) return ['array'];

        if (kind === ObjectLiteralExpression || kind === NullKeyword) return [kind === NullKeyword ? 'null' : 'object'];

        if (kind === VoidExpression) return ['undefined'];

        if (kind === TypeOfExpression) return ['string'];

        if (kind === CallExpression) return complete(callableResults(expression).map(owner => complete(returnValues(owner).map(valueKinds))));

        return kind === Identifier ? valueKinds(bindingTarget(node)) : [];
    });
    const returnKinds = (owner = {}, readValue = () => []) => returnValues(owner).flatMap(readValue);
    const hasReturnContradiction = (owner = {}, noValueExit = false) => {
        let found = false;
        const visitFunction = (node = {}) => {
            const families = functions.includes(getObject(node).kind) ? returnKinds(node, valueKinds) : [];
            const { body = {} } = getObject(node);
            const exits = noValueExit && getObject(body).kind === Block ? ['undefined'] : [];

            found ||= new Set([...families, ...exits]).size > 1;

            typescript.forEachChild(node, visitFunction);
        };
        visitFunction(owner);

        return found;
    };
    const annotateArityReturns = (owner = {}, { selectorRange = '' } = {}) => {
        let selector = false;
        const findSelector = (node) => {
            if (selector) return;

            if (functions.includes(getObject(node).kind) && getSourceRange({ typescript, node }) === selectorRange) {
                selector = node;

                return;
            }

            typescript.forEachChild(node, findSelector);
        };
        findSelector(owner);

        if (!selector) return owner;

        const families = new Set(returnKinds(selector, valueKinds));

        if (!families.has('function') || families.size !== 2) return owner;

        const ownReturns = new Set(returnsOf(selector));
        const annotate = (node) => {
            if (node !== owner && functions.includes(getObject(node).kind) && node !== selector) return node;

            const visited = typescript.visitEachChild(node, annotate, context);

            if (!ownReturns.has(node) || !valueKinds(getObject(node).expression).length) return visited;

            const cloned = typescript.setOriginalNode(typescript.factory.cloneNode(visited), typescript.getOriginalNode(node));

            return addSyntheticLeadingComment(cloned, SingleLineCommentTrivia,
                ' eslint-disable-next-line resilient/signature-contract-return-consistency -- Arity selects callable or value.', true);
        };

        return annotate(owner);
    };
    const authoredRules = createAuthoredRuleScope({ typescript, sourceFile, lineDirectives: true });
    const getSelectorAgreement = (test = {}) => {
        const { agreement = {} } = getDestructuringDecisionForNode({
            typescript,
            node: test,
            destructuringAgreements,
            kinds: ['arity-return-selector']
        });

        return getObject(agreement).action === 'retain-exact-undefined-selector'
            ? 'Only undefined selects partial application.'
            : getExactUndefinedReason({ typescript, node: test, placement });
    };
    const visit = (node = {}) => {
        const { kind: sourceKind = 0, body = {} } = getObject(node);
        const { kind: bodyKind = 0, condition: bodyCondition = {} } = getObject(body);
        const arrowSelector = bodyKind === ConditionalExpression ? bodyCondition : body;
        const prepared = sourceKind === ArrowFunction && getSelectorAgreement(arrowSelector)
            ? wrapExpressionArrowBody({ typescript, node }) : node;
        const visited = typescript.visitEachChild(prepared, visit, context);
        const { kind = 0, name = {}, declarationList = {} } = getObject(visited);
        const original = typescript.getOriginalNode(node);
        const { parent = {} } = getObject(original);
        const { kind: parentKind = 0, parent: enclosing = {} } = getObject(parent);
        const { kind: enclosingKind = 0 } = getObject(enclosing);
        const statementSelector = [IfStatement, ReturnStatement].includes(parentKind) ||
            parentKind === ConditionalExpression && [ReturnStatement, ArrowFunction].includes(enclosingKind);
        const nestedReason = kind === BinaryExpression && !statementSelector ? getSelectorAgreement(node) : '';

        if (nestedReason && !authoredRules(node, ['resilient/no-undefined-comparison']).has('resilient/no-undefined-comparison')) {
            // Bound only the existing source comparison. Callee/argument Gets,
            // sibling comparisons and authored directive scopes remain outside.
            const scoped = typescript.factory.createParenthesizedExpression(visited);
            addSyntheticLeadingComment(visited, MultiLineCommentTrivia,
                ` eslint-disable resilient/no-undefined-comparison -- ${nestedReason} `, true);
            addSyntheticTrailingComment(visited, MultiLineCommentTrivia,
                ' eslint-enable resilient/no-undefined-comparison ', true);

            return scoped;
        }

        const annotateSelector = (statement = {}, reason = '') => addSyntheticLeadingComment(
            statement,
            SingleLineCommentTrivia,
            ` eslint-disable-next-line resilient/no-undefined-comparison -- ${reason}`,
            true
        );

        if (kind === IfStatement) {
            const reason = getSelectorAgreement(getObject(visited).expression);

            return reason ? annotateSelector(visited, reason) : visited;
        }

        const { expression: returnedExpression = {} } = getObject(visited);
        const { kind: returnedKind = 0, condition = {} } = getObject(returnedExpression);

        const returnedReason = kind === ReturnStatement
            ? getSelectorAgreement(returnedKind === ConditionalExpression ? condition : returnedExpression) : '';

        if (returnedReason) {
            return annotateSelector(visited, returnedReason);
        }

        const { declarations = [] } = getObject(declarationList);
        const [declaration = {}] = declarations;
        const declarationName = kind === FunctionDeclaration
            ? getObject(name).text || ''
            : getObject(getObject(declaration).name).text || '';
        const { agreement = {}, contract: arityContract = {} } = getDestructuringDecisionForNode({
            typescript, node, destructuringAgreements, kinds: ['arity-return-partition']
        });
        const { agreement: switchAgreement = {}, exitKind = '' } = getObject(switchReturns.get(declarationName));

        if (![VariableStatement, FunctionDeclaration].includes(kind) || declarations.length > 1) return visited;

        const { action = '' } = getObject(agreement);
        const isArity = action === 'retain-arity-return-partition';
        const isSwitch = getObject(switchAgreement).action === 'retain-switch-no-value-exit';

        if (isArity) return annotateArityReturns(visited, arityContract);

        if (!isSwitch) return visited;

        const { rules: requestedRules = [] } = isArity ? agreement : switchAgreement;
        const rules = requestedRules.filter(rule => rule !== 'resilient/signature-contract-return-consistency' ||
            hasReturnContradiction(visited, isSwitch));

        if (!rules.length) return visited;

        const rule = rules.join(', ');
        let reason = 'Arity selects callable or value.';

        if (isSwitch && exitKind === 'explicit-bare-return') {
            reason = 'Unsupported selector retains the source no-value exit.';
        }

        if (isSwitch && exitKind !== 'explicit-bare-return') {
            reason = 'Unrecognized tag retains native fallthrough.';
        }

        const withDisable = addSyntheticLeadingComment(
            visited,
            MultiLineCommentTrivia,
            ` eslint-disable ${rule} -- ${reason} `,
            true
        );

        return addSyntheticTrailingComment(
            withDisable,
            MultiLineCommentTrivia,
            ` eslint-enable ${rule} `,
            true
        );
    };

    return typescript.visitNode(sourceFile, visit);
};

export { annotateCompletedReturnBoundaries };
