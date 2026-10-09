import assert from 'node:assert/strict';
import fs from 'node:fs';
import { runInNewContext } from 'node:vm';

import { Linter } from 'eslint';
import typescript from 'typescript';

import resilient from 'eslint-plugin-resilient';

import { hasArrayContent, isArray } from '../rules/support/array.js';
import { getObject } from '../rules/support/object.js';
import { getExceptionInventory } from '../scripts/audit-eslint-exceptions.js';
import { getMemberBindingPattern } from '../transforms/typescript/grammar/member-access.js';
import { formatResilientOutput } from '../transforms/typescript/grammar/resolvers.js';
import { lowerGuardedConditionalReturns } from '../transforms/typescript/lowering/guarded-returns.js';
import { lowerTupleConsumerBindings } from '../transforms/typescript/members/tuple-consumers.js';
import { compileDestructuringDecisions } from '../transforms/typescript/policy/decision-store.js';
import { annotateAgreementException, getDefaultInitializer, getMemberParameterDefault } from '../transforms/typescript/policy/defaults.js';
import { getConsumerContractKey } from '../transforms/typescript/understand/type-evidence.js';

const parse = (code = '') => typescript.createSourceFile('mechanism.ts', code, typescript.ScriptTarget.ESNext, true);
const read = (file = '') => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const missing = (...args) => { throw new Error(`Missing mechanism proof capability: ${args.length}`); };
const descendants = (node = {}) => {
    let children = [];
    typescript.forEachChild(node, (child) => { children = [...children, ...descendants(child)]; });

    return [node, ...children];
};
const initializerText = ({ source = '', name = '', occurrence = 0 } = {}) => {
    const tree = parse(source);
    const declarations = descendants(tree).filter(node => typescript.isVariableDeclaration(node) && node.name.getText(tree) === name);
    const [{ initializer = {} } = {}] = declarations.slice(occurrence, occurrence + 1);
    assert.ok(typescript.isArrowFunction(initializer), name);

    return initializer.getText(tree);
};
const instantiate = ({ source = '', name = '', context = {} } = {}) => runInNewContext(
    `(${initializerText({ source, name })})`, { ...typescript.SyntaxKind, typescript, getObject, ...context }
);
const load = ({ source = '', file = '' } = {}) => {
    const url = new URL(`../${file}`, import.meta.url);
    const rebased = source.replace(/from '([^']+)'/gu, (match, relative) => `from ${JSON.stringify(new URL(relative, url).href)}`);

    return import(`data:text/javascript;base64,${Buffer.from(rebased).toString('base64')}`);
};
const print = (node = {}, root = parse('')) => typescript.createPrinter().printNode(typescript.EmitHint.Unspecified, node, root);
const layoutOnlySource = [
    "var literal = '(value) => value';",
    'const template = `return payload`;',
    'const expression = value => value;',
    ''
].join('\n');
const layoutOnlyOutput = formatResilientOutput(layoutOnlySource, typescript);

assert.match(layoutOnlyOutput, /var literal = '\(value\) => value';/);
assert.match(layoutOnlyOutput, /const template = `return payload`;/);
assert.match(layoutOnlyOutput, /const expression = value => value;/);
const guardedFile = 'transforms/typescript/lowering/guarded-returns.js';
const guardedSource = read(guardedFile);
const previousGuarded = guardedSource.replace('if (valueKind !== CallExpression) return false;',
    'if (valueKind !== CallExpression) return undefined;').replace('if (!branchElements.length) return false;',
    'if (!branchElements.length) return undefined;');
const { lowerGuardedConditionalReturns: previousLower = false } = await load({ source: previousGuarded, file: guardedFile });

// Actual private candidate owner: same object identity, Get order, unwrapping,
// argument short-circuit and failure. Only the explicit rejected result changes.
const unwrap = (node) => {
    const { kind = 0, expression = false } = getObject(node);

    return kind === typescript.SyntaxKind.ParenthesizedExpression ? unwrap(expression) : node;
};
const [previousCandidate = false, candidate = false] = [previousGuarded, guardedSource].map(source => instantiate({
    source, name: 'getConditionalArgument', context: { unwrap }
}));
const { statements: [{ declarationList: { declarations: [{ initializer: conditional = {} } = {}] = [] } = {} } = {}] = [] }
    = parse('const v = ok ? yes : no;');
