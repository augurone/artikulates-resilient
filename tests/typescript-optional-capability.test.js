import assert from 'node:assert/strict';
import fs from 'node:fs';

import { Linter } from 'eslint';
import typescript from 'typescript';

import safeDefaults from '../rules/prefer-safe-destructuring-defaults.js';
import {
    getCheckerContract,
    getCheckerTypeNode,
    isUnionType
} from '../transforms/typescript/understand/type-resolution.js';

// Candidate proof only. Load the entire owning module with its real imports;
// vary exactly three binding defaults, never the guards, calls or dependencies.
const moduleURL = new URL('../transforms/typescript/understand/type-resolution.js', import.meta.url);
const source = fs.readFileSync(moduleURL, 'utf8');
const bindings = [
    ['isUnion', 'candidate'],
    ['getCallSignatures', 'firstPart'],
    ['typeToTypeNode', 'activeChecker']
];
const plainSource = bindings.reduce((text = '', [name = '', receiver = ''] = []) => {
    const binding = new RegExp(`const \\{ ${name}(?: = false)? \\} = ${receiver};`, 'gu');
    assert.equal([...text.matchAll(binding)].length, 1);

    return text.replace(binding, `const { ${name} } = ${receiver};`);
}, source);
const fluentSource = bindings.reduce((text = '', [name = '', receiver = ''] = []) => (
    text.replace(`const { ${name} } = ${receiver};`, `const { ${name} = false } = ${receiver};`)
), plainSource);
const loadCandidate = (text = '') => {
    const rebased = text.replace(/from '([^']+)'/gu, (match, relative) => (
        `from ${JSON.stringify(relative.startsWith('.') ? new URL(relative, moduleURL).href : import.meta.resolve(relative))}`
    ));

    return import(`data:text/javascript;base64,${Buffer.from(rebased).toString('base64')}`);
};
const [plain = {}, fluent = {}] = await Promise.all([
    loadCandidate(plainSource), loadCandidate(fluentSource)
]);
const owners = [{ isUnionType, getCheckerContract, getCheckerTypeNode }, plain, fluent];
const failure = new Error('owned capability failure');
const capture = (invoke) => {
    try {
        return { result: invoke() };
    } catch (error) {
        return { error };
    }
};
let comparedCases = 0;
const assertParity = (observations = []) => {
    assert.equal(observations.length, 3);
    comparedCases += 1;
    const [first = {}] = observations;
    const { error: firstError = undefined, events: firstEvents = [] } = first;
    observations.forEach(({ error = undefined, result = undefined, events = [] } = {}) => {
        assert.deepEqual(events, firstEvents);

        if (firstError === failure) assert.equal(error, failure);

        if (firstError && firstError !== failure) {
            const { name = '', message = '' } = error;
            const { name: originalName = '', message: originalMessage = '' } = firstError;
            assert.equal(name, originalName);
            assert.equal(message, originalMessage);
        }

        if (!firstError) {
            assert.equal(error, undefined);
            assert.deepEqual(result, Reflect.get(first, 'result'));
        }
    });
};

const noncallables = Object.freeze([undefined, null, false, 0, '', Symbol('missing capability'), {}, []]);
// Fixture values and method results intentionally retain actual undefined:
// defaulting either would conceal the candidate's native boundary behavior.
const observeUnion = ({ owner = {}, value = undefined, throwGet = false, throwCall = false, callResult = undefined } = {}) => {
    let events = [];
    const candidate = Object.freeze({ get isUnion() {
        events = [...events, 'method-get'];

        if (throwGet) throw failure;

        return value === 'callable' ? function capability() {
            assert.equal(this, candidate);
            assert.equal(arguments.length, 0);
            events = [...events, 'method-call'];

            if (throwCall) throw failure;

            return callResult;
        } : value;
    } });
    const { isUnionType: inspect = undefined } = owner;
    const outcome = capture(() => inspect(candidate));

    return { ...outcome, events };
};
noncallables.forEach((value) => {
    const observations = owners.map(owner => observeUnion({ owner, value }));
    assertParity(observations);
    const [observed = {}] = observations;
    assert.deepEqual(observed, { result: false, events: ['method-get'] });
});
[
    { value: 'callable' },
    { value: 'callable', throwCall: true },
    { throwGet: true }
].forEach(options => assertParity(owners.map(owner => observeUnion({ owner, ...options }))));
const callableUnion = owners.map(owner => observeUnion({ owner, value: 'callable', callResult: 'original method result' }));
const [{ result: unionResult = '', events: unionEvents = [] } = {}] = callableUnion;
assert.equal(unionResult, 'original method result');
assert.deepEqual(unionEvents, ['method-get', 'method-call']);
// A callable owns its result; the observer does not Boolean-coerce it.
[undefined, null, false, 0, '', {}, []].forEach((callResult) => {
    const observations = owners.map(owner => observeUnion({ owner, value: 'callable', callResult }));
    assertParity(observations);
    observations.forEach(observation => assert.equal(Reflect.get(observation, 'result'), callResult));
});
owners.forEach(({ isUnionType: inspect = undefined } = {}) => {
    noncallables.forEach(value => assert.equal(inspect(value), false));
    assert.equal(inspect(), false);
    const returned = Object.freeze({ token: 'method-owned identity' });
    assert.equal(inspect({ isUnion: () => returned }), returned);
});

