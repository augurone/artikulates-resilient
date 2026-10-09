import assert from 'node:assert/strict';
import test from 'node:test';

import typescript from 'typescript';

import { getCheckerContract, getCheckerTypeNode, isUnionType } from '../transforms/typescript/understand/type-resolution.js';

const failure = new Error('owned capability failure');
const capture = (invoke) => {
    try {
        return { result: invoke() };
    } catch (error) {
        return { error };
    }
};
const noncallables = Object.freeze([undefined, null, false, 0, '', Symbol('missing capability'), {}, []]);

// eslint-disable-next-line resilient/prefer-safe-destructuring-defaults -- Optional fixture capabilities and results include real undefined to test native behavior.
const observeUnion = ({ value, throwGet = false, throwCall = false, callResult } = {}) => {
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
    const outcome = capture(() => isUnionType(candidate));

    return { ...outcome, events };
};

test('optional union capability preserves absence, receivers, results and failures', () => {
    noncallables.forEach(value => assert.deepEqual(observeUnion({ value }), { result: false, events: ['method-get'] }));
    [undefined, null, false, 0, '', {}, []].forEach((callResult) => {
        const observation = observeUnion({ value: 'callable', callResult });
        const { events = [] } = observation;

        assert.equal(Reflect.get(observation, 'result'), callResult);
        assert.deepEqual(events, ['method-get', 'method-call']);
    });
    [{ throwGet: true }, { value: 'callable', throwCall: true }].forEach((options) => {
        const { error = false } = observeUnion(options);

        assert.equal(error, failure);
    });
    noncallables.forEach(value => assert.equal(isUnionType(value), false));
    // eslint-disable-next-line resilient/signature-contract-call-site -- Omitted input is the optional capability absence boundary under test.
    assert.equal(isUnionType(), false);
});

// eslint-disable-next-line resilient/prefer-safe-destructuring-defaults -- Fixture capabilities and returned values preserve actual undefined, false and zero.
const observeContract = ({ firstValue, secondValue = 'callable', throwGetAt = 0, throwCall = false, callResult,
    shape = 'single', rejected = false, cached = false } = {}) => {
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
    const outcome = capture(() => getCheckerContract({
        typescript, node: inputNode, checker: cached ? {} : checker,
        declarations: cached ? { __checker: checker } : {}, typeText: 'original annotation'
    }));

    return { ...outcome, events };
};

test('optional checker call signatures retain semantic states and native failures', () => {
    noncallables.forEach(firstValue => assert.deepEqual(observeContract({ firstValue }), {
        result: {}, events: ['type-call', 'method-get:1']
    }));
    [false, true].forEach((cached) => {
        const { result: { kind = '', optional = true } = {}, events = [] } = observeContract({ firstValue: 'callable', callResult: [{}], cached });

        assert.equal(kind, 'function');
        assert.equal(optional, false);
        assert.deepEqual(events, ['type-call', 'method-get:1', 'method-get:2', 'method-call']);
    });
    ['empty', 'absent'].forEach(shape => assert.deepEqual(observeContract({ shape }), { result: {}, events: ['type-call'] }));
    const { result: { kind: primitiveKind = '' } = {} } = observeContract({ shape: 'primitive' });
    const { result: { kind: unknownKind = '' } = {} } = observeContract({ shape: 'unknown' });

    assert.equal(primitiveKind, 'string');
    assert.equal(unknownKind, 'required');
    assert.deepEqual(observeContract({ firstValue: 'callable', shape: 'many' }).events, ['type-call', 'method-get:1']);
    assert.deepEqual(observeContract({ firstValue: 'callable', rejected: true }).events, []);
    [{ throwGetAt: 1 }, { firstValue: 'callable', throwGetAt: 2 }, { firstValue: 'callable', throwCall: true }].forEach((options) => {
        const { error = false } = observeContract(options);

        assert.equal(error, failure);
    });
    [null, undefined].forEach((callResult) => {
        const { error = false } = observeContract({ firstValue: 'callable', callResult });

        assert.ok(error instanceof TypeError);
    });
    [false].forEach((secondValue) => {
        const { error = false } = observeContract({ firstValue: 'callable', secondValue });

        assert.ok(error instanceof TypeError);
    });
    assert.deepEqual(getCheckerContract({ typescript }), {});
});

