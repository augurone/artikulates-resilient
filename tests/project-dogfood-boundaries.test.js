import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { runInNewContext } from 'node:vm';

import { Linter } from 'eslint';
import typescript from 'typescript';

import { getFileCandidates } from '../rules/support/file-candidates.js';

const parse = (file = '') => typescript.createSourceFile(file, readFileSync(file, 'utf8'), typescript.ScriptTarget.ESNext, true);
const findScopeVariable = ({ scope = {}, name = '' } = {}) => {
    if (!scope || !name) return {};

    const { set = new Map(), upper = {} } = scope;
    const variable = set.get(name);

    if (variable) return variable;

    return upper ? findScopeVariable({ scope: upper, name }) : {};
};
const getLexicalOwner = (scope = {}) => {
    if (!scope) return {};

    const { type = '', upper = {} } = scope;

    if (['function', 'module', 'global'].includes(type)) return scope;

    return upper ? getLexicalOwner(upper) : {};
};
const getStaticMember = ({ computed = false, property = {} } = {}) => {
    const { type = '', name = '', value = '' } = property;

    if (!computed && type === 'Identifier') return name;

    return computed && type === 'Literal' && typeof value === 'string' ? value : '';
};
// This is a proof guard for descriptor writes in one transformer owner. A local
// is private only when a direct const-alias chain reaches fresh construction. Property
// reads, calls, mutable bindings, and unsupported patterns remain unresolved.
const getDescriptorTargetOwnership = ({ node = {}, scope = {}, seen = new Set() } = {}) => {
    const { type = '', name = '' } = node;

    if (['ObjectExpression', 'ArrayExpression', 'FunctionExpression',
        'ArrowFunctionExpression', 'ClassExpression'].includes(type)) return 'private';

    if (type !== 'Identifier') return 'unresolved';

    const variable = findScopeVariable({ scope, name });

    if (seen.has(variable)) return 'unresolved';

    const { defs = [], scope: declaredScope = {} } = variable;

    if (defs.some(({ type: definitionType = '' } = {}) => (
        ['Parameter', 'ImportBinding', 'CatchClause'].includes(definitionType)
    ))) return 'caller-owned';

    if (defs.length && declaredScope && getLexicalOwner(declaredScope) !== getLexicalOwner(scope)) {
        return 'caller-owned';
    }

    const [definition = {}] = defs;
    const { type: definitionType = '', node: declarator = {}, parent: declaration = {} } = definition;
    const { id = {}, init = {} } = declarator;
    const { type: idType = '' } = id;
    const { kind: declarationKind = '' } = declaration;

    if (defs.length !== 1 || definitionType !== 'Variable' || declarationKind !== 'const') return 'unresolved';

    const nextSeen = new Set([...seen, variable]);

    if (idType === 'Identifier') return getDescriptorTargetOwnership({ node: init, scope, seen: nextSeen });

    if (!['ObjectPattern', 'ArrayPattern'].includes(idType)) return 'unresolved';

    // A destructured value can come from the input even when the binding is
    // declared locally. Fresh containers do not prove their contents private.
    const sourceOwnership = getDescriptorTargetOwnership({ node: init, scope, seen: nextSeen });

    return sourceOwnership === 'caller-owned' ? 'caller-owned' : 'unresolved';
};
const getUnprovedDescriptorWrites = (source = '') => {
    let findings = [];
    const descriptorMethods = new Map([
        ['Object', new Set(['defineProperty', 'defineProperties'])],
        ['Reflect', new Set(['defineProperty'])]
    ]);
    const { get: getDescriptorMethods = () => false } = descriptorMethods;
    const auditRule = {
        meta: { schema: [] },
        create({ sourceCode = {} } = {}) {
            const { getScope = () => ({}), getText = () => '' } = sourceCode;

            return {
                CallExpression(node = {}) {
                    const { callee = {}, arguments: args = [] } = node;
                    const { type: calleeType = '', object = {} } = callee;
                    const { type: objectType = '', name: objectName = '' } = object;
                    const method = getStaticMember(callee);
                    const methods = Reflect.apply(getDescriptorMethods, descriptorMethods, [objectName]);

                    if (calleeType !== 'MemberExpression' || objectType !== 'Identifier' || !methods) return;

                    const { has = () => false } = methods;

                    if (!Reflect.apply(has, methods, [method])) return;

                    const scope = Reflect.apply(getScope, sourceCode, [node]);
                    const nativeObject = findScopeVariable({ scope, name: objectName });

                    if (!nativeObject) return;

                    const { defs: nativeDefinitions = [], scope: nativeScope = {} } = nativeObject;
                    const { type: nativeScopeType = '' } = nativeScope;

                    if (nativeDefinitions.length || nativeScopeType !== 'global') return;

                    const [target = {}] = args;
                    const ownership = getDescriptorTargetOwnership({ node: target, scope });

                    if (ownership === 'private') return;

                    findings = [...findings, {
                        api: `${objectName}.${method}`,
                        target: Reflect.apply(getText, sourceCode, [target]),
                        ownership
                    }];
                }
            };
        }
    };
    const linter = new Linter({ configType: 'flat' });

    const messages = linter.verify(source, [{
        languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
        plugins: { ownership: { rules: { descriptors: auditRule } } },
        rules: { 'ownership/descriptors': 'error' }
    }]);

    assert.equal(messages.some(({ fatal = false } = {}) => fatal), false, JSON.stringify(messages));

    return findings;
};
// These are syntactic audit inputs, including unresolved references; they are
// not authored-valid dialect fixtures or evidence of production AST writes.
const descriptorOwnershipFixture = [
    "import { importedNode } from './input.js';",
    "Object.defineProperty(importedNode, 'tag', { value: true });",
    'const capturedNode = {};',
    "const mutateCaptured = () => Reflect.defineProperty(capturedNode, 'tag', { value: true });",
    "const mutateParameter = node => Object.defineProperties(node, { tag: { value: true } });",
    "const mutateAlias = node => { const local = node; Object.defineProperty(local, 'tag', { value: true }); };",
    "const mutateAliasChain = node => { const first = node; const second = first; Reflect.defineProperty(second, 'tag', { value: true }); };",
    "const mutateField = owner => { const { node } = owner; Reflect.defineProperty(node, 'tag', { value: true }); };",
    "const mutateRenamedField = owner => { const { node: local } = owner; Object.defineProperty(local, 'tag', { value: true }); };",
    "const mutatePrivate = () => { const node = {}; Object.defineProperty(node, 'tag', { value: true }); };",
    "const mutatePrivateAlias = () => { const node = {}; const local = node; Object.defineProperty(local, 'tag', { value: true }); };",
    "const mutateUnknown = () => { const node = getNode(); Object.defineProperty(node, 'tag', { value: true }); };",
    "const mutateUnbound = () => Object.defineProperty(unknownNode, 'tag', { value: true });",
    "const mutateDirectCall = () => Object.defineProperty(getNode(), 'tag', { value: true });",
    "const mutateMutable = () => { let node = {}; Object.defineProperty(node, 'tag', { value: true }); };",
    "const mutateUnknownMember = () => { const node = {}; Object.defineProperty(node.child, 'tag', { value: true }); };",
    "const mutateComputed = node => Object['defineProperty'](node, 'tag', { value: true });",
    "const shadowed = (Object, node) => Object.defineProperty(node, 'tag', { value: true });",
    "const shadowedReflect = (Reflect, node) => Reflect.defineProperty(node, 'tag', { value: true });",
    "const aliasedNative = node => { const NativeObject = Object; NativeObject.defineProperty(node, 'tag', { value: true }); };",
    'void [mutateCaptured, mutateParameter, mutateAlias, mutateAliasChain, mutateField, mutateRenamedField, '
        + 'mutatePrivate, mutatePrivateAlias, mutateUnknown, mutateUnbound, mutateDirectCall, '
        + 'mutateMutable, mutateUnknownMember, mutateComputed, shadowed, shadowedReflect, aliasedNative];'
].join('\n');