const wrapped = typescript.factory.createParenthesizedExpression(conditional);
[conditional, { kind: typescript.SyntaxKind.CallExpression, arguments: [wrapped] }].forEach((value) => {
    assert.equal(candidate(value), previousCandidate(value));
});
assert.equal(candidate({}), false);
assert.equal(Boolean(previousCandidate({})), false);
assert.equal(candidate({ kind: typescript.SyntaxKind.CallExpression }), previousCandidate({ kind: typescript.SyntaxKind.CallExpression }));
const failure = new Error('metadata/factory');
['kind', 'arguments'].forEach((field) => {
    const observe = (owner = false) => {
        let events = [];
        const value = new Proxy({}, { get(target, key) {
            events = [...events, String(key)];

            if (key === field) throw failure;

            return Reflect.get(target, key);
        } });
        assert.throws(() => owner(value), error => error === failure);

        return events;
    };
    assert.deepEqual(observe(candidate), observe(previousCandidate));
});
const poison = { get kind() { throw failure; } };
assert.equal(candidate({ kind: typescript.SyntaxKind.CallExpression, arguments: [conditional, poison] }), conditional,
    'find must not examine arguments after the first conditional.');
const emptyBranch = instantiate({ source: guardedSource, name: 'createStatement' });
assert.equal(emptyBranch([]), false, 'No compiler construction on the empty branch.');

// Full owner consumes those outcomes solely as unwrapping/truthiness and array
// inclusion, not as a compiler field. Preserve both empty and used bindings.
const fixtures = [
    'function read(value) { const { x } = value; return isObject(value) ? x : 0; }',
    'function read(value) { const { x } = value; return isObject(value) ? 1 : 0; }',
    'function read(value) { const { x } = value; return use(isObject(value) ? x : 0); }',
    'function read(value) { const { x } = value; return x; }'
];
fixtures.forEach((code, index) => {
    const lower = (owner = missing) => {
        const root = parse(code);
        const result = typescript.transform(root, [context => tree => owner({ typescript, sourceFile: tree, context })]);
        const { transformed: [tree = {}] = [] } = result;
        const output = print(tree, root);
        result.dispose();

        return output;
    };
    const next = lower(lowerGuardedConditionalReturns);
    assert.equal(next, lower(previousLower));

    if (index === 0) assert.ok(next.includes('if (isObject(value)) {\n    const { x } = value;'));

    if (index === 1) assert.ok(next.includes('if (isObject(value)) {\n    return 1;'));
});

// Four true omitted fields: actual helper/consumer owners, not an invented
// generic absence adapter. False is an invalid compiler node, not omission.
['', 'function', 'unknown', 'not-a-canonical'].forEach((canonical) => {
    assert.equal(getDefaultInitializer({ canonical }), undefined);
});
["''", '0', 'false', '0n', '[]', '{}', 'undefined'].forEach((canonical) => {
    const initializer = getDefaultInitializer({ factory: typescript.factory, canonical, singleQuote: true });
    assert.ok(print(initializer));
});
const existing = typescript.factory.createIdentifier('existing');
assert.equal(getMemberParameterDefault({ initializer: existing, members: [{ get canonical() { throw failure; } }] }), existing);
[[], [{ canonical: '[]' }], [{ canonical: '0', guarded: true }], [{ canonical: '0', kind: 'array' }]].forEach((members) => {
    const initializer = getMemberParameterDefault({ factory: typescript.factory, members });
    assert.equal(initializer, undefined);
    const parameter = Reflect.apply(typescript.factory.createParameterDeclaration, typescript.factory,
        [undefined, undefined, 'value', undefined, undefined, initializer]);
    assert.equal(Reflect.get(parameter, 'initializer'), undefined);
    assert.equal(print(parameter), 'value');
});
assert.equal(print(getObject(getMemberParameterDefault({ factory: typescript.factory, members: [{ canonical: '0' }] }))), '{}');
const residualSource = read('transforms/typescript/members/residual.js');
const absentDefault = instantiate({ source: residualSource, name: 'getDefault', context: {
    getPlacementFact: () => ({}), getTypeText: () => '', declarations: {}, placement: {}, sourceFile: {}, getDefaultInitializer
} });
assert.equal(absentDefault(), undefined);
const residualPattern = instantiate({ source: residualSource, name: 'getPattern', context: {
    factory: typescript.factory, sourceFile: {}, placement: {}, declarations: {},
    getStaticIndex: ({ argument = {} } = {}) => Number(getObject(argument).text),
    getPlacementFact: () => ({}), isPlacementArray: () => false,
    getPlacementContract: () => ({}), getTypeText: () => '', getPlacementReason: () => '', getDefault: absentDefault
} });
const arrayPattern = residualPattern({ segment: { kind: 'element', argument: { text: '1' } }, alias: 'value', indexedContainer: true });
assert.equal(print(arrayPattern), '[, value]');
const { elements: [, arrayElement = {}] = [] } = arrayPattern;
assert.equal(Reflect.get(arrayElement, 'propertyName'), undefined);
assert.equal(Reflect.get(arrayElement, 'initializer'), undefined);
assert.equal(print(residualPattern({ segment: { kind: 'property', name: 'field' }, alias: 'value' })), '{ field: value }');
assert.equal(print(residualPattern({ segment: { kind: 'element', argument: { text: '1' } }, argument: existing, alias: 'value' })), '{ [existing]: value }');
assert.throws(() => getDefaultInitializer({
    factory: { ...typescript.factory, createObjectLiteralExpression: () => { throw failure; } }, canonical: '{}'
}), error => error === failure);

