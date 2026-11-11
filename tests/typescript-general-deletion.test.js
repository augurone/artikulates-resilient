import assert from 'node:assert/strict';

import { Linter } from 'eslint';
import typescript from 'typescript';

import resilient from 'eslint-plugin-resilient';
import product from 'eslint-plugin-resilient/eslint';
import { createTypeScriptTransformer } from 'eslint-plugin-resilient/typescript';

const { rules: { 'prefer-safe-transformations': mutations = {}, 'prefer-signature-destructuring': signature = {} } = {} } = product;
import { compileDestructuringDecisions } from '../transforms/typescript/policy/decision-store.js';
import { collectDestructuringAgreements } from '../transforms/typescript/policy/source-agreements.js';
import { collectCollectionReconstructionContracts, collectClosedStructuralModelContracts } from '../transforms/typescript/understand/type-evidence.js';

const compile = (code = '', extra = {}) => {
    const fileName = '/virtual/deletion.ts';
    const sourceFile = typescript.createSourceFile(fileName, code, typescript.ScriptTarget.ESNext, true);
    const options = { strict: true, skipLibCheck: true, target: typescript.ScriptTarget.ESNext, module: typescript.ModuleKind.ESNext };
    const host = typescript.createCompilerHost(options);
    const sources = { [fileName]: sourceFile, ...extra };
    const virtualFile = (name = '') => {
        const { [name]: file = false } = sources;

        return file;
    };
    const program = typescript.createProgram([...Object.keys(sources), typescript.getDefaultLibFilePath(options)], options, {
        ...host,
        directoryExists: name => name === '/virtual' || host.directoryExists(name),
        fileExists: name => Boolean(virtualFile(name)) || host.fileExists(name),
        readFile: (name) => {
            const { text = '' } = virtualFile(name);

            return text || host.readFile(name);
        },
        getSourceFile: (name, version) => virtualFile(name) || host.getSourceFile(name, version)
    });
    const compilerMessages = typescript.getPreEmitDiagnostics(program).map(({ messageText = '' } = {}) => typescript.flattenDiagnosticMessageText(messageText, '\n'));
    assert.deepEqual(compilerMessages, [], 'The checker fixture must resolve without errors.');
    const checker = program.getTypeChecker();
    const collection = collectCollectionReconstructionContracts({ typescript, sourceFile, checker });
    const structural = collectClosedStructuralModelContracts({ typescript, sourceFile, checker });
    const decisions = compileDestructuringDecisions(collectDestructuringAgreements({ typescript,
        collectionReconstructionContracts: collection, closedStructuralModels: structural }));
    const result = createTypeScriptTransformer({ typescript, program }).transform({ code, fileName });
    const { diagnostics = [] } = result;
    assert.deepEqual(diagnostics, []);

    return { ...result, collection, structural, decisions };
};
const source = family => `export const run = (invoke: (callback: (item: ${family}<string, number>) => void) => void) => invoke(item => { item.set('k', 1); });`;
['Map', 'Bag'].forEach((name) => {
    const { collection = new Map(), decisions = {} } = compile(`export interface ${name}<K, V> { set(key: K, value: V): void } ${source(name)}`);
    assert.equal(collection.size, 0, name);
    assert.equal(decisions.byKind.has('collection-reconstruction'), false);
});
const counterfeit = '/virtual/lib.lookalike.d.ts';
const { collection: counterfeitFacts = new Map() } = compile(`import { Map } from './lib.lookalike'; ${source('Map')}`, {
    [counterfeit]: typescript.createSourceFile(counterfeit, 'export interface Map<K, V> { set(key: K, value: V): void }', typescript.ScriptTarget.ESNext, true)
});
assert.equal(counterfeitFacts.size, 0);
['Map', 'ReadonlyMap'].forEach((family) => {
    const method = family === 'Map' ? 'set' : 'get';
    const { collection = new Map() } = compile(source(family).replace("item.set('k', 1)", `item.${method}('k'${method === 'set' ? ', 1' : ''})`));
    assert.equal([...collection.values()].some(({ collection: { type = '' } = {} } = {}) => type === 'Map'), family === 'Map');
});
['type Neutral<K, V> = Map<K, V>', 'interface Neutral<K, V> extends Map<K, V> {}', 'type Neutral<K, V> = Map<K, V> & { marker: true }'].forEach((declaration) => {
    const { collection = new Map() } = compile(`${declaration}; ${source('Neutral')}`);
    assert.ok([...collection.values()].some(({ collection: { type = '' } = {} } = {}) => type === 'Map'));
});
const linter = new Linter();
const find = code => linter.verify(code, [{ plugins: { resilient }, rules: { 'resilient/prefer-safe-destructuring-defaults': 'error' } }]);
const nominal = 'const read = (opaque, A, isFunction) => { const { value, forest = [] } = opaque(); const { concat } = A.getIdentityProvider(); if '
    + '(!isFunction(concat)) return { value, forest: [] }; return opaque(); };';