assert.deepEqual(getUnprovedDescriptorWrites(descriptorOwnershipFixture), [
    { api: 'Object.defineProperty', target: 'importedNode', ownership: 'caller-owned' },
    { api: 'Reflect.defineProperty', target: 'capturedNode', ownership: 'caller-owned' },
    { api: 'Object.defineProperties', target: 'node', ownership: 'caller-owned' },
    { api: 'Object.defineProperty', target: 'local', ownership: 'caller-owned' },
    { api: 'Reflect.defineProperty', target: 'second', ownership: 'caller-owned' },
    { api: 'Reflect.defineProperty', target: 'node', ownership: 'caller-owned' },
    { api: 'Object.defineProperty', target: 'local', ownership: 'caller-owned' },
    { api: 'Object.defineProperty', target: 'node', ownership: 'unresolved' },
    { api: 'Object.defineProperty', target: 'unknownNode', ownership: 'unresolved' },
    { api: 'Object.defineProperty', target: 'getNode()', ownership: 'unresolved' },
    { api: 'Object.defineProperty', target: 'node', ownership: 'unresolved' },
    { api: 'Object.defineProperty', target: 'node.child', ownership: 'unresolved' },
    { api: 'Object.defineProperty', target: 'node', ownership: 'caller-owned' }
]);
assert.deepEqual(getUnprovedDescriptorWrites(readFileSync(
    'transforms/typescript/policy/exceptions.js', 'utf8'
)), [], 'Retained-boundary placement must not write descriptors to caller-owned or unresolved targets.');
const getOwners = ({ sourceFile: { statements = [] } = {}, names = [] } = {}) => statements
    .filter(statement => typescript.isVariableStatement(statement))
    .filter(({ declarationList: { declarations = [] } = {} } = {}) => declarations.some(({ name = {} } = {}) => (
        names.includes(name.getText())
    )))
    .map(owner => owner.getText());