const observeContract = ({
    owner = {}, firstValue = undefined, secondValue = 'callable',
    throwGetAt = 0, throwCall = false, callResult = undefined,
    shape = 'single', rejected = false, cached = false
} = {}) => {
    let events = [];
    let reads = 0;
    const part = Object.freeze({ flags: 0, get getCallSignatures() {
        reads += 1;
        events = [...events, `method-get:${reads}`];

        if (reads === throwGetAt) throw failure;

        const value = reads === 1 ? firstValue : secondValue;

        return value === 'callable' ? function signatures() {
            assert.equal(this, part);
            assert.equal(arguments.length, 0);
            events = [...events, 'method-call'];

            if (throwCall) throw failure;

            return callResult;
        } : value;
    } });
    const { TypeFlags: { Undefined: absentFlags = 0, String: stringFlags = 0, Unknown: unknownFlags = 0 } = {} } = typescript;
    const parts = {
        single: [part], empty: [], many: [part, part],
        absent: [{ flags: absentFlags }], primitive: [{ flags: stringFlags }],
        unknown: [{ flags: unknownFlags }]
    };
    const { [shape]: selectedParts = [] } = parts;
    const type = Object.freeze({ isUnion: () => true, types: selectedParts });
    const inputNode = rejected ? typescript.factory.createNumericLiteral(1) : typescript.factory.createIdentifier('capability');
    const checker = Object.freeze({ getTypeAtLocation(node) {
        assert.equal(this, checker);
        assert.equal(node, inputNode);
        events = [...events, 'type-call'];

        return type;
    } });
    const { getCheckerContract: inspect = undefined } = owner;
    const outcome = capture(() => inspect({
        typescript, node: inputNode, checker: cached ? {} : checker,
        declarations: cached ? { __checker: checker } : {}, typeText: 'original annotation'
    }));

    return { ...outcome, events };
};
noncallables.forEach((firstValue) => {
    const observations = owners.map(owner => observeContract({ owner, firstValue }));
    assertParity(observations);
    const [observed = {}] = observations;
    assert.deepEqual(observed, { result: {}, events: ['type-call', 'method-get:1'] });
});
[
    { firstValue: 'callable', callResult: [{}] },
    { firstValue: 'callable', cached: true, callResult: [{}] },
    { firstValue: 'callable', callResult: [] },
    { firstValue: 'callable', callResult: null },
    { firstValue: 'callable', callResult: undefined },
    { firstValue: 'callable', secondValue: false },
    { firstValue: 'callable', secondValue: undefined },
    { firstValue: 'callable', throwGetAt: 2 },
    { firstValue: 'callable', throwCall: true },
    { throwGetAt: 1 },
    { firstValue: 'callable', shape: 'empty' },
    { firstValue: 'callable', shape: 'many' },
    { shape: 'absent' }, { shape: 'primitive' }, { shape: 'unknown' },
    { firstValue: 'callable', rejected: true }
].forEach(options => assertParity(owners.map(owner => observeContract({ owner, ...options }))));
const callableContract = observeContract({ firstValue: 'callable', callResult: [{}], owner: fluent });
assert.deepEqual(callableContract, {
    result: { kind: 'function', check: "typeof VALUE === 'function'", optional: false, typeText: 'original annotation' },
    events: ['type-call', 'method-get:1', 'method-get:2', 'method-call']
});
assert.deepEqual(observeContract({ owner: fluent, firstValue: 'callable', shape: 'many' }).events,
    ['type-call', 'method-get:1']);