const renamed = nominal.replaceAll('value', 'datum').replaceAll('forest', 'branches').replaceAll('concat', 'combine')
    .replaceAll('getIdentityProvider', 'provide').replaceAll('A', 'Provider').replaceAll('isFunction', 'callable');
[nominal, renamed].forEach((code) => {
    const messages = find(code);
    assert.ok(messages.some(({ messageId = '', column = 0 } = {}) => messageId === 'safeDefault' && column === code.indexOf(code === nominal ? 'value,' : 'datum,') + 1));
});
[
    'const read = input => { const isObject = () => true; const source = isObject(input) ? input : {}; if ((isObject(input) && '
        + 'Reflect.has(input, "value")) === false) {} const { value } = source; return value; };',
    'const read = input => { const isObject = () => true; const { value } = isObject(input) ? input : {}; if (!value) return { value }; return value; };'
].forEach(code => assert.ok(find(code).some(({ messageId = '' } = {}) => messageId === 'safeDefault')));
const behaviorSource = 'export const edit = (items: number[], offset: () => number, count: () => number) => { return items.splice(offset(), count()); }; export '
    + 'const order = (items: number[], compare: (a: number, b: number) => number) => { return items.sort(compare); };';
const { code: raw = '', collection: facts = new Map(), decisions = {} } = compile(behaviorSource);
assert.doesNotMatch(raw, /toSpliced|toSorted/u);
assert.ok([...facts.values()].every(({ theorem = '' } = {}) => theorem === 'source-collection-operation'));
assert.ok(decisions.byKind.get('collection-reconstruction').every(({ agreement: { action = '' } = {} } = {}) => action === 'retain-collection-boundary'));
const { outputText: original = '' } = typescript.transpileModule(behaviorSource,
    { compilerOptions: { target: typescript.ScriptTarget.ESNext, module: typescript.ModuleKind.ESNext } });