const versionOwners = getOwners({ sourceFile: parse('scripts/release.js'), names: ['fail', 'parseVersion', 'compareVersions'] });
assert.equal(versionOwners.length, 3);
// Extract only these actual pure declarations. Never import or execute the
// release CLI's main, writes, subprocesses or publication work.
const compareVersions = runInNewContext(`${versionOwners.join('\n')}\ncompareVersions;`);
[
    ['1.2.3', '1.2.3', 0], ['2.0.0', '1.9.9', 1], ['1.4.0', '1.2.9', 2],
    ['1.2.1', '1.2.9', -8], ['1.2.3', '1.2.3-rc', 1], ['1.2.3-rc', '1.2.3', -1],
    ['01.002.03', '1.2.3', 0], ['0.0.0', '0.0.1', -1],
    ['1.2.3-alpha.2', '1.2.3-alpha.10', 'alpha.2'.localeCompare('alpha.10')],
    [`${'9'.repeat(400)}.0.0`, '1.0.0', Infinity],
    [`${'9'.repeat(400)}.1.0`, `${'9'.repeat(400)}.0.0`, 1]
].forEach(([left = '', right = '', expected = 0] = []) => assert.equal(compareVersions(left, right), expected));
assert.throws(() => compareVersions('bad-left', 'bad-right'), /Invalid semantic version: bad-left/);
assert.throws(() => compareVersions('1.2.3', 'bad-right'), /Invalid semantic version: bad-right/);
let coercions = [];
const left = { toString: () => {
    coercions = [...coercions, 'left'];

    return '1.2.3';
} };
const right = { toString: () => {
    coercions = [...coercions, 'right'];

    return '1.2.4';
} };
assert.equal(compareVersions(left, right), -1);
assert.deepEqual(coercions, ['left', 'right']);
const failure = new TypeError('version input');
assert.throws(() => compareVersions({ toString: () => { throw failure; } }, right), error => error === failure);

[
    { file: 'tests/typescript-transform.test.js', binding: '{ analyze, transform }' },
    { file: 'tests/typescript-hard-case.test.js', binding: '{ transform }' }
].forEach(({ file = '', binding = '' } = {}) => {
    const owners = getOwners({ sourceFile: parse(file), names: [binding] });
    assert.equal(owners.length, 1);
    const [declaration = ''] = owners;
    [{}, null, { transform: undefined }].forEach((missing) => {
        let factoryCalls = 0;
        const createTypeScriptTransformer = () => {
            factoryCalls += 1;

            return missing;
        };

        assert.throws(() => runInNewContext(`${declaration}\ntransform({});`, {
            typescript, createTypeScriptTransformer
        }), { name: 'TypeError' });
        assert.equal(factoryCalls, 1);
    });
});