assert.deepEqual(observeContract({ owner: fluent, firstValue: 'callable', rejected: true }).events, []);
['empty', 'absent'].forEach(shape => assert.deepEqual(observeContract({ owner: fluent, shape }), {
    result: {}, events: ['type-call']
}));
assert.deepEqual(observeContract({ owner: fluent, shape: 'primitive' }), {
    result: { kind: 'string', canonical: "''", check: "typeof VALUE === 'string'", optional: false, typeText: 'original annotation' },
    events: ['type-call']
});
assert.deepEqual(observeContract({ owner: fluent, shape: 'unknown' }), {
    result: { kind: 'required', requiresGuard: true, typeText: 'original annotation' }, events: ['type-call']
});
[null, undefined].forEach((callResult) => {
    const { error = false, events = [] } = observeContract({ owner: fluent, firstValue: 'callable', callResult });
    const { name = '' } = error;
    assert.equal(name, 'TypeError');
    assert.deepEqual(events, ['type-call', 'method-get:1', 'method-get:2', 'method-call']);
});
owners.forEach(({ getCheckerContract: inspect = undefined } = {}) => assert.deepEqual(inspect({ typescript }), {}));

const observeTypeNode = ({
    owner = {}, firstValue = undefined, secondValue = 'callable',
    throwGetAt = 0, throwCall = false, throwType = false,
    callResult = undefined, rejected = false, sameKind = false, cached = false, missingChecker = false, importShape = false
} = {}) => {
    let events = [];
    let reads = 0;
    const admittedNode = importShape ? Object.freeze({ kind: typescript.SyntaxKind.ImportType })
        : typescript.factory.createIndexedAccessTypeNode(
            typescript.factory.createTypeReferenceNode('Box'), typescript.factory.createKeywordTypeNode(typescript.SyntaxKind.StringKeyword)
        );
    const inputNode = rejected ? typescript.factory.createIdentifier('notIndexed') : admittedNode;
    const { kind: inputKind = 0 } = inputNode;
    const returned = Object.freeze({ kind: sameKind ? inputKind : typescript.SyntaxKind.StringKeyword });
    const type = Object.freeze({ token: 'original Type' });
    const checker = Object.freeze({
        getTypeAtLocation: missingChecker ? false : function readType(node) {
            assert.equal(this, checker);
            assert.equal(node, inputNode);
            events = [...events, 'type-call'];

            if (throwType) throw failure;

            return type;
        },
        get typeToTypeNode() {
            reads += 1;
            events = [...events, `method-get:${reads}`];

            if (reads === throwGetAt) throw failure;

            const value = reads === 1 ? firstValue : secondValue;

            return value === 'callable' ? function convertAtReceiver(receivedType, receivedNode, flags) {
                assert.equal(this, checker);
                assert.equal(receivedType, type);
                assert.equal(receivedNode, inputNode);
                assert.equal(flags, typescript.NodeBuilderFlags.NoTruncation);
                events = [...events, 'method-call'];

                if (throwCall) throw failure;

                return callResult === 'node' ? returned : callResult;
            } : value;
        }
    });
    const { getCheckerTypeNode: inspect = undefined } = owner;
    const outcome = capture(() => inspect({
        typescript, node: inputNode, checker: cached ? {} : checker,
        declarations: cached || missingChecker ? { __checker: checker } : {}
    }));
    const { result = false } = outcome;

    if (callResult === 'node' && !sameKind && result) assert.equal(result, returned);

    return { ...outcome, events };
};
noncallables.forEach((firstValue) => {
    const observations = owners.map(owner => observeTypeNode({ owner, firstValue }));
    assertParity(observations);
    const [observed = {}] = observations;
    assert.deepEqual(observed, { result: {}, events: ['method-get:1'] });
});
[
    { firstValue: 'callable', callResult: 'node' },
    { firstValue: 'callable', callResult: 'node', cached: true },
    { firstValue: 'callable', callResult: 'node', importShape: true },
    { firstValue: 'callable', callResult: 'node', sameKind: true },
    { firstValue: 'callable', callResult: null },
    { firstValue: 'callable', callResult: undefined },
    { firstValue: 'callable', secondValue: false },
    { firstValue: 'callable', secondValue: undefined },
    { firstValue: 'callable', throwGetAt: 2 },
    { firstValue: 'callable', throwCall: true },
    { firstValue: 'callable', throwType: true },
    { throwGetAt: 1 },
    { firstValue: 'callable', rejected: true },
    { firstValue: 'callable', missingChecker: true },
    { firstValue: 'callable', rejected: true, throwGetAt: 1 }
].forEach(options => assertParity(owners.map(owner => observeTypeNode({ owner, ...options }))));
assert.deepEqual(observeTypeNode({ owner: fluent, firstValue: 'callable', callResult: 'node' }).events,
    ['method-get:1', 'type-call', 'method-get:2', 'method-call']);