const fixedResult = linter.verifyAndFix(raw, [{ plugins: { resilient: { rules: { 'prefer-safe-transformations': mutations } } }, rules: { 'resilient/prefer-safe-transformations': 'error' } }]);
const load = code => import(`data:text/javascript,${encodeURIComponent(code)}`);
const { output: fixed = '', messages: fixedMessages = [] } = fixedResult;
assert.deepEqual(fixedMessages, []);
const modules = await Promise.all([original, raw, fixed].map(load));
const observe = ({ edit = false, order = false } = {}, mode = '') => {
    let events = [];
    const marker = new Error('exact thrown marker');
    const items = [3, 1, 2];
    const { splice: originalSplice = false } = Object(items);
    Object.defineProperty(items, 'splice', { get() {
        events = [...events, 'method'];

        if (mode === 'method-throw') throw marker;

        return function splice(...args) {
            events = [...events, this === items ? 'receiver' : 'wrong-receiver'];

            if (mode === 'call-throw') throw marker;

            return originalSplice.apply(this, args);
        };
    } });
    const offset = () => {
        events = [...events, 'offset'];

        if (mode === 'argument-throw') throw marker;

        return 1;
    };
    const count = () => {
        events = [...events, 'count'];

        return 1;
    };
    try {
        const removed = edit(items, offset, count);
        const sorted = order(items, (a, b) => a - b);

        return { items, removed, sameReceiver: sorted === items, events };
    } catch (error) {
        return { events, exactMarker: error === marker };
    }
};
['normal', 'method-throw', 'argument-throw', 'call-throw'].forEach((mode) => {
    const expected = observe(modules[0], mode);
    const { events: observedEvents = [], exactMarker = false } = expected;
    assert.deepEqual(observedEvents, { normal: ['method', 'offset', 'count', 'receiver'], 'method-throw': ['method'],
        'argument-throw': ['method', 'offset'], 'call-throw': ['method', 'offset', 'count', 'receiver'] }[mode]);

    if (mode === 'normal') assert.deepEqual(expected, { items: [2, 3], removed: [1], sameReceiver: true, events: ['method', 'offset', 'count', 'receiver'] });

    if (mode !== 'normal') assert.equal(exactMarker, true);

    modules.slice(1).forEach(module => assert.deepEqual(observe(module, mode), expected));
});
const resultModel = 'type Model<A> = { datum: A; children: A[] }; export const read = <A>(produce: () => Model<A>) => { const { datum, children = [] } = produce(); return { datum, children }; };';
const { code: modelCode = '', structural = new Map() } = compile(resultModel);
assert.ok([...structural.values()].some(({ property = '' } = {}) => property === 'datum'));
assert.match(modelCode, /datum = void 0/u);
const { code: authoredCode = '' } = compile(resultModel.replace('datum, children', 'datum = undefined, children'));
assert.match(authoredCode, /datum = undefined/u);
const reconstruct = 'type Model<A> = { peek: A; pos: number }; export const read = <A>(owner: Model<A>) => ({ peek: owner.peek, pos: owner.pos });';
const named = compile(reconstruct);
const neutralSource = reconstruct.replaceAll('peek', 'data').replaceAll('pos', 'loc').replaceAll('owner', 'input').replaceAll('Model', 'Thing');
const neutral = compile(neutralSource);
const serialize = value => JSON.stringify(value, (key, item) => {
    if (item instanceof Map || item instanceof Set) return [...item];

    return item;
});
const rename = value => serialize(value).replaceAll('peek', 'data').replaceAll('pos', 'loc');
const { structural: namedFacts = new Map(), decisions: namedDecisions = {}, code: namedCode = '' } = named;
const { structural: neutralFacts = new Map(), decisions: neutralDecisions = {}, code: neutralCode = '' } = neutral;
assert.ok(namedFacts.size > 0);
assert.equal(rename(namedFacts), serialize(neutralFacts), 'Equal-width coordinated names preserve complete source ranges and facts.');
assert.equal(rename(namedDecisions), serialize(neutralDecisions), 'Complete decisions preserve the same source ownership.');
const modelModes = await Promise.all([reconstruct, neutralSource].map(async (code, index) => {
    const emitted = index ? neutralCode : namedCode;
    const { output = '', messages = [] } = linter.verifyAndFix(emitted,
        [{ plugins: { resilient }, rules: { 'resilient/prefer-safe-destructuring-defaults': 'error' } }]);
    assert.deepEqual(messages, []);
    const { outputText = '' } = typescript.transpileModule(code,
        { compilerOptions: { target: typescript.ScriptTarget.ESNext, module: typescript.ModuleKind.ESNext } });

    return Promise.all([outputText, emitted, output].map(load));
}));
modelModes.forEach((variants, index) => {
    const fields = index ? ['data', 'loc'] : ['peek', 'pos'];
    const observeModel = ({ read = false } = {}, throwing = false) => {
        let events = [];
        const marker = new Error('field marker');
        const input = Object.fromEntries(fields.map(field => [field, 1]));
        fields.forEach(field => Object.defineProperty(input, field, { get() {
            events = [...events, field];

            if (throwing) throw marker;

            return 1;
        } }));
        try { return { result: read(input), events }; } catch (error) { return { events, exactMarker: error === marker }; }
    };
    [false, true].forEach((throwing) => {
        const [sourceModule = {}] = variants;
        const expected = observeModel(sourceModule, throwing);
        const { events = [], exactMarker = false } = expected;
        const [first = ''] = fields;
        assert.deepEqual(events, throwing ? [first] : fields);

        if (throwing) assert.equal(exactMarker, true);

        variants.slice(1).forEach(variant => assert.deepEqual(observeModel(variant, throwing), expected));
    });
});

const nativeLibrary = typescript.getDefaultLibFilePath({}).replace(/[^/]+$/u, '') + 'lib.authored.d.ts';
const { collection: authoredNativeFacts = new Map() } = compile(`import { Map } from '${nativeLibrary.replace(/\.d\.ts$/u, '')}'; ${source('Map')}`, {
    [nativeLibrary]: typescript.createSourceFile(nativeLibrary,
        '/// <reference no-default-lib="true"/>\nexport interface Map<K,V>{set(key:K,value:V):void}', typescript.ScriptTarget.ESNext, true)
});
assert.equal(authoredNativeFacts.size, 0);
[
    'first: effect() + input.first, second: input.second',
    'first: input.first + effect(), second: input.second',
    'first: () => input.first, second: () => input.second',
    'first: ((input: { first: number }) => input.first)({first: 1}), second: input.second',
    'second: input.second, first: input.first'
].forEach((members) => {
    const { structural: rejected = new Map() } = compile('declare const effect: () => number; '
        + `export const read = (input: { first: number; second: number }) => ({ ${members} });`);
    assert.equal(rejected.size, 0, members);
});
[
    '{ datum: A; children: A[]; extra?: number }',
    '{ datum: A; children: A[] } | { datum: A; children: A[]; extra: number }',
    '{ datum: A; children: A[]; [key: string]: unknown }',
    '{ datum?: A; children: A[] }'
].forEach((model) => {
    const { structural: rejected = new Map() } = compile(resultModel.replace('{ datum: A; children: A[] }', model));
    assert.equal(rejected.size, 0, model);
});
const siblingSource = 'export const edit=(items: number[], other: {splice:()=>number})=>{return [items.splice(0,1),other.splice()];};';
const { code: siblingRaw = '' } = compile(siblingSource);
const siblingMessages = linter.verify(siblingRaw, [{ plugins: { resilient: { rules: { 'prefer-safe-transformations': mutations } } },
    rules: { 'resilient/prefer-safe-transformations': 'error' } }]);