const transformerTest = parse('tests/typescript-transform.test.js');
let tupleFixture = '';
const collectTupleFixture = (node = {}) => {
    const { name = {}, initializer = {} } = node;

    if (typescript.isVariableDeclaration(node) && name.getText(transformerTest) === 'runRequiredTuple') {
        tupleFixture = initializer.getText(transformerTest);
    }

    typescript.forEachChild(node, collectTupleFixture);
};
collectTupleFixture(transformerTest);
assert.ok(tupleFixture);
const runRequiredTuple = runInNewContext(`(${tupleFixture});`);
[{}, { apply: undefined }, { apply: null }, { apply: false }].forEach((missing = {}) => {
    assert.throws(() => runRequiredTuple(missing), /required tuple fixture export missing/);
});
assert.throws(() => runRequiredTuple(null), { name: 'TypeError' });
assert.throws(() => runRequiredTuple(), { name: 'TypeError' });
[null, undefined].forEach((container) => {
    let nativeContext = '';

    try {
        runInNewContext('(({ apply: applyTuple, read: readTuple, run: runTuple }) => 0)(input);', { input: container });
    } catch ({ message = '' }) {
        nativeContext = message;
    }

    assert.ok(nativeContext);
    assert.throws(() => runRequiredTuple(container), ({ message = '' } = {}) => message === nativeContext);
});
const ledgers = ['calls', 'nestedCalls', 'events', 'projectionEvents'];
let bodies = [];
const collect = (node = {}) => {
    const method = typescript.isMethodDeclaration(node) || typescript.isGetAccessorDeclaration(node);
    const text = method ? node.getText(transformerTest) : '';
    const ledger = ledgers.find((name = '') => text.includes(`${name} = [...${name},`)) || '';

    if (ledger) bodies = [...bodies, { text, ledger, getter: typescript.isGetAccessorDeclaration(node) }];

    typescript.forEachChild(node, collect);
};
collect(transformerTest);
assert.equal(bodies.length, 6);
const value = {};
const firstEmpty = {};
const reduce = input => input;
const foldMap = input => input;
bodies.forEach(({ text = '', ledger = '', getter = false } = {}) => {
    // A proof oracle for append only: entry values and the rest of each actual
    // callback/getter body are unchanged. No snapshots/iterators expose this ledger.
    const nativeAppend = text.replace(new RegExp(`${ledger} = \\[\\.\\.\\.${ledger}, ([^;]+)\\];`, 'u'), `${ledger}.push($1);`);
    assert.notEqual(nativeAppend, text);
    [false, true].forEach((abrupt = false) => {
        const callback = () => {
            if (abrupt) throw failure;

            return value;
        };
        const invoke = (body = '') => runInNewContext(`
            let ${ledger} = [];
            const owner = { ${body} };
            let result;
            try { result = ${getter ? 'owner[Object.keys(owner)[0]]' : 'owner.map(value, callback)'}; }
            catch (error) { result = error; }
            ({ result, entries: ${ledger} });
        `, { value, callback, failure, reduce, foldMap, firstEmpty, secondEmpty: false });
        const original = invoke(nativeAppend);
        const fluent = invoke(text);
        const { entries: oldEntries = [], result: oldResult = undefined } = original;
        const { entries: newEntries = [], result: newResult = undefined } = fluent;
        assert.equal(newResult, oldResult);
        assert.equal(newEntries.length, oldEntries.length);
        newEntries.forEach((entry = {}, index = 0) => {
            const { [index]: expected = {} } = oldEntries;
            const { value: actualValue = undefined, callback: actualCallback = undefined } = entry;
            const { value: expectedValue = undefined, callback: expectedCallback = undefined } = expected;

            if (getter) assert.equal(entry, expected);

            if (getter) return;

            assert.equal(actualValue, expectedValue);
            assert.equal(actualCallback, expectedCallback);
            assert.equal(actualCallback, callback);
        });
    });
});

const inspectorOwners = getOwners({ sourceFile: parse('scripts/inspect-stack.js'),
    names: ['getDisplayName', 'getExistingFile', 'getLocalImportFile', 'loadWorkspace'] });