// eslint-disable-next-line resilient/prefer-safe-destructuring-defaults -- Fixture compiler capabilities and returned values retain native absence without replacement nodes.
const observeTypeNode = ({ firstValue, secondValue = 'callable', throwGetAt = 0, throwCall = false, throwType = false, callResult,
    rejected = false, sameKind = false, cached = false, missingChecker = false, importShape = false } = {}) => {
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
    const outcome = capture(() => getCheckerTypeNode({
        typescript, node: inputNode, checker: cached ? {} : checker,
        declarations: cached || missingChecker ? { __checker: checker } : {}
    }));
    const { result = false } = outcome;

    if (callResult === 'node' && !sameKind && result) assert.equal(result, returned);

    return { ...outcome, events };
};

test('optional checker conversion preserves node identity, call ownership and missing evidence', () => {
    noncallables.forEach(firstValue => assert.deepEqual(observeTypeNode({ firstValue }), { result: {}, events: ['method-get:1'] }));
    [{}, { cached: true }, { importShape: true }].forEach((options) => {
        const { result: { kind = 0 } = {}, events = [] } = observeTypeNode({ firstValue: 'callable', callResult: 'node', ...options });

        assert.equal(kind, typescript.SyntaxKind.StringKeyword);
        assert.deepEqual(events, ['method-get:1', 'type-call', 'method-get:2', 'method-call']);
    });
    [null, undefined].forEach(callResult => assert.deepEqual(observeTypeNode({ firstValue: 'callable', callResult }), {
        result: {}, events: ['method-get:1', 'type-call', 'method-get:2', 'method-call']
    }));
    assert.deepEqual(observeTypeNode({ firstValue: 'callable', callResult: 'node', sameKind: true }).result, {});
    [{ rejected: true }, { missingChecker: true }].forEach((options) => {
        assert.deepEqual(observeTypeNode({ firstValue: 'callable', ...options }), { result: {}, events: ['method-get:1'] });
    });
    [{ throwGetAt: 1 }, { rejected: true, throwGetAt: 1 }, { firstValue: 'callable', throwGetAt: 2 },
        { firstValue: 'callable', throwCall: true }, { firstValue: 'callable', throwType: true }].forEach((options) => {
        const { error = false } = observeTypeNode(options);

        assert.equal(error, failure);
    });
    [false].forEach((secondValue) => {
        const { error = false } = observeTypeNode({ firstValue: 'callable', secondValue });

        assert.ok(error instanceof TypeError);
    });
    assert.deepEqual(getCheckerTypeNode({ typescript }), {});
});

test('real compiler type conversion and signatures use the same capability owners', () => {
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
    const converted = getCheckerTypeNode({ typescript, checker, node: indexed });
    const { kind: convertedKind = 0 } = converted;
    assert.equal(convertedKind, typescript.SyntaxKind.StringKeyword);
    assert.equal(printer.printNode(typescript.EmitHint.Unspecified, converted, sourceFile), 'string');
    const convertedCached = getCheckerTypeNode({ typescript, declarations: { __checker: checker }, node: indexed });
    assert.equal(printer.printNode(typescript.EmitHint.Unspecified, convertedCached, sourceFile), 'string');
    declarations.forEach(({ declarationList: { declarations: [{ name = {} } = {}] = [] } = {} } = {}, index = 0) => {
        const evidence = getCheckerContract({ typescript, checker, node: name });
        const { kind = '' } = evidence;
        assert.equal(kind, ['', 'function', 'required'][index]);
        assert.equal(isUnionType(checker.getTypeAtLocation(name)), index === 0);
        assert.deepEqual(getCheckerContract({ typescript, declarations: { __checker: checker }, node: name }), evidence);
        assert.deepEqual(evidence, getCheckerContract({ typescript, checker, node: name }));
    });
});