assert.equal(siblingMessages.length, 2, 'Retaining one call must not suppress a sibling operation.');

const collisionSource = 'export const edit=(item: {splice:()=>unknown;sort:()=>unknown})=>{item.splice();return item.sort();};';
const { code: collisionRaw = '', collection: collisionFacts = new Map() } = compile(collisionSource);
assert.equal(collisionFacts.size, 0);
assert.doesNotMatch(collisionRaw, /toSpliced|toSorted/u);
const { outputText: collisionOriginal = '' } = typescript.transpileModule(collisionSource,
    { compilerOptions: { target: typescript.ScriptTarget.ESNext, module: typescript.ModuleKind.ESNext } });
const collisionModules = await Promise.all([collisionOriginal, collisionRaw].map(load));
collisionModules.forEach(({ edit = false } = {}) => {
    let events = [];
    const marker = {};
    const item = { splice() { events = [...events, this === item ? 'splice' : 'wrong']; },
        sort() {
            events = [...events, this === item ? 'sort' : 'wrong'];

            return marker;
        } };
    assert.equal(edit(item), marker);
    assert.deepEqual(events, ['splice', 'sort']);
});
const collisionMessages = linter.verify(collisionRaw, [{ plugins: { resilient: { rules: { 'prefer-safe-transformations': mutations } } },
    rules: { 'resilient/prefer-safe-transformations': 'error' } }]);
assert.equal(collisionMessages.length, 2, 'Opaque collisions remain visible; no native collection fact authorizes an exemption.');

const nestedSource = 'export const edit=(items: Map<number,unknown>, other: {splice:()=>number})=>{return items.set(0,other.splice());};';
const { code: nestedRaw = '' } = compile(nestedSource);
const nestedMessages = linter.verify(nestedRaw, [{ plugins: { resilient: { rules: { 'prefer-safe-transformations': mutations } } },
    rules: { 'resilient/prefer-safe-transformations': 'error' } }]);
assert.deepEqual(nestedMessages.map(({ ruleId = '', severity = 0, messageId = '', line = 0, column = 0, endColumn = 0 } = {}) => [
    ruleId, severity, messageId, nestedRaw.split('\n')[line - 1].slice(column - 1, endColumn - 1)
]), [['resilient/prefer-safe-transformations', 2, 'mutation', 'other.splice()']],
'A retained native callee cannot suppress the exact unknown mutation in its argument.');
const nestedSuppressed = linter.getSuppressedMessages();
assert.equal(nestedSuppressed.length, 1, 'Only the checker-owned native callee is retained.');
assert.match(nestedSuppressed[0].message, /"items"/u);
assert.equal(nestedSuppressed[0].suppressions[0].justification, 'Source call retains receiver identity and native mutation.');
const callableModel = 'type Model<A>={peek:()=>A;pos:A}; export const read=<A>(input:Model<A>)=>({peek:input.peek,pos:input.pos});';
const { structural: callableFacts = new Map(), decisions: callableDecisions = {} } = compile(callableModel);
const { structural: renamedCallableFacts = new Map(), decisions: renamedCallableDecisions = {} }
    = compile(callableModel.replaceAll('peek', 'data').replaceAll('pos', 'loc').replaceAll('input', 'owner').replaceAll('Model', 'Thing'));
assert.equal(rename(callableFacts), serialize(renamedCallableFacts));
assert.equal(rename(callableDecisions), serialize(renamedCallableDecisions));
[
    'owner.pos=value',
    'owner.peek=owner.peek',
    '(owner.peek)()',
    'owner.peek`text`',
    'new owner.peek()'
].forEach((operation) => {
    const { structural: rejected = new Map() } = compile('type Model<A>={pos:A;peek:{():A;new():object;(strings:TemplateStringsArray):A}}; '
        + `export const read=<A>(owner:Model<A>,value:A)=>${operation};`);
    assert.equal(rejected.size, 0, 'A write or invocation is not a forwarded field value Get: ' + operation);
});