assert.equal(inspectorOwners.length, 4);
let ioEvents = [];
const files = {
    '/proof/root.js': { code: 'root', sources: ['./child', './last', './child'] },
    '/proof/child.js': { code: 'child', sources: ['./root'] },
    '/proof/last/index.js': { code: 'last', sources: [] }
};
const hostFailure = new Error('read failure');
let failRead = '';
let failStat = '';
const inspector = runInNewContext(`${inspectorOwners.join('\n')}\n({ getLocalImportFile, loadWorkspace });`, {
    path, getFileCandidates, process: { cwd: () => '/proof' },
    fs: {
        stat: async (file = '') => {
            ioEvents = [...ioEvents, `stat:${file}`];

            if (file === failStat) throw hostFailure;

            return { isFile: () => Object.hasOwn(files, file) };
        },
        readFile: async (file = '') => {
            ioEvents = [...ioEvents, `read:${file}`];

            if (file === failRead) throw hostFailure;

            const { [file]: { code = '' } = {} } = files;

            return code;
        }
    },
    createProgramCapture: () => async (code = '', { fileName = '' } = {}) => {
        ioEvents = [...ioEvents, `parse:${fileName}`];

        return { code };
    },
    getModuleSources: ({ code = '' } = {}) => {
        const matchingFile = Object.values(files).find(({ code: candidate = '' } = {}) => candidate === code);
        const { sources = [] } = matchingFile;

        return sources;
    }
});
const { getLocalImportFile = () => '', loadWorkspace = () => ({}) } = inspector;
assert.equal(await getLocalImportFile({ fileName: '/proof/root.js', source: './child' }), '/proof/child.js');
assert.deepEqual(ioEvents, ['stat:/proof/child', 'stat:/proof/child.js']);
failStat = '/proof/child';
ioEvents = [];
assert.equal(await getLocalImportFile({ fileName: '/proof/root.js', source: './child' }), '/proof/child.js');
assert.deepEqual(ioEvents, ['stat:/proof/child', 'stat:/proof/child.js']);
failStat = '';
ioEvents = [];
assert.equal(await getLocalImportFile({ fileName: '/proof/root.js', source: './missing' }), '');
assert.deepEqual(ioEvents, getFileCandidates({ base: '/proof/missing' }).map(file => `stat:${file}`));
ioEvents = [];
assert.equal(await getLocalImportFile({ fileName: '/proof/root.js', source: 'external' }), '');
assert.deepEqual(ioEvents, []);
const { programs = {}, rootCode = '', rootDisplayName = '' } = await loadWorkspace({ fileName: '/proof/root.js' });
assert.deepEqual(Object.keys(programs), ['root.js', 'child.js', 'last/index.js']);
assert.equal(rootCode, 'root');
assert.equal(rootDisplayName, 'root.js');
assert.deepEqual(ioEvents.filter(event => event.startsWith('read:')), ['read:/proof/root.js', 'read:/proof/child.js', 'read:/proof/last/index.js']);
assert.equal(ioEvents.filter(event => event === 'read:/proof/child.js').length, 1);
failRead = '/proof/child.js';
ioEvents = [];
await assert.rejects(loadWorkspace({ fileName: '/proof/root.js' }), error => error === hostFailure);
assert.equal(ioEvents.includes('read:/proof/last/index.js'), false);

const auditOwners = getOwners({ sourceFile: parse('scripts/audit-eslint-exceptions.js'), names: ['main'] });
assert.equal(auditOwners.length, 1);
let auditEvents = [];
let findings = [];
let exitCode = 0;
const commandProcess = { argv: [], stderr: { write: (text = '') => { auditEvents = [...auditEvents, text]; } } };
Object.defineProperty(commandProcess, 'exitCode', { set: (code = 0) => {
    exitCode = code;
    auditEvents = [...auditEvents, 'exit'];
} });
const runAudit = runInNewContext(`${auditOwners.join('\n')}\nmain;`, { process: commandProcess, auditDirectory: () => findings });
await runAudit();
assert.deepEqual(auditEvents, []);
assert.equal(exitCode, 0);
findings = ['one finding', 'later finding'];
await runAudit();
assert.deepEqual(auditEvents, ['Invalid ESLint exceptions:\none finding\nlater finding\n', 'exit']);
assert.equal(exitCode, 1);