// Complete tuple owner prior/current: staging is one map product. Reservations
// still precede all sibling names; parent emission precedes child recursion.
const tupleFile = 'transforms/typescript/members/tuple-consumers.js';
const tupleSource = read(tupleFile);
const previousTuple = tupleSource.replace('const stagedElements = currentElements.map', 'const nested = [];\n        const rewrittenElements = currentElements.map')
    .replace('return { element: markGuardedNode(element) };', 'return markGuardedNode(element);')
    .replace(/return \{\s*element: markGuardedNode\((factory\.updateBindingElement\([\s\S]*?\))\),\s*nested: \[\{ pattern: name, source: containerIdentifier \}\]\s*\};/u,
        'nested.push({ pattern: name, source: containerIdentifier });\n            return markGuardedNode($1);')
    .replace(/factory\.updateArrayBindingPattern\(\s*currentPattern,\s*stagedElements\.map\(\(\{ element = \{\} \} = \{\}\) => element\)\s*\)/u,
        'factory.updateArrayBindingPattern(currentPattern, rewrittenElements)')
    .replace(['stagedElements.forEach(({ nested = [] } = {}) => nested.forEach(({',
        '            pattern: nestedPattern = {}, source: nestedSource = {}',
        '        } = {}) => lowerPattern(nestedPattern, nestedSource)));'].join('\n'),
    'nested.forEach(({ pattern: nestedPattern = {}, source: nestedSource = {} } = {}) => {\n            lowerPattern(nestedPattern, nestedSource);\n        });');