const deferredReceiverSource = 'type Cell<A>={read:(key:A)=>number;point:A}; '
    + 'export const preserve=<A>(owner:Cell<A>)=>({read:(key:A)=>owner.read(key),point:owner.point});';
const { code: deferredReceiverRaw = '' } = compile(deferredReceiverSource);
const { output: deferredReceiverFixed = '', messages: deferredReceiverMessages = [] } = linter.verifyAndFix(deferredReceiverRaw,
    [{ plugins: { resilient }, rules: { 'resilient/prefer-safe-destructuring-defaults': 'error', 'resilient/prefer-signature-destructuring': 'error' } }]);
assert.deepEqual(deferredReceiverMessages, []);
const { outputText: deferredReceiverOriginal = '' } = typescript.transpileModule(deferredReceiverSource,
    { compilerOptions: { target: typescript.ScriptTarget.ESNext, module: typescript.ModuleKind.ESNext } });
const deferredReceiverModules = await Promise.all([deferredReceiverOriginal, deferredReceiverRaw, deferredReceiverFixed].map(load));
deferredReceiverModules.forEach(({ preserve = false } = {}) => {
    ['normal', 'point-throw', 'read-throw'].forEach((mode) => {
        let events = [];
        const marker = new Error('deferred receiver marker');
        const owner = { get point() {
            events = [...events, 'point'];

            if (mode === 'point-throw') throw marker;

            return 1;
        }, get read() {
            events = [...events, 'read'];

            if (mode === 'read-throw') throw marker;

            return function read(key) {
                assert.equal(this, owner);
                events = [...events, 'receiver'];

                return key + 1;
            };
        } };

        if (mode === 'point-throw') {
            assert.throws(() => preserve(owner), error => error === marker);
            assert.deepEqual(events, ['point']);

            return;
        }

        const result = preserve(owner);
        const { point = 0 } = result;
        assert.equal(point, 1);
        assert.deepEqual(events, ['point'], 'The callable Get remains deferred until invocation.');

        if (mode === 'read-throw') assert.throws(() => result.read(2), error => error === marker);

        if (mode === 'normal') assert.equal(result.read(2), 3);

        assert.deepEqual(events, mode === 'read-throw' ? ['point', 'read'] : ['point', 'read', 'receiver']);
    });
});

const repeatedDeferredSource = 'type Cell<A>={read:()=>A;point:A}; '
    + 'export const preserve=<A>(owner:Cell<A>)=>({read:()=>owner.point,point:owner.point});';
const { code: repeatedDeferredRaw = '' } = compile(repeatedDeferredSource);
const { output: repeatedDeferredFixed = '', messages: repeatedDeferredMessages = [] } = linter.verifyAndFix(repeatedDeferredRaw,
    [{ plugins: { resilient }, rules: { 'resilient/prefer-safe-destructuring-defaults': 'error', 'resilient/prefer-signature-destructuring': 'error' } }]);
assert.deepEqual(repeatedDeferredMessages, []);
const { outputText: repeatedDeferredOriginal = '' } = typescript.transpileModule(repeatedDeferredSource,
    { compilerOptions: { target: typescript.ScriptTarget.ESNext, module: typescript.ModuleKind.ESNext } });
const repeatedDeferredModules = await Promise.all([repeatedDeferredOriginal, repeatedDeferredRaw, repeatedDeferredFixed].map(load));
repeatedDeferredModules.forEach(({ preserve = false } = {}) => {
    let events = [];
    const first = {};
    const second = {};
    const marker = new Error('repeated deferred marker');
    const owner = { get point() {
        events = [...events, 'point'];

        if (events.length === 3) throw marker;

        return events.length === 1 ? first : second;
    }, read() {} };
    const { point = false, read = false } = preserve(owner);
    assert.equal(point, first);
    assert.deepEqual(events, ['point']);
    assert.equal(read(), second);
    assert.deepEqual(events, ['point', 'point']);
    assert.throws(read, error => error === marker);
    assert.deepEqual(events, ['point', 'point', 'point']);
});

const templateSource = 'export const label = (items: number[], compare: (a:number,b:number)=>number, separator:()=>string) => '
    + '{ return `prefix:${items.sort(compare).join(separator())}:suffix`; };';