assert.deepEqual(observeTypeNode({ owner: fluent, firstValue: 'callable', rejected: true }).events, ['method-get:1']);
assert.deepEqual(observeTypeNode({ owner: fluent, firstValue: 'callable', missingChecker: true }).events, ['method-get:1']);
const rejectedGet = observeTypeNode({ owner: fluent, rejected: true, throwGetAt: 1 });
const { error: rejectedFailure = false, events: rejectedEvents = [] } = rejectedGet;
assert.equal(rejectedFailure, failure);
assert.deepEqual(rejectedEvents, ['method-get:1']);
[null, undefined].forEach(callResult => assert.deepEqual(observeTypeNode({ owner: fluent, firstValue: 'callable', callResult }), {
    result: {}, events: ['method-get:1', 'type-call', 'method-get:2', 'method-call']
}));
owners.forEach(({ getCheckerTypeNode: inspect = undefined } = {}) => assert.deepEqual(inspect({ typescript }), {}));
assert.equal(comparedCases, 65);

// Real compiler integration: no stubbed resolver, Type methods or conversion.
const fileName = 'optional-capability.ts';
const sourceFile = typescript.createSourceFile(fileName, [
    'type Box = { value: string };',
    'type Read = Box["value"];',
    'declare const value: string | number;',
    'declare const callable: (input: number) => string;',
    'declare const opaque: unknown;'
].join('\n'), typescript.ScriptTarget.ESNext, true);
const compilerHost = typescript.createCompilerHost({ noLib: true });
const program = typescript.createProgram([fileName], { noLib: true, strict: true }, {
    ...compilerHost,
    getSourceFile: (name, languageVersion) => name === fileName ? sourceFile : compilerHost.getSourceFile(name, languageVersion)
});
const checker = program.getTypeChecker();
const { statements: [, alias = {}, ...declarations] = [] } = sourceFile;
const { type: indexed = {} } = alias;
const printer = typescript.createPrinter();
owners.forEach(({ getCheckerTypeNode: convert = undefined, getCheckerContract: inspect = undefined, isUnionType: union = undefined } = {}) => {
    const converted = convert({ typescript, checker, node: indexed });
    const { kind: convertedKind = 0 } = converted;
    assert.equal(convertedKind, typescript.SyntaxKind.StringKeyword);
    assert.equal(printer.printNode(typescript.EmitHint.Unspecified, converted, sourceFile), 'string');
    const convertedCached = convert({ typescript, declarations: { __checker: checker }, node: indexed });
    assert.equal(printer.printNode(typescript.EmitHint.Unspecified, convertedCached, sourceFile), 'string');
    declarations.forEach(({ declarationList: { declarations: [{ name = {} } = {}] = [] } = {} } = {}, index = 0) => {
        const evidence = inspect({ typescript, checker, node: name });
        const { kind = '' } = evidence;
        assert.equal(kind, ['', 'function', 'required'][index]);
        assert.equal(union(checker.getTypeAtLocation(name)), index === 0);
        assert.deepEqual(inspect({ typescript, declarations: { __checker: checker }, node: name }), evidence);
        assert.deepEqual(evidence, getCheckerContract({ typescript, checker, node: name }));
    });
});

// The default rule does not invent a callback; each false-default binding is
// fluent even when invocation remains receiver-owned rather than identifier-owned.
const linter = new Linter();
const configuration = { plugins: { resilient: { rules: { defaults: safeDefaults } } }, rules: { 'resilient/defaults': 'error' } };
bindings.forEach(([name = '', receiver = ''] = []) => {
    const raw = `const ${receiver} = {}; const { ${name} } = ${receiver};`;
    const fixed = `const ${receiver} = {}; const { ${name} = false } = ${receiver};`;
    assert.equal(linter.verify(raw, configuration).length, 1);
    assert.deepEqual(linter.verify(fixed, configuration), []);
    const repaired = linter.verifyAndFix(fixed, configuration);
    const { output = '', messages = [] } = repaired;
    assert.equal(output, fixed);
    assert.deepEqual(messages, []);
});