assert.ok(previousTuple.includes('nested.push'));
assert.ok(!previousTuple.includes('stagedElements'));
const { lowerTupleConsumerBindings: previousTupleLower = false } = await load({ source: previousTuple, file: tupleFile });
const tupleCode = 'function read([[a], [b, [c]]]) { return [a, b, c]; }';
const observeTuple = ({ owner = missing, failedMethod = '', rejected = false, reservedNames = new Set() } = {}) => {
    const root = parse(rejected ? 'function read([a, ...rest]) { return [a]; }' : tupleCode);
    const { statements: [node = {}] = [] } = root;
    const methods = ['createIdentifier', 'updateBindingElement', 'updateArrayBindingPattern', 'createIfStatement',
        'createVariableStatement', 'createParameterDeclaration', 'updateFunctionDeclaration'];
    let events = [];
    let bindings = [];
    const factory = { ...typescript.factory, ...Object.fromEntries(methods.map(method => [method, (...args) => {
        events = [...events, [method, args.map(argument => typeof argument === 'object' && argument
            ? Reflect.get(argument, 'pos') : argument)]];

        if (method === 'updateBindingElement') bindings = [...bindings, args];

        if (method === failedMethod) throw failure;

        return Reflect.apply(Reflect.get(typescript.factory, method), typescript.factory, args);
    }])) };
    const agreements = new Set();
    const destructuringAgreements = new Map([[getConsumerContractKey(node), [{ kind: 'consumer', contract: {
        consumer: 'tuple-function', tuple: { required: true, arity: 2, containers: [{ arity: 2 }] },
        positions: [], resolver: { state: 'resolved', action: 'direct', canonical: '[]' }
    } }]]]);
    let outcome;
    try {
        const result = owner({ typescript: { ...typescript, factory }, node, reservedNames, destructuringAgreements: compileDestructuringDecisions(destructuringAgreements), agreements });
        outcome = rejected ? result === node : print(result, root);
    } catch (error) { assert.equal(error, failure); outcome = 'exact failure'; }
    bindings.forEach((args = []) => {
        const [element = {}, , , identifier = {}] = args;
        const token = Reflect.get(args, '1');
        const property = Reflect.get(args, '2');
        const initializer = Reflect.get(args, '4');
        assert.equal(token, undefined);
        assert.equal(property, undefined);
        assert.equal(initializer, undefined);
        assert.equal(typescript.getOriginalNode(typescript.factory.updateBindingElement(element, token, property, identifier, initializer)), element);
    });

    return { events, outcome, agreements: [...agreements] };
};
['', 'createIdentifier', 'updateBindingElement', 'updateArrayBindingPattern', 'createIfStatement',
    'createVariableStatement', 'createParameterDeclaration', 'updateFunctionDeclaration'].forEach((failedMethod) => {
    [new Set(), new Set(['tuple', '_resilientTuplePart'])].forEach((reservedNames) => {
        assert.deepEqual(observeTuple({ owner: lowerTupleConsumerBindings, failedMethod, reservedNames }),
            observeTuple({ owner: previousTupleLower, failedMethod, reservedNames }));
    });
});
assert.equal(observeTuple({ owner: lowerTupleConsumerBindings, rejected: true }).outcome, true);
const { outcome: tupleOutput = '' } = observeTuple({ owner: lowerTupleConsumerBindings });
assert.ok(tupleOutput.indexOf('_resilientTuplePart2') < tupleOutput.indexOf('_resilientTuplePart3'));
const { outcome: previousTupleOutput = '' } = observeTuple({ owner: previousTupleLower });
[false, true].forEach((abrupt) => {
    const evaluate = (code = '') => {
        let events = [];
        const leaf = { [Symbol.iterator]: () => {
            events = [...events, 'leaf iterator'];

            if (abrupt) throw failure;

            return [3][Symbol.iterator]();
        }, length: 1 };
        const input = [[1], [2, leaf]];
        // The declared nested container is a tuple: an array with a hostile
        // iterator, not an object that should fail the array guard first.
        const nestedArray = [3];
        Object.defineProperty(nestedArray, Symbol.iterator, { value: Reflect.get(leaf, Symbol.iterator) });
        Object.defineProperty(input, '1', { get() { events = [...events, 'second sibling'];

            return [2, nestedArray]; } });
        let result;
        try { result = [...runInNewContext(`${code}\nread(input);`, { input, hasArrayContent, isArray })]; }
        catch (error) { assert.equal(error, failure); result = ['exact failure']; }

        return { events, result };
    };
    assert.deepEqual(evaluate(tupleOutput), evaluate(previousTupleOutput));
    assert.deepEqual(evaluate(tupleOutput).result, abrupt ? ['exact failure'] : [1, 2, 3]);
});
const { lowerTupleConsumerBindings: copiedReservations = missing } = await load({ file: tupleFile,
    source: tupleSource.replace('occupied.add(containerName);', 'new Set([...occupied, containerName]);') });
const { outcome: collisionOutput = '' } = observeTuple({ owner: copiedReservations });
assert.notEqual(collisionOutput, tupleOutput, 'A nonpublishing Set copy loses sibling and recursive reservations.');
assert.ok(collisionOutput.includes('const [_resilientTuplePart, _resilientTuplePart]'));

// False may print like omission, but does not preserve compiler update identity.
// A printer-only test would miss this shortcut's changed AST/provenance.
const falseBinding = Reflect.apply(typescript.factory.createBindingElement, typescript.factory,
    [undefined, undefined, 'value', false]);
assert.equal(Reflect.get(falseBinding, 'initializer'), false);
const omittedBinding = typescript.factory.createBindingElement(undefined, undefined, 'value', undefined);
assert.equal(typescript.factory.updateBindingElement(omittedBinding, undefined, undefined, Reflect.get(omittedBinding, 'name'), undefined), omittedBinding);
const changedBinding = Reflect.apply(typescript.factory.updateBindingElement, typescript.factory,
    [omittedBinding, undefined, undefined, Reflect.get(omittedBinding, 'name'), false]);
assert.notEqual(changedBinding, omittedBinding);
assert.equal(typescript.getOriginalNode(changedBinding), omittedBinding);
assert.equal(print(changedBinding), print(omittedBinding));
const falseParameter = Reflect.apply(typescript.factory.createParameterDeclaration, typescript.factory,
    [undefined, undefined, 'value', undefined, undefined, false]);
assert.equal(Reflect.get(falseParameter, 'initializer'), false);
const omittedParameter = typescript.factory.createParameterDeclaration(undefined, undefined, 'value', undefined, undefined, undefined);
const parameterName = Reflect.get(omittedParameter, 'name');
assert.equal(typescript.factory.updateParameterDeclaration(omittedParameter, undefined, undefined, parameterName,
    undefined, undefined, undefined), omittedParameter);