const { code: templateRaw = '', collection: templateFacts = new Map(), decisions: templateDecisions = {} } = compile(templateSource);
const renamedTemplateSource = templateSource.replaceAll('items', 'stock').replaceAll('label', 'stamp');
const { collection: renamedTemplateFacts = new Map(), decisions: renamedTemplateDecisions = {} } = compile(renamedTemplateSource);
assert.equal(serialize(templateFacts).replaceAll('items', 'stock').replaceAll('label', 'stamp'), serialize(renamedTemplateFacts));
assert.equal(serialize(templateDecisions).replaceAll('items', 'stock').replaceAll('label', 'stamp'), serialize(renamedTemplateDecisions));
assert.ok([...templateFacts.values()].some(({ collection: { expressionBoundary = false } = {} } = {}) => expressionBoundary));
const mutationProfile = [{ plugins: { resilient: { rules: { 'prefer-safe-transformations': mutations } } },
    rules: { 'resilient/prefer-safe-transformations': 'error' } }];
const { output: templateFixed = '', messages: templateMessages = [] } = linter.verifyAndFix(templateRaw, mutationProfile);
assert.deepEqual(templateMessages, []);
assert.doesNotMatch(templateRaw, /toSorted/u);
const { outputText: templateOriginal = '' } = typescript.transpileModule(templateSource,
    { compilerOptions: { target: typescript.ScriptTarget.ESNext, module: typescript.ModuleKind.ESNext } });
const templateModules = await Promise.all([templateOriginal, templateRaw, templateFixed].map(load));
let templateObservations = [];
templateModules.forEach(({ label = false } = {}) => {
    let observations = [];
    ['normal', 'sort-get', 'sort-call', 'index-get', 'compare', 'join-get', 'separator', 'join-call'].forEach((mode) => {
        let events = [];
        const marker = new Error('template exact marker');
        const items = [3, 1, 2];
        const result = [9];
        const step = (name) => {
            events = [...events, name];

            if (name === mode) throw marker;
        };

        if (mode === 'index-get') Object.defineProperty(items, '0', { get() { step('index-get');

            return 0; } });

        Object.defineProperty(items, 'sort', { get() {
            step('sort-get');

            return function sort(compare) {
                assert.equal(this, items);
                step('sort-call');
                Array.prototype.sort.call(this, compare);

                return result;
            };
        } });
        Object.defineProperty(result, 'join', { get() {
            step('join-get');

            return function join(separator) {
                assert.equal(this, result);
                assert.equal(separator, ', ');
                step('join-call');

                return 'joined';
            };
        } });
        const compare = (inbound, outbound) => {
            step('compare');

            return inbound - outbound;
        };
        const separator = () => {
            step('separator');

            return ', ';
        };

        if (mode === 'normal') {
            assert.equal(label(items, compare, separator), 'prefix:joined:suffix');
            assert.deepEqual(items, [1, 2, 3]);
        }

        if (mode !== 'normal') assert.throws(() => label(items, compare, separator), error => error === marker);

        const prefix = ['sort-get', 'sort-call', mode === 'index-get' ? 'index-get' : 'compare'];
        const expected = [...prefix, 'compare', 'compare', 'compare', 'join-get', 'separator', 'join-call'];
        // Exact complete traces are also compared across the three forms.
        assert.deepEqual(events.slice(0, Math.min(events.length, prefix.length)), prefix.slice(0, Math.min(events.length, prefix.length)));

        if (mode === 'normal') assert.deepEqual(events.filter(event => event !== 'compare'), expected.filter(event => event !== 'compare'));

        if (mode !== 'normal') assert.equal(events.at(-1), mode);

        observations = [...observations, { mode, events }];
    });
    templateObservations = [...templateObservations, observations];
});
assert.deepEqual(templateObservations[1], templateObservations[0]);
assert.deepEqual(templateObservations[2], templateObservations[0]);
const neighborSource = 'export const label=(items:number[],other:{sort:()=>string})=>`'
    + '${items.sort().join(",")}:${other.sort()}`;';
const { code: neighborRaw = '' } = compile(neighborSource);
const neighborMessages = linter.verify(neighborRaw, mutationProfile);
assert.equal(neighborMessages.length, 1);
assert.equal(neighborMessages[0].messageId, 'mutation');
assert.equal(neighborRaw.slice(neighborRaw.indexOf('other.sort'), neighborRaw.indexOf('other.sort') + 12), 'other.sort()');
assert.deepEqual(linter.getSuppressedMessages().map(({ messageId = '' } = {}) => messageId), ['mutation']);
assert.equal(linter.verify('const retain = input => { const { point = undefined } = input; return key => input.read(key); };',
    [{ plugins: { probe: { rules: { signature } } }, rules: { 'probe/signature': 'error' } }]).length, 0);

[
    '/* eslint-disable resilient/prefer-safe-transformations -- authored owner */ export const label=(items:number[],other:number[])=>'
        + '`' + '${items.sort().join(",")}:${other.splice(0,1)}`; /* eslint-enable resilient/prefer-safe-transformations */',
    'export const label=(items:number[])=>{\n// eslint-disable-next-line resilient/prefer-safe-transformations -- authored owner\n'
        + 'return `' + '${items.sort().join(",")}`;}',
    'export const label=(items:number[])=>{\nreturn `' + '${items.sort().join(",")}`; // eslint-disable-line resilient/prefer-safe-transformations -- authored owner\n}'
].flatMap(source => [source, source.replaceAll('resilient/prefer-safe-transformations -- authored owner',
    '"resilient/prefer-safe-transformations" --- authored owner'),
source.replaceAll('resilient/prefer-safe-transformations -- authored owner', ', , -- authored owner')]).forEach((source) => {
    const { code: retained = '' } = compile(source);
    const messages = linter.verify(retained, mutationProfile);
    assert.deepEqual(messages, [], 'An authored boundary retains its targets without a redundant generated scope.');
});

// A slice spelling is not freshness evidence. The public entry retains only
// checked array operations, and the exception owns that call rather than peers.
const sliceForms = [
    { parameter: 'values: number[]', body: 'values.slice().reverse()', native: true },
    { parameter: 'custom: { slice(): { reverse(): unknown } }', body: 'custom.slice().reverse()', native: false },
    { parameter: 'custom: any', body: 'custom.slice().reverse()', native: false }
];
// eslint-disable-next-line resilient/prefer-prototype-methods -- Await each module before observing the shared linter's next source form.
for (const form of sliceForms) {
    const { parameter = '', body = '', native = false } = form;
    const source = `export const run = (${parameter}) => ${body};`;
    const { code: emitted = '', collection = new Map() } = compile(source);
    assert.doesNotMatch(emitted, /fresh slice/u);
    assert.equal(collection.size, Number(native));
    assert.ok([...collection.values()].every(({ collection: { freshness = '' } = {} } = {}) => freshness === 'unknown'));
    const active = linter.verify(emitted, mutationProfile);
    assert.equal(active.length, Number(!native));
    assert.equal(linter.getSuppressedMessages().length, Number(native));
    const { output: fixed = '', messages = [] } = linter.verifyAndFix(emitted, mutationProfile);
    assert.equal(messages.length, Number(!native));
    const { outputText: original = '' } = typescript.transpileModule(source,
        { compilerOptions: { target: typescript.ScriptTarget.ESNext, module: typescript.ModuleKind.ESNext } });
    const variants = await Promise.all([original, emitted, fixed].map(load));
    ['normal', 'slice-get', 'slice-call', 'reverse-get', 'reverse-call'].forEach((mode) => {
        const observe = ({ run = false } = {}) => {
            let events = [];
            const marker = new Error(mode);
            const values = [3, 1, 2];
            const input = native ? values : { values };
            // Even a checked array can have a slice override returning itself.
            Object.defineProperty(input, 'slice', { get() {
                events = [...events, 'slice-get'];

                if (mode === 'slice-get') throw marker;

                return function slice() {
                    events = [...events, this === input ? 'slice-call' : 'wrong-receiver'];

                    if (mode === 'slice-call') throw marker;

                    return input;
                };
            } });
            Object.defineProperty(input, 'reverse', { get() {
                events = [...events, 'reverse-get'];

                if (mode === 'reverse-get') throw marker;

                return function reverse() {
                    events = [...events, this === input ? 'reverse-call' : 'wrong-receiver'];

                    if (mode === 'reverse-call') throw marker;

                    Array.prototype.reverse.call(values);

                    return this;
                };
            } });
            try { return { same: run(input) === input, values: [...values], events }; }
            catch (error) { return { exactMarker: error === marker, values: [...values], events }; }
        };
        const [reference = {}] = variants;
        const expected = observe(reference);
        const { events: expectedEvents = [], same = false, exactMarker = false } = expected;
        assert.deepEqual(expectedEvents, ['slice-get', 'slice-call', 'reverse-get', 'reverse-call'].slice(0,
            mode === 'normal' ? 4 : ['slice-get', 'slice-call', 'reverse-get', 'reverse-call'].indexOf(mode) + 1));
        assert.equal(mode === 'normal' ? same : exactMarker, true);
        variants.slice(1).forEach(variant => assert.deepEqual(observe(variant), expected));
    });
    variants.forEach(({ run = false } = {}) => {
        const values = Object.defineProperty([3, 1], 'length', { value: 3 });
        const result = run(values);
        assert.notEqual(result, values);
        assert.deepEqual([...values], [3, 1, undefined]);
        assert.deepEqual([...result], [undefined, 1, 3]);
        assert.deepEqual(Object.keys(values), ['0', '1']);
        assert.deepEqual(Object.keys(result), ['1', '2']);

        if (native) {
            let constructions = [];
            const input = [3, 1, 2];
            Object.defineProperty(input, 'constructor', { value: { [Symbol.species]: function Species(length) {
                constructions = [...constructions, length];

                return input;
            } } });
            assert.equal(run(input), input, 'Native slice species can return an existing array.');
            assert.deepEqual(input, [2, 1, 3]);
            assert.deepEqual(constructions, [3]);
        }
    });
}
// eslint-disable-next-line resilient/prefer-prototype-methods -- Await each emitted module after inspecting its shared-linter suppression targets.
for (const body of ['{ return values.slice().reverse(); }', '{ const result = values.slice().reverse(); return result; }',
    '{ values.slice().reverse(); }']) {
    const { code = '' } = compile(`export const run = (values: number[]) => ${body};`);
    assert.deepEqual(linter.verify(code, mutationProfile), []);
    assert.equal(linter.getSuppressedMessages().length, 1);
    const { run = false } = await load(code);
    assert.deepEqual(run([3, 1, 2]), body.includes('return') ? [2, 1, 3] : undefined);
}
const { code: siblingSlice = '' } = compile('export const run = (values: number[], other: any) => [values.slice().reverse(), other.reverse()];');
assert.equal(linter.verify(siblingSlice, mutationProfile).length, 1);
assert.equal(linter.getSuppressedMessages().length, 1);
const { code: nestedSlice = '' } = compile('export const run = (values: number[], other: any) => values.slice(other.reverse()).reverse();');
assert.equal(linter.verify(nestedSlice, mutationProfile).length, 2);
assert.equal(linter.getSuppressedMessages().length, 0);
// eslint-disable-next-line resilient/prefer-prototype-methods -- Await each native negative-end module before inspecting the next shared-linter target.
for (const body of ['values.slice(0, -1).reverse()', '[...values.slice(0, -1).reverse()]',
    'values.length === 1 ? values : [...values.slice(0, -1).reverse()]']) {
    const { code = '' } = compile(`export const run = (values: readonly number[]) => ${body};`);
    assert.deepEqual(linter.verify(code, [...mutationProfile, { rules: { 'max-len': ['error', { code: 200 }] } }]), []);
    assert.equal(linter.getSuppressedMessages().length, 1);
    const { run = false } = await load(code);
    assert.deepEqual(run([1, 2, 3]), [2, 1]);
    const single = [1];
    assert.deepEqual(run(single), body.includes('length') ? single : []);
}
const { collection: updateSliceFacts = new Map() } = compile(
    'export const run = (values: number[], start: number) => values.slice(++start).reverse();'
);
assert.equal(updateSliceFacts.size, 1);
assert.ok([...updateSliceFacts.values()].every(({ collection: { annotationOwned = true } = {} } = {}) => !annotationOwned));
const { code: optionalSlice = '', collection: optionalSliceFacts = new Map() } = compile(
    'export const run = (values: number[] | undefined) => values?.slice().reverse();'
);
assert.equal(optionalSliceFacts.size, 0);
assert.equal(linter.verify(optionalSlice, mutationProfile).length, 1);
const { code: uncheckedSlice = '' } = createTypeScriptTransformer({ typescript }).transform({
    code: 'export const run = (values: number[]) => values.slice().reverse();'
});
assert.equal(linter.verify(uncheckedSlice, mutationProfile).length, 1, 'Unchecked syntax cannot borrow array evidence.');
const recipeSource = 'export const run = (values: Map<string, number>) => { const result = new Map(values); result.set("x", 1); return result; };';
const { code: recipe = '', collection: recipeFacts = new Map() } = compile(recipeSource);
assert.ok([...recipeFacts.values()].some(({ collection: { freshness = '' } = {} } = {}) => freshness === 'copy'));
assert.deepEqual(linter.verify(recipe, mutationProfile), []);
const { output: recipeFixed = '' } = linter.verifyAndFix(recipe, mutationProfile);
const { outputText: recipeOriginal = '' } = typescript.transpileModule(recipeSource,
    { compilerOptions: { target: typescript.ScriptTarget.ESNext, module: typescript.ModuleKind.ESNext } });
// eslint-disable-next-line resilient/prefer-prototype-methods -- Await each source/raw/fixed module before checking its fresh result identity.
for (const code of [recipeOriginal, recipe, recipeFixed]) {
    const { run = false } = await load(code);
    const input = new Map([['a', 2]]);
    const result = run(input);
    assert.notEqual(result, input);
    assert.deepEqual([...input], [['a', 2]]);
    assert.deepEqual([...result], [['a', 2], ['x', 1]]);
}