assert.notEqual(Reflect.apply(typescript.factory.updateParameterDeclaration, typescript.factory,
    [omittedParameter, undefined, undefined, parameterName, undefined, undefined, false]), omittedParameter);

// Previously uncrossed noncanonical generic template: actual owner and shared
// binding grammar, exact arrow placement/rule/reason, guarded scope and native
// missing-container failure. Canonical undefined must NOT select this boundary.
const genericSource = read('transforms/typescript/members/generic.js');
const scoped = instantiate({ source: genericSource, name: 'getScopedParameterExpression', context: {
    nodeParams: [typescript.factory.createParameterDeclaration(undefined, undefined, 'input')],
    factory: typescript.factory, getMemberBindingPattern, EqualsGreaterThanTokenKind5: typescript.SyntaxKind.EqualsGreaterThanToken,
    SingleLineCommentTrivia: typescript.SyntaxKind.SingleLineCommentTrivia,
    addSyntheticLeadingComment: typescript.addSyntheticLeadingComment
} });
const genericReason = ' eslint-disable-next-line resilient/prefer-safe-destructuring-defaults -- Generic member selection preserves the source missing-container failure.';
['', 'undefined', '0'].forEach((canonical) => {
    const expression = scoped({ expression: typescript.factory.createIdentifier('selected'), groups: [
        { objectName: 'input', members: [{ propertyName: 'value', alias: 'selected', kind: 'generic', canonical }] }
    ] });
    const { expression: { expression: arrow = {} } = {} } = expression;
    const comments = typescript.getSyntheticLeadingComments(arrow) || [];
    assert.deepEqual(comments.map(({ text = '' } = {}) => text), canonical ? [] : [genericReason]);
    const code = print(expression);

    if (!canonical) {
        const selected = {};
        assert.equal(runInNewContext(code, { input: { value: selected } }), selected);
        assert.throws(() => runInNewContext(code, { input: null }), { name: 'TypeError' });
        assert.equal(runInNewContext(`false ? ${code} : 'skipped'`, { input: null }), 'skipped');
    }
});
const target = typescript.factory.createIdentifier('value');
assert.equal(annotateAgreementException({ typescript, node: target }), target);
assert.equal(annotateAgreementException({ node: target, reason: 'boundary' }), target);
const annotated = annotateAgreementException({ typescript, node: target, reason: 'boundary' });
assert.equal(annotated, target);
assert.deepEqual((typescript.getSyntheticLeadingComments(target) || []).map(({ text = '' } = {}) => text),
    [' eslint-disable-next-line resilient/prefer-safe-destructuring-defaults -- boundary']);

const linter = new Linter();
const necessities = [
    ['transforms/typescript/members/residual.js', 'Result enters the binding', 'resilient/prefer-falsey-returns'],
    ['transforms/typescript/members/residual.js', 'Static array binding', 'resilient/prefer-falsey-returns'],
    ['transforms/typescript/policy/defaults.js', 'Unknown canonical form', 'resilient/prefer-falsey-returns'],
    ['transforms/typescript/policy/defaults.js', 'Rejected aggregate default', 'resilient/prefer-falsey-returns'],
    [tupleFile, 'Shared lexical reservations', 'resilient/prefer-safe-transformations']
];
necessities.forEach(([file = '', reason = '', rule = ''] = []) => {
    const source = read(file);
    const { entries = [] } = getExceptionInventory({ source, file });
    const [entry = {}] = entries.filter(({ reason: text = '' } = {}) => text.startsWith(reason));
    const { range = [], location: { line: commentLine = 0 } = {} } = entry;
    assert.equal(range.length, 2);
    const [start = 0, end = 0] = range;
    const raw = source.slice(0, start) + source.slice(start, end).replace(/[^\r\n]/gu, ' ') + source.slice(end);
    assert.ok(linter.verify(raw, { plugins: { resilient }, rules: { [rule]: 'error' } })
        .some(({ line = 0, ruleId = '' } = {}) => ruleId === rule && line === commentLine + 1));
});
const scopedCode = print(scoped({ expression: typescript.factory.createIdentifier('selected'), groups: [
    { objectName: 'input', members: [{ propertyName: 'value', alias: 'selected', kind: 'generic', canonical: '' }] }
] }));
assert.deepEqual(linter.verify(`const read = input => ${scopedCode};`, {
    plugins: { resilient }, rules: { 'resilient/prefer-safe-destructuring-defaults': 'error' }
}).filter(({ severity = 0 } = {}) => severity > 0), []);
