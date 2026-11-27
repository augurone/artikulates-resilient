import { deepStrictEqual, strictEqual, ok, throws } from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

import { ESLint, Linter } from 'eslint';
import { parse } from 'espree';

import { all, createOwner, familyEvidence, field, isCurrent, producer, readField, record, replaceEvidence, request, unresolved } from 'eslint-plugin-resilient/agreement';
import { createAnalysis, createProgramAnalysis } from 'eslint-plugin-resilient/analyzer';
import plugin from 'eslint-plugin-resilient/eslint';

import { counter } from './support/work.js';

// Owned field/slot selection, presence, writer order and completion share the shape boundary. Preserve explicit unknown selections, native controls, revisions and resource/retention laws.

{
    test('native function namespaces allow prototype selection without changing callable evidence', () => {
        const source = 'const Native=Object;const {prototype:{hasOwnProperty:has}}=Native;'
            + 'const {prototype:{map}}=Array;const {keys}=Object;';
        const analysis = createAnalysis({ source });
        const results = analysis.destructurings.map(({ index = -1 } = {}) => analysis.checkDestructuring({ index }));

        deepStrictEqual(results.map(({ status = '' } = {}) => status), ['agreement', 'agreement', 'agreement']);
        results.forEach(({ fact: { families = [] } = {} } = {}) => deepStrictEqual(families, ['function']));
        strictEqual(runInNewContext(`${source}has.call({x:1},"x")&&map.call([1],x=>x+1)[0]===2&&keys({x:1})[0]==="x";`), true);

        const shadowed = createAnalysis({ source: 'const Object=()=>0;const {prototype}=Object;' });
        const { status = '', fact: { families = [] } = {} } = shadowed.checkDestructuring({ index: 0 });

        strictEqual(status, 'contradiction');
        deepStrictEqual(families, ['function']);
    });

    test('presence judgments preserve unknown writers and known fields independently', () => {
        const source = 'const { a, b, c } = { a: 1, ...external, b: 2, [key]: 3, c: 4 };';
        const analysis = createAnalysis({ source });
        const { destructuringFields = [] } = analysis;
        const results = destructuringFields.map(({ index = -1 } = {}) => analysis.checkDestructuringField({ index }));

        deepStrictEqual(results.map(({ status = '' } = {}) => status), ['agreement', 'agreement', 'agreement']);
        deepStrictEqual(results.map(({ fact: { presence = [] } = {} } = {}) => presence), [['present'], ['present'], ['present']]);
    });

    test('field demand reuses root and named facts without inferring values', () => {
        const analysis = createAnalysis({ source: 'const { a: first, a: second, missing } = { a: 42, unused: { nested: external } };' });
        const work = counter();
        const root = analysis.checkDestructuring({ index: 0, onWork: event => work.onWork(event) });
        const first = analysis.checkDestructuringField({ index: 0, onWork: event => work.onWork(event) });
        const second = analysis.checkDestructuringField({ index: 1, onWork: event => work.onWork(event) });
        const missing = analysis.checkDestructuringField({ index: 2, onWork: event => work.onWork(event) });
        const { status = '', fact = {}, family = {} } = first;
        const { presence = [] } = fact;
        const { fact: secondFact = {} } = second;
        const { status: missingStatus = '' } = missing;
        const { fact: rootFact = {} } = root;
        const { destructuringFields = [] } = analysis;

        strictEqual(status, 'agreement');
        strictEqual(missingStatus, 'contradiction');
        strictEqual(fact, secondFact);
        strictEqual(family, rootFact);
        strictEqual(work.get('establishment'), 3);
        strictEqual(work.get('field-lookup'), 2);
        strictEqual(work.get('field-index-entry'), 2);
        strictEqual(work.get('literal-classification'), 0);
        strictEqual(analysis.checkDestructuringField({ index: 0, onWork: event => work.onWork(event) }).fact, fact);
        strictEqual(work.get('establishment'), 3);
        strictEqual(work.get('field-index-entry'), 2);
        deepStrictEqual(Object.keys(fact), ['facet', 'state', 'reason', 'presence', 'causes', 'causesTruncated']);
        [first, fact, presence, family, destructuringFields, ...destructuringFields].forEach(value => ok(Object.isFrozen(value)));
        [-1, 3, NaN, '0'].forEach(index => throws(() => analysis.checkDestructuringField({ index }), RangeError));
        throws(() => analysis.checkDestructuringField({ index: 0, onWork: () => { throw new Error('observer failed'); } }), /observer failed/);
    });

    test('field snapshots detach key evidence and locations from the host AST', () => {
        const source = 'const {\n missing: item\n} = { present: 1 };';
        const program = parse(source, { ecmaVersion: 'latest', sourceType: 'module', range: true, loc: true });
        const pristine = structuredClone(program);
        const analysis = createProgramAnalysis({ program });
        const { destructuringFields: [{ location = {} } = {}] = [] } = analysis;
        const { body: [{ declarations: [{ init: { properties: [{ key = {} } = {}] = [] } = {} } = {}] = [] } = {}] = [] } = program;

        deepStrictEqual(structuredClone(program), pristine);
        deepStrictEqual(location, { range: [9, 16], line: 2, column: 2 });
        Object.defineProperty(key, 'name', { value: 'missing' });
        strictEqual(analysis.checkDestructuringField({ index: 0 }).status, 'contradiction');
        strictEqual(createProgramAnalysis({ program }).checkDestructuringField({ index: 0 }).status, 'agreement');
    });

    test('unsupported property ownership retains unknown presence queries', () => {
        [
            'const source = {}; external(source); const { missing } = source;',
            'const { [key]: item, missing } = {};',
            'const { first, missing } = { get first() { return 0; } };',
            'const { missing } = { __proto__: external };'
        ].forEach((source) => {
            const analysis = createAnalysis({ source });
            const { destructuringFields = [] } = analysis;

            destructuringFields.forEach(({ index = -1, name = '' } = {}) => strictEqual(analysis.checkDestructuringField({ index }).status, name === 'first' ? 'agreement' : 'unknown'));
        });
    });

    test('root-only demand leaves the record layout and all property values uninferred', () => {
        const analysis = createAnalysis({ source: 'const { a } = { a: 42, unused: external };' });
        const work = counter();

        strictEqual(analysis.checkDestructuring({ index: 0, onWork: event => work.onWork(event) }).status, 'agreement');
        strictEqual(work.get('establishment'), 1);
        strictEqual(work.get('field-index-entry'), 0);
        strictEqual(work.get('field-lookup'), 0);
        strictEqual(work.get('literal-classification'), 0);
    });

    test('field lint consumes host AST evidence and propagates source failures', async () => {
        const engine = new ESLint({ overrideConfigFile: true, overrideConfig: [{
            plugins: { resilient: plugin }, rules: { 'resilient/signature-contract-destructuring': 'error' },
            languageOptions: { parser: { parseForESLint(source, options) {
                return { ast: parse(source.replace('known: 0', 'other: 0'), options) };
            } } }
        }] });
        const [{ messages = [] } = {}] = await engine.lintText('const { known } = { known: 0 };');

        strictEqual(messages.length, 1);
        strictEqual(messages.at(0).messageId, 'missingProperty');

        const program = parse('const { a } = { a: 0 };', { ecmaVersion: 'latest', sourceType: 'module' });
        const { body: [{ declarations: [{ init: { properties: [{ key = {} } = {}] = [] } = {} } = {}] = [] } = {}] = [] } = program;
        const failure = new Error('owned key read failed');

        Object.defineProperty(key, 'name', { get() { throw failure; } });
        throws(() => createProgramAnalysis({ program }), error => error === failure);
    });
}

{
    test('pattern values and fields preserve revisions and query order', () => {
        const source = 'const make=()=>({data:{other:42}});const read=()=>{const {data:{missing}}=make();return missing;};read();';
        const program = parse(source, { ecmaVersion: 'latest', sourceType: 'module', range: true, loc: true });
        const first = createProgramAnalysis({ program });
        const second = createAnalysis({ source });
        const { calls = [], destructuringFields = [] } = first;
        const before = destructuringFields.map(({ index = -1 } = {}) => first.checkDestructuringField({ index }));

        calls.toReversed().forEach(({ index = -1 } = {}) => second.checkCallResult({ index, required: 'number' }));
        deepStrictEqual(destructuringFields.map(({ index = -1 } = {}) => second.checkDestructuringField({ index })), before);
        const { body: [{ declarations: [{ init: { body: { properties: [{ value: { properties: [{ key = {} } = {}] = [] } = {} } = {}] = [] } = {} } = {} } = {}] = [] } = {}] = [] } = program;

        Object.defineProperty(key, 'name', { value: 'missing' });
        const changed = createProgramAnalysis({ program });

        strictEqual(changed.checkDestructuringField({ index: 1 }).status, 'agreement');
        deepStrictEqual(destructuringFields.map(({ index = -1 } = {}) => first.checkDestructuringField({ index })), before);
    });
}

{
    const resultFor = ({ calls = [], checkCallResult } = {}, required = 'array', options = {}) => {
        if (typeof checkCallResult !== 'function') throw new TypeError('Expected an analysis result query');

        const { index = -1 } = calls.find(({ callee = '' } = {}) => callee === 'read') ?? {};

        return checkCallResult({ index, required, ...options });
    };
    const lint = source => new Linter().verify(source, {
        plugins: { resilient: plugin }, rules: {
            'resilient/signature-contract-call-site': 'error', 'resilient/signature-contract-operation': 'error', 'resilient/signature-contract-property': 'error'
        }
    });

    test('unknown alternatives retain both the known family and incompleteness', () => {
        const source = 'const read=()=>{const [items]=flag?[""]:external;return items;};read();';
        const { status = '', fact: { families = [], incomplete = false } = {} } = resultFor(createAnalysis({ source }));

        strictEqual(status, 'contradiction');
        deepStrictEqual(families, ['string']);
        strictEqual(incomplete, true);
    });

    test('an unresolved slot preserves both truth branches', () => {
        const source = 'const read=()=>{const [value]=external;return value?[]:{};};read();';
        const { status = '', fact: { families = [] } = {} } = resultFor(createAnalysis({ source }));

        strictEqual(status, 'contradiction');
        deepStrictEqual(families.toSorted(), ['array', 'object']);
    });

    test('an unresolved slot preserves a possible nullish fallback', () => {
        const source = 'const read=()=>{const [value]=external;return value??[];};read();';
        const { fact: { families = [], incomplete = false } = {} } = resultFor(createAnalysis({ source }));

        deepStrictEqual(families, ['array']);
        strictEqual(incomplete, true);
    });

    test('slot selection survives observer interruption, query reordering and warm reuse', () => {
        const source = 'const need=(items=[])=>items;const read=()=>{const [items]=flag?[""]:external;need(items);return items;};read();';
        const analysis = createAnalysis({ source });
        const work = counter();
        const expected = resultFor(analysis, 'array', { onWork: event => work.onWork(event) });

        Object.keys(work.read()).forEach((stage) => {
            const interrupted = createAnalysis({ source });

            throws(() => resultFor(interrupted, 'array', { onWork: ({ kind = '' } = {}) => {
                if (kind === stage) throw new Error(`interrupt ${stage}`);
            } }), new RegExp(`interrupt ${stage}`, 'u'));
            deepStrictEqual(resultFor(interrupted), expected);
        });
        const reordered = createAnalysis({ source });

        reordered.functions.toReversed().forEach(({ index = -1 } = {}) => reordered.checkFunction({ index }));
        reordered.calls.toReversed().forEach(({ index = -1 } = {}) => reordered.checkCall({ index }));
        deepStrictEqual(resultFor(reordered), expected);
        const { counts = {} } = analysis;
        const before = work.read();

        deepStrictEqual(resultFor(analysis, 'array', { onWork: event => work.onWork(event) }), expected);
        const { counts: repeated = {} } = analysis;

        deepStrictEqual(repeated, counts);
        strictEqual(work.get('value-selection'), Reflect.get(before, 'value-selection'));
    });

    test('retained sessions own slot evidence across host AST revisions', () => {
        const program = parse('const read=()=>{const [items]=[""];return items;};read();', { ecmaVersion: 'latest', sourceType: 'module', range: true, loc: true });
        const original = createProgramAnalysis({ program });
        const expected = resultFor(original);
        const { body: [{ declarations: [{ init: { body: { body: [{ declarations: [{ init: { elements: [slot = {}] = [] } = {} } = {}] = [] } = {}] = [] } = {
        } } = {} } = {}] = [] } = {}] = [] } = program;

        Object.defineProperty(slot, 'value', { value: 42 });
        const revised = createProgramAnalysis({ program });

        strictEqual(resultFor(revised, 'number').status, 'agreement');
        deepStrictEqual(resultFor(original), expected);
        deepStrictEqual(resultFor(original).fact.families, ['string']);
    });

    test('runtime counterexamples justify iterator and nested-pattern exclusions', () => {
        const custom = 'const tuple=[""];tuple[Symbol.iterator]=function*(){yield [];};const [items]=tuple;items;';
        const nested = 'const [{x},items]=[null,""];items;';
        const getter = 'const state={items:""};const [{x},items]=[{get x(){state.items=[];}},state];items.items;';

        ok(Array.isArray(runInNewContext(custom)));
        throws(() => runInNewContext(nested), { name: 'TypeError' });
        ok(Array.isArray(runInNewContext(getter)));
        deepStrictEqual(lint(`${custom}items.map(value=>value);`), []);
    });

    test('live positional queries release host nodes before and after demand', () => {
        const { execPath = '' } = process;
        const source = `
        import {parse,VisitorKeys} from 'espree';
        import {setImmediate} from 'node:timers/promises';
        import {createProgramAnalysis} from 'eslint-plugin-resilient/analyzer';
        const acquire=()=>{
            const program=parse('const read=([items=[]]=[])=>{const [other]=[items];return other;};read([42]);',
                {ecmaVersion:'latest',sourceType:'module',range:true,loc:true});
            const pending=[program],references=[];
            while(pending.length){const node=pending.pop();references.push(new WeakRef(node));
                node.host={program};references.push(new WeakRef(node.host));
                for(const key of VisitorKeys[node.type]||[]){const value=node[key];
                    if(Array.isArray(value))pending.push(...value.filter(Boolean));else if(value)pending.push(value);}}
            return {analysis:createProgramAnalysis({program}),references};
        };
        const {analysis,references}=acquire();
        const collect=async()=>{for(let turn=0;turn<5;turn++){await setImmediate();globalThis.gc();}};
        await collect();const before=references.filter(ref=>ref.deref()).length;
        const result=analysis.checkCallResult({index:0,required:'array'});
        await collect();console.log(JSON.stringify({before,after:references.filter(ref=>ref.deref()).length,
            sampled:references.length,status:result.status}));
    `;
        const result = JSON.parse(execFileSync(execPath, ['--expose-gc', '--input-type=module', '-e', source], { encoding: 'utf8', timeout: 30000 }));
        const { before = -1, after = -1, sampled = 0, status = '' } = result;

        strictEqual(before, 0);
        strictEqual(after, 0);
        ok(sampled > 40);
        strictEqual(status, 'contradiction');
    });
}

{
    const resultFor = ({ calls = [], checkCallResult } = {}, options = {}) => {
        if (typeof checkCallResult !== 'function') throw new TypeError('Expected an analysis result query');

        const { index = -1 } = calls.find(({ callee = '' } = {}) => callee === 'read') ?? {};

        return checkCallResult({ index, required: 'array', ...options });
    };
    const lint = source => new Linter().verify(source, { plugins: { resilient: plugin }, rules: {
        'resilient/signature-contract-call-site': 'error', 'resilient/signature-contract-operation': 'error', 'resilient/signature-contract-property': 'error',
        'resilient/signature-contract-return-consistency': 'error'
    } });

    [
        ['selected string', 'const [items]=[""];', 'items', 'string'],
        ['unused binding', 'const [unused]=[0];', '""', 'string'],
        ['empty pattern', 'const []=[];', '""', 'string'],
        ['elisions', 'const [,,]=[,];', '""', 'string'],
        ['absent default', 'const [items=[]]=[];', 'items', 'array'],
        ['hole default', 'const [items=[]]=[,];', 'items', 'array'],
        ['explicit undefined default', 'const [items=[]]=[undefined];', 'items', 'array'],
        ['null does not default', 'const [items=[]]=[null];', 'items', 'nullish'],
        ['false does not default', 'const [items=[]]=[false];', 'items', 'boolean'],
        ['zero does not default', 'const [items=[]]=[0];', 'items', 'number'],
        ['declarator sequence', 'const [first]=[0],[items]=[""];', 'items', 'string'],
        ['returned array', 'const make=()=>[""];const [items]=make();', 'items', 'string'],
        ['local forwarding', 'const echo=value=>value;const [items]=echo([""]);', 'items', 'string'],
        ['named carrier', 'const tuple=[""];const [items]=tuple;', 'items', 'string']
    ].forEach(([name = '', body = '', returned = '', family = ''] = []) => test(`flat pattern completion: ${name}`, () => {
        const source = `const read=()=>{try{${body}return ${returned};}catch{return {};}};read();`;
        const { fact: { families = [], incomplete = false } = {}, normal = false, thrown = true } = resultFor(createAnalysis({ source }));
        const runtime = runInNewContext(source);
        const present = Array.isArray(runtime) ? 'array' : typeof runtime;
        const actual = runtime === null ? 'nullish' : present;

        strictEqual(actual, family);
        deepStrictEqual(families, [family]);
        strictEqual(incomplete, false);
        strictEqual(normal, true);
        strictEqual(thrown, false);
    }));

    test('known guarded completion survives an unknown iterator alternative', () => {
        const definition = 'const read=(flag,input)=>{try{const [items]=flag?[""]:input;return items;}catch{return [];}};';
        const source = `${definition} read(external,external); read(true,{});`;
        const analysis = createAnalysis({ source });
        const { status = '', fact: { families = [], incomplete = false } = {} } = resultFor(analysis);
        const native = Array.from(runInNewContext(`${definition}
            [read(true, {}), read(false, {}), read(false, [42])].map(value => Object.prototype.toString.call(value));`));

        deepStrictEqual(native, ['[object String]', '[object Array]', '[object Number]']);
        strictEqual(status, 'contradiction');
        deepStrictEqual(families.toSorted(), ['array', 'string'], 'Known try and handler results survive beside unknown iterator values');
        strictEqual(incomplete, true);
        const { calls = [] } = analysis;
        const { index = -1 } = calls.findLast(({ callee = '' } = {}) => callee === 'read') ?? {};
        const { fact: { families: selected = [], incomplete: partial = true } = {} } = analysis.checkCallResult({ index, required: 'array' });

        deepStrictEqual(selected, ['string'], 'Selecting the known array excludes failure of the unused iterator input');
        strictEqual(partial, false);
    });

    test('distinct native arrays share completion without requiring identical slots', () => {
        const source = 'const read=(flag=false)=>{try{const [items]=flag?[""]:[[]];return items;}catch{return {};}};read(true);';
        const analysis = createAnalysis({ source });
        const { fact: { families = [] } = {}, thrown = true } = resultFor(analysis);

        deepStrictEqual(families, ['string']);
        strictEqual(thrown, false);
        const { fact: { families: generic = [] } = {} } = analysis.checkFunction({ index: 0 });

        deepStrictEqual(generic.toSorted(), ['array', 'string']);
    });

    test('a selected unknown value still has known iteration completion', () => {
        const source = 'const read=input=>{try{const [items]=[input];return items?[]:"";}catch{return {};}};read(false);';

        deepStrictEqual(resultFor(createAnalysis({ source })).fact.families, ['string']);
    });

    test('initializer failure reaches catch and preserves prior call obligations', () => {
        const source = 'const need=(items=[])=>items;const fail=()=>{need("");throw 0;};const read=()=>{try{const [items]=fail();return "";}catch{return [];}};read();';
        const analysis = createAnalysis({ source });

        strictEqual(resultFor(analysis).status, 'agreement');
        const { index = -1 } = analysis.calls.find(({ callee = '' } = {}) => callee === 'read') ?? {};
        const { obligations = [] } = analysis.checkCall({ index });

        ok(obligations.some(({ status = '' } = {}) => status === 'contradiction'));
    });

    test('initializer uncertainty is not erased by the resulting native array', () => {
        const source = 'const read=()=>{try{const [items]=[external()];return "";}catch{return [];}};read();';

        strictEqual(resultFor(createAnalysis({ source })).status, 'unknown');
    });

    test('finalizers replace completion but retain reached obligations', () => {
        const source = 'const need=(items=[])=>items;const read=()=>{try{const [items]=[""];need(items);return items;}finally{return [];}};read();';
        const analysis = createAnalysis({ source });

        strictEqual(resultFor(analysis).status, 'agreement');
        strictEqual(lint(source).filter(({ ruleId = '' } = {}) => ruleId === 'resilient/signature-contract-call-site').length, 1);
    });

    test('a native callback retains a completed pattern return', () => {
        const source = 'const need=(items=[])=>items;[0].forEach(()=>{const read=()=>{try{const [items]=[""];return items;}catch{return [];}};need(read());});';

        deepStrictEqual(lint(source).map(({ ruleId = '' } = {}) => ruleId), ['resilient/signature-contract-call-site']);
    });

    test('pattern completion preserves query order, warm reuse and interrupted retry', () => {
        const source = 'const read=(flag,input)=>{try{const [items]=flag?[""]:input;return items;}catch{return [];}};read(true,[]);';
        const analysis = createAnalysis({ source });
        const work = counter();
        const expected = resultFor(analysis, { onWork: event => work.onWork(event) });

        Object.keys(work.read()).forEach((stage) => {
            const interrupted = createAnalysis({ source });

            throws(() => resultFor(interrupted, { onWork: ({ kind = '' } = {}) => {
                if (kind === stage) throw new Error(`interrupt ${stage}`);
            } }), new RegExp(`interrupt ${stage}`, 'u'));
            deepStrictEqual(resultFor(interrupted), expected);
        });
        const reordered = createAnalysis({ source });

        reordered.functions.toReversed().forEach(({ index = -1 } = {}) => reordered.checkFunction({ index }));
        reordered.calls.toReversed().forEach(({ index = -1 } = {}) => reordered.checkCall({ index }));
        deepStrictEqual(resultFor(reordered), expected);
        const { counts = {} } = analysis;
        const cold = work.read();

        deepStrictEqual(resultFor(analysis, { onWork: event => work.onWork(event) }), expected);
        const { counts: repeated = {} } = analysis;

        deepStrictEqual(repeated, counts);
        strictEqual(work.get('value-selection'), Reflect.get(cold, 'value-selection'));
    });

    test('retained pattern completion survives an independent source revision', () => {
        const program = parse('const read=()=>{try{const [items]=[""];return items;}catch{return [];}};read();',
            { ecmaVersion: 'latest', sourceType: 'module', range: true, loc: true });
        const original = createProgramAnalysis({ program });
        const expected = resultFor(original);
        const { body: [{ declarations: [{ init: { body: { body: [statement = {}] = [] } = {} } = {} } = {}] = [] } = {}] = [] } = program;
        const { block: { body: [{ declarations: [{ init: { elements: [slot = {}] = [] } = {} } = {}] = [] } = {}] = [] } = {} } = statement;

        Object.defineProperty(slot, 'value', { value: 42 });
        const revised = createProgramAnalysis({ program });

        deepStrictEqual(resultFor(revised).fact.families, ['number']);
        deepStrictEqual(resultFor(original), expected);
    });

    test('live completion sessions release pattern syntax before and after demand', () => {
        const { execPath = '' } = process;
        const source = `
        import {parse,VisitorKeys} from 'espree';
        import {setImmediate} from 'node:timers/promises';
        import {createProgramAnalysis} from 'eslint-plugin-resilient/analyzer';
        const acquire=()=>{
            const program=parse('const read=()=>{try{const [items]=[42];return items;}catch{return [];}};read();',
                {ecmaVersion:'latest',sourceType:'module',range:true,loc:true});
            const pending=[program],references=[];
            while(pending.length){const node=pending.pop();references.push(new WeakRef(node));node.host={program};references.push(new WeakRef(node.host));
                for(const key of VisitorKeys[node.type]||[]){const value=node[key];
                    if(Array.isArray(value))pending.push(...value.filter(Boolean));else if(value)pending.push(value);}}
            return {analysis:createProgramAnalysis({program}),references};
        };
        const {analysis,references}=acquire();
        const collect=async()=>{for(let turn=0;turn<5;turn++){await setImmediate();globalThis.gc();}};
        await collect();const before=references.filter(ref=>ref.deref()).length;
        const result=analysis.checkCallResult({index:0,required:'array'});
        await collect();console.log(JSON.stringify({before,after:references.filter(ref=>ref.deref()).length,status:result.status}));
    `;
        const result = JSON.parse(execFileSync(execPath, ['--expose-gc', '--input-type=module', '-e', source], { encoding: 'utf8', timeout: 30000 }));

        deepStrictEqual(result, { before: 0, after: 0, status: 'contradiction' });
    });
}

{
    const own = evidence => createOwner({ evidence });
    const number = own(familyEvidence({ name: 'number' }));
    const string = own(familyEvidence({ name: 'string' }));
    const known = owner => own(record({ fields: [{ name: 'name', owner }] }));
    const required = field({ name: 'name', required: 'string' });
    const status = owner => request({ owner, required }).status;
    const resultStatus = ({ status = '' } = {}) => status;

    test('record copy preserves demanded supplied fields, writer order, and rest exclusions', () => {
        const original = known(number);
        const empty = own(record());
        const copied = own(record({ source: original }));
        const retained = own(record({ source: empty, base: copied }));
        const overwritten = own(record({ source: known(string), base: retained }));
        const excluded = own(record({ source: copied, excluded: ['name'] }));
        const restored = own(record({ source: copied, excluded: ['name'], fields: [{ name: 'name', owner: string }] }));

        strictEqual(status(copied), 'contradiction');
        strictEqual(status(retained), 'contradiction');
        strictEqual(status(overwritten), 'agreement');
        strictEqual(status(restored), 'agreement');
        deepStrictEqual(readField({ owner: excluded, name: 'name' }).cases.map(({ state = '' } = {}) => state), ['absent']);
    });

    test('an unknown copied writer can replace a value without removing established presence', () => {
        const original = known(number);
        const unknown = own(unresolved());
        const overwritten = own(record({ source: unknown, base: original }));
        const alternatives = own(record({ source: own(producer({ owners: [original, unknown] })) }));

        strictEqual(status(overwritten), 'unknown');
        strictEqual(request({ owner: overwritten, required: field({ name: 'name', required: all() }) }).status, 'agreement');
        strictEqual(status(alternatives), 'contradiction');
        ok(readField({ owner: alternatives, name: 'name' }).cases.some(({ state = '' } = {}) => state === 'unknown'));
    });

    test('open copy layers preserve unknown presence beside supplied and excluded fields', () => {
        const base = known(number);
        const empty = own(record());
        const copy = own(record({ base, source: empty, open: true, excluded: ['excluded'] }));
        const inherited = own(record({ base: empty, open: true }));

        strictEqual(status(copy), 'contradiction');
        deepStrictEqual(readField({ owner: copy, name: 'other' }).cases, [{ state: 'unknown' }]);
        deepStrictEqual(readField({ owner: inherited, name: 'other' }).cases, [{ state: 'unknown' }]);
        deepStrictEqual(readField({ owner: copy, name: 'excluded' }).cases, [{ state: 'absent' }]);
    });

    test('primitive copy alternatives preserve prior fields through producer joins and revisions', () => {
        const primitive = own(familyEvidence({ name: 'boolean' }));
        const supplied = known(string);
        const choices = own(producer({ owners: [primitive, supplied] }));
        const copied = own(record({ base: known(number), source: choices }));
        const joined = own(producer({ owners: [primitive, copied] }));
        const before = request({ owner: copied, required });

        strictEqual(resultStatus(before), 'contradiction');
        strictEqual(status(joined), 'contradiction', 'Ordinary and copied views of the same owner retain separate identities');
        replaceEvidence({ owner: primitive, evidence: record({ fields: [{ name: 'name', owner: string }] }) });
        strictEqual(isCurrent(before), false);
        strictEqual(status(copied), 'agreement');
        replaceEvidence({ owner: primitive, evidence: familyEvidence({ name: 'number' }) });
        strictEqual(status(copied), 'contradiction');
        strictEqual(readField({ owner: primitive, name: 'name' }).cases.some(({ state = '' } = {}) => state === 'unknown'), true,
            'Copy facets must not change an ordinary property query');
    });

    test('copying a borrowed field preserves its family without inventing nested ownership', () => {
        const child = known(number);
        const source = own(record({ fields: [{ name: 'child', owner: child }, { name: 'name', owner: number }] }));
        const copy = own(record({ source, retire: true }));

        strictEqual(status(copy), 'contradiction');
        strictEqual(request({ owner: copy, required: field({ name: 'child', required: 'object' }) }).status, 'agreement');
        strictEqual(request({ owner: copy, required: field({ name: 'child', required }) }).status, 'unknown');
    });

    test('retired field provenance survives successive copies and follows source revisions', () => {
        const source = known(number);
        const copied = own(record({ source, retire: true }));
        const repeated = own(record({ source: copied, retire: true }));
        const before = request({ owner: repeated, required });
        const { cases: [{ source: original = false, projection = '' } = {}] = [] } = readField({ owner: repeated, name: 'name' });

        strictEqual(original, number);
        strictEqual(projection, 'family');
        strictEqual(resultStatus(before), 'contradiction');
        replaceEvidence({ owner: source, evidence: record({ fields: [{ name: 'name', owner: string }] }) });
        strictEqual(isCurrent(before), false);
        strictEqual(status(repeated), 'agreement');
        const { cases: [{ source: revised = false } = {}] = [] } = readField({ owner: repeated, name: 'name' });

        strictEqual(revised, string);
    });

    test('copied-field judgments retain revisions and retry after interrupted demand', () => {
        const source = known(number);
        const copy = own(record({ source }));
        const failure = new Error('interrupt copy projection');

        throws(() => request({ owner: copy, required, onWork: () => { throw failure; } }), error => error === failure);
        const before = request({ owner: copy, required });

        strictEqual(resultStatus(before), 'contradiction');
        replaceEvidence({ owner: source, evidence: record({ fields: [{ name: 'name', owner: string }] }) });
        strictEqual(isCurrent(before), false);
        strictEqual(status(copy), 'agreement');
        throws(() => resultStatus(before), /Stale judgment/u);
    });

    test('cyclic copy writers cannot prove that an external field survives an overwrite', () => {
        const source = own(unresolved());
        const copy = own(record({ source, base: known(number) }));

        replaceEvidence({ owner: source, evidence: record({ source: copy }) });
        strictEqual(status(copy), 'unknown');
        strictEqual(status(source), 'unknown');
        replaceEvidence({ owner: source, evidence: record({ fields: [{ name: 'name', owner: number }] }) });
        strictEqual(status(copy), 'contradiction');
    });

    test('cyclic copy alternatives retain independent grounded fields without reviving overwritten bases', () => {
        [false, true].forEach((reverse) => {
            const selected = own(unresolved());
            const copy = own(record({ source: selected }));
            const supplied = known(number);
            const owners = reverse ? [supplied, copy] : [copy, supplied];

            replaceEvidence({ owner: selected, evidence: producer({ owners }) });
            const queried = reverse ? [selected, copy] : [copy, selected];
            const judgments = queried.map(owner => request({ owner, required }));

            judgments.forEach(judgment => strictEqual(resultStatus(judgment), 'contradiction'));
            queried.forEach(owner => ok(readField({ owner, name: 'name' }).cases.some(({ state = '' } = {}) => state === 'unknown')));
            const overwritten = own(record({ source: copy, base: known(string) }));

            strictEqual(status(overwritten), 'contradiction');
            replaceEvidence({ owner: supplied, evidence: record({ fields: [{ name: 'name', owner: string }] }) });
            judgments.forEach(judgment => strictEqual(isCurrent(judgment), false));
            queried.forEach(owner => strictEqual(status(owner), 'unknown'));
            replaceEvidence({ owner: supplied, evidence: record({ fields: [{ name: 'name', owner: number }] }) });
            queried.toReversed().forEach(owner => strictEqual(status(owner), 'contradiction'));
        });
    });

    test('successive retired copies reuse field alternatives and projected owner identities', () => {
        ['absent', 'opaque', 'mixed'].forEach(kind => [32, 64, 128].forEach((size) => {
            const bases = new Map([['absent', false], ['opaque', own(unresolved())], ['mixed', own(producer({ owners: [own(record()), own(unresolved())] }))]]);
            const base = bases.get(kind);
            const owners = [...Array.from({ length: size }, () => known(number)), own(record()), own(unresolved())];
            const joined = own(producer({ owners }));
            const first = own(record({ source: joined, base, retire: true }));
            const last = Array.from({ length: size }).reduce(source => own(record({ source, base, retire: true })), first);
            const work = counter();
            const { onWork } = work;

            strictEqual(request({ owner: last, required, onWork }).status, 'contradiction');
            ok(work.get('field-contribution') < size * 16, JSON.stringify(work.read()));
            ok(work.get('field-case') < size * 16, JSON.stringify(work.read()));
            ok(work.get('field-projection') < size * 16, JSON.stringify(work.read()));
            const { cases: original = [] } = readField({ owner: first, name: 'name' });
            const { cases: repeated = [] } = readField({ owner: last, name: 'name' });

            const present = cases => cases.filter(({ state = '' } = {}) => state === 'present').map(({ owner = false } = {}) => owner);

            deepStrictEqual(present(repeated), present(original));
            deepStrictEqual(new Set(repeated.map(({ state = '' } = {}) => state)), new Set(original.map(({ state = '' } = {}) => state)));
            repeated.filter(({ state = '' } = {}) => state === 'present').forEach(({ source = false, projection = '' } = {}) => {
                strictEqual(source, number);
                strictEqual(projection, 'family');
            });
        }));
    });

    test('cyclic copy members retain their own fallback and retirement boundaries', () => {
        const selected = own(unresolved());
        const copy = own(record({ source: selected, base: known(string) }));
        const forwarded = own(record({ source: copy }));

        replaceEvidence({ owner: selected, evidence: producer({ owners: [forwarded, own(record())] }) });
        strictEqual(status(selected), 'contradiction', 'The independent absent alternative remains absent at the producer');
        strictEqual(status(copy), 'unknown', 'The copy fills that absence, without resolving the cyclic alternative');
        strictEqual(status(forwarded), 'unknown', 'Forwarding cannot restore the absence filled by the earlier copy');
        strictEqual(request({ owner: copy, required: field({ name: 'name', required: 'number' }) }).status, 'contradiction');
        ok(!readField({ owner: copy, name: 'name' }).cases.some(({ state = '' } = {}) => state === 'absent'));
        const child = known(number);
        const original = own(record({ fields: [{ name: 'child', owner: child }] }));
        const choice = own(unresolved());
        const retired = own(record({ source: choice, retire: true }));
        const relayed = own(record({ source: retired }));
        const nested = field({ name: 'child', required });

        replaceEvidence({ owner: choice, evidence: producer({ owners: [relayed, original] }) });
        strictEqual(request({ owner: retired, required: nested }).status, 'unknown');
        strictEqual(request({ owner: relayed, required: nested }).status, 'unknown');
        strictEqual(request({ owner: choice, required: nested }).status, 'contradiction');
        const again = own(record({ source: retired, retire: true }));

        strictEqual(request({ owner: again, required: nested }).status, 'unknown');
        const { cases = [] } = readField({ owner: again, name: 'child' });

        cases.filter(({ state = '' } = {}) => state === 'present').forEach(({ source = false, projection = '' } = {}) => {
            strictEqual(source, child);
            strictEqual(projection, 'family');
        });
    });

    test('a grounded final writer excludes cyclic and contradictory bases from its field result', () => {
        const selected = own(unresolved());
        const supplied = known(number);
        const copy = own(record({ source: supplied, base: selected }));

        replaceEvidence({ owner: selected, evidence: producer({ owners: [copy, known(string)] }) });
        strictEqual(request({ owner: copy, required: field({ name: 'name', required: 'number' }) }).status, 'agreement');
        strictEqual(status(copy), 'contradiction');
        strictEqual(status(selected), 'contradiction');
        const before = request({ owner: copy, required });

        replaceEvidence({ owner: supplied, evidence: record() });
        strictEqual(isCurrent(before), false);
        strictEqual(status(copy), 'unknown');
    });

    test('wide cyclic alternatives and successive retirement share bounded field graphs', () => {
        [32, 64, 128].forEach((size) => {
            const choice = own(unresolved());
            const copy = Array.from({ length: size }).reduce((source, unused, index) => own(record({ source, retire: index % 2 === 0 })), choice);
            const supplied = Array.from({ length: size }, () => known(number));

            replaceEvidence({ owner: choice, evidence: producer({ owners: [copy, ...supplied] }) });
            const work = counter();
            const { onWork } = work;
            const before = request({ owner: copy, required, onWork });

            strictEqual(resultStatus(before), 'contradiction');
            ['field-contribution', 'field-case', 'field-projection'].forEach(kind => ok(work.get(kind) < size * 24, JSON.stringify(work.read())));
            ok(work.get('cyclic-field-state') <= (size + 1) * 3);
            ok(work.get('cyclic-field-input') > 0 && work.get('cyclic-field-input') < size * 16, JSON.stringify(work.read()));
            const cold = work.read();

            strictEqual(request({ owner: copy, required, onWork }).status, 'contradiction');
            ['establishment', 'field-projection', 'cyclic-field-state'].forEach(kind => strictEqual(work.get(kind), Reflect.get(cold, kind)));
            replaceEvidence({ owner: choice, evidence: record({ fields: [{ name: 'name', owner: string }] }) });
            strictEqual(isCurrent(before), false);
            strictEqual(status(copy), 'agreement');
        });
    });

    test('successive copy projections share demanded field evidence and warm repeats', () => {
        const width = 64;
        const sources = Array.from({ length: width }, () => known(number));
        const joined = own(producer({ owners: sources }));
        const copy = sources.reduce(source => own(record({ source, base: own(record()) })), joined);
        const work = counter();

        strictEqual(request({ owner: copy, required, onWork: event => work.onWork(event) }).status, 'contradiction');
        ok(work.get('field-contribution') < width * 12);
        const before = work.read();

        strictEqual(request({ owner: copy, required, onWork: event => work.onWork(event) }).status, 'contradiction');
        ['establishment', 'field-lookup'].forEach(kind => strictEqual(work.get(kind), Reflect.get(before, kind)));
    });

    test('grounded cyclic presence survives forwarding, unknown overlays and source revisions', () => {
        [false, true].forEach((reverse) => {
            const base = known(number);
            const cyclic = own(unresolved());

            replaceEvidence({ owner: cyclic, evidence: record({ source: cyclic, base }) });
            const forwarded = own(record({ source: cyclic }));
            const inherited = own(record({ base: cyclic, source: own(record()) }));
            const overwritten = own(record({ base: forwarded, source: own(unresolved()) }));
            const owners = [cyclic, forwarded, inherited, overwritten];
            const queried = reverse ? owners.toReversed() : owners;
            const presence = field({ name: 'name', required: all() });
            const judgments = queried.map(owner => request({ owner, required: presence }));

            judgments.forEach(judgment => strictEqual(resultStatus(judgment), 'agreement'));
            queried.forEach(owner => strictEqual(status(owner), 'unknown', 'Presence cannot invent a surviving value family'));
            const alternative = own(producer({ owners: [forwarded, own(record())] }));

            strictEqual(request({ owner: alternative, required: presence }).status, 'contradiction');
            replaceEvidence({ owner: base, evidence: record() });
            judgments.forEach(judgment => strictEqual(isCurrent(judgment), false));
            queried.forEach(owner => strictEqual(request({ owner, required: presence }).status, 'unknown'));
            replaceEvidence({ owner: cyclic, evidence: record({ fields: [{ name: 'name', owner: string }] }) });
            [cyclic, forwarded, inherited].forEach(owner => strictEqual(status(owner), 'agreement'));
            strictEqual(status(overwritten), 'unknown');
        });
    });

    test('open copies share alternatives through repeated absence joins and retirement', () => {
        [false, true].forEach(retire => [32, 64, 128].forEach((size) => {
            const absent = own(record());
            const supplied = Array.from({ length: size }, () => known(number));
            const initial = own(producer({ owners: [...supplied, absent, own(unresolved())] }));
            const copied = Array.from({ length: size }).reduce((prior) => {
                const source = own(producer({ owners: [prior, absent] }));

                return own(record({ source, retire, open: true }));
            }, initial);
            const work = counter();
            const { onWork } = work;

            strictEqual(request({ owner: copied, required, onWork }).status, 'contradiction');
            ['field-contribution', 'field-case', 'field-projection'].forEach(kind => ok(work.get(kind) < size * 24, JSON.stringify(work.read())));
            const { cases = [] } = readField({ owner: copied, name: 'name' });

            ok(cases.some(({ state = '' } = {}) => state === 'unknown'));
            ok(!cases.some(({ state = '' } = {}) => state === 'absent'));
            const before = work.read();

            strictEqual(request({ owner: copied, required, onWork }).status, 'contradiction');
            strictEqual(work.get('field-projection'), Reflect.get(before, 'field-projection'));
        }));
    });
}

{
    const rules = Object.fromEntries(['prefer-safe-destructuring-defaults', 'signature-contract-destructuring', 'signature-contract-property',
        'signature-contract-operation', 'signature-contract-call-site', 'no-unguarded-callback-invocation', 'no-null-assignment', 'no-undefined-assignment']
        .map(name => [`resilient/${name}`, 'error']));
    const lint = source => new Linter().verify(source, {
        languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } }, plugins: { resilient: plugin }, rules
    });
    const declarationFor = analysis => analysis.declarations.find(({ name = '' } = {}) => name === 'studioUtils') || {};

    test('conditional object spread is native ECMAScript with an independent condition and property value', () => {
        const source = 'const props=(bool,val)=>({...(bool&&{thing:val})});';
        const props = runInNewContext(`${source}props;`);
        const payload = Object.freeze({ value: 1 });

        deepStrictEqual(lint(source), []);
        // eslint-disable-next-line resilient/no-null-assignment, resilient/no-undefined-assignment -- Native falsey spread controls require both null and undefined to verify that no property is created.
        [false, 0, '', null, void 0].forEach(bool => strictEqual(Object.hasOwn(props(bool, payload), 'thing'), false));
        strictEqual(props(true, payload).thing, payload);
        strictEqual(Object.hasOwn(props(true, void 0), 'thing'), true);
    });

    [
        ['JSX spread', 'const Page=({studioUtils})=><Component {...(studioUtils&&{studioUtils})}/>;'],
        ['object spread', 'const Page=({studioUtils})=>({...studioUtils&&{studioUtils}});'],
        ['guard inside callback', 'const Page=({studioUtils})=>values.map(()=> <Component {...(studioUtils&&{studioUtils})}/>);'],
        ['renamed field', 'const Page=({tools:studioUtils})=><Component {...(studioUtils&&{tools:studioUtils})}/>;'],
        ['stable alias', 'const Page=({studioUtils})=>{const tools=studioUtils;return <Component {...(tools&&{studioUtils})}/>;};'],
        ['nested conjunction', 'const Page=({studioUtils})=><Component {...(studioUtils&&enabled&&{studioUtils})}/>;'],
        ['double negation', 'const Page=({studioUtils})=><Component {...(!!studioUtils&&{studioUtils})}/>;'],
        ['negated disjunction', 'const Page=({studioUtils})=>!studioUtils||forward(studioUtils);'],
        ['conditional branch', 'const Page=({studioUtils})=><Component {...(studioUtils?{studioUtils}:{})}/>;'],
        ['negative conditional branch', 'const Page=({studioUtils})=><Component {...(!studioUtils?{}:{studioUtils})}/>;'],
        ['if branch', 'const Page=({studioUtils})=>{if(studioUtils)forward(studioUtils);};'],
        ['test only', 'const Page=({studioUtils})=>!!studioUtils;'],
        ['omitted field', 'const Page=({studioUtils}={})=>({...studioUtils&&{studioUtils}});Page();'],
        ['incoming null', 'const Page=({studioUtils}={})=>({...studioUtils&&{studioUtils}});Page({studioUtils:null});', ['resilient/no-null-assignment']],
        ['local absent field', 'const {studioUtils}={};const props={...(studioUtils&&{studioUtils})};']
    ].forEach(([name = '', source = '', assignments = []] = []) => test(`presence guards own natural absence: ${name}`, () => {
        // A guard admits incoming absence without waiving an authored null field.
        deepStrictEqual(lint(source).map(({ ruleId = '' } = {}) => ruleId), assignments);
        const analysis = createAnalysis({ source });
        const { index = -1 } = declarationFor(analysis);
        const { required = true, code = '' } = analysis.checkDeclaration({ index });

        strictEqual(required, false);
        strictEqual(code, 'guarded-value');
    }));

    [
        ['unguarded forwarding', 'const Page=({studioUtils})=><Component studioUtils={studioUtils}/>;'],
        ['disjunction forwards absence', 'const Page=({studioUtils})=><Component {...(studioUtils||{studioUtils})}/>;'],
        ['negative conjunction', 'const Page=({studioUtils})=><Component {...(!studioUtils&&{studioUtils})}/>;'],
        ['wrong conditional branch', 'const Page=({studioUtils})=><Component {...(studioUtils?{}:{studioUtils})}/>;'],
        ['unrelated guard', 'const Page=({studioUtils})=><Component {...(other&&{studioUtils})}/>;'],
        ['shadowed guard', 'const Page=({studioUtils})=>values.map(studioUtils=> <Component {...(studioUtils&&{studioUtils})}/>);'],
        ['earlier escape', 'const Page=({studioUtils})=>{forward(studioUtils);return <Component {...(studioUtils&&{studioUtils})}/>;};'],
        ['later escape', 'const Page=({studioUtils})=>{const props={...(studioUtils&&{studioUtils})};forward(studioUtils);return props;};'],
        ['test is not a continuing guard', 'const Page=({studioUtils})=>{if(studioUtils)forward(studioUtils);return studioUtils;};'],
        ['guard outside closure', 'const Page=({studioUtils})=>studioUtils&&(()=> <Component studioUtils={studioUtils}/>);'],
        ['truthiness does not establish callability', 'const run=({studioUtils})=>{if(studioUtils)studioUtils();};'],
        ['truthiness does not establish a constructor', 'const run=({studioUtils})=>studioUtils&&new studioUtils();'],
        ['truthiness does not establish a collection callback', 'const run=({studioUtils})=>studioUtils&&values.map(studioUtils);'],
        ['written field', 'const Page=({studioUtils})=>{studioUtils=other;return <Component {...(studioUtils&&{studioUtils})}/>;};'],
        ['captured write', 'const Page=({studioUtils})=>{const change=()=>{studioUtils=other;};return <Component {...(studioUtils&&{studioUtils})}/>;};'],
        ['dynamic binding', 'const Page=({studioUtils})=>{eval("studioUtils=other");return <Component {...(studioUtils&&{studioUtils})}/>;};']
    ].forEach(([name = '', source = ''] = []) => test(`presence guards retain separate absence obligations: ${name}`, () => {
        strictEqual(lint(source).some(({ messageId = '' } = {}) => messageId === 'safeDefault'), true);
    }));

    test('the Page JSX fixture passes the shared default and contract policies', () => {
        const source = readFileSync(new URL('./fixtures/guarded-values.js', import.meta.url), 'utf8');

        deepStrictEqual(lint(source), []);
    });

    test('a guarded field keeps its absent producer evidence and its sibling requirement', () => {
        const source = 'const {studioUtils,required}={};const props={...(studioUtils&&{studioUtils})};forward(required);';
        const analysis = createAnalysis({ source });
        const selected = analysis.destructuringFields.find(({ name = '' } = {}) => name === 'studioUtils') || {};
        const { index = -1 } = selected;
        const { status = '', fact: { presence = [] } = {} } = analysis.checkDestructuringField({ index });

        strictEqual(status, 'agreement');
        strictEqual(presence.includes('absent'), true);
        deepStrictEqual(lint(source).map(({ ruleId = '' } = {}) => ruleId), [
            'resilient/prefer-safe-destructuring-defaults', 'resilient/signature-contract-destructuring'
        ]);
    });

    test('presence cannot validate a receiver, property, native operation or callback', () => {
        const examples = [
            ['const {studioUtils}=null;const props={...(studioUtils&&{studioUtils})};', 'resilient/signature-contract-destructuring'],
            ['const {studioUtils}={studioUtils:{}};if(studioUtils){const {missing}=studioUtils;forward(missing);}', 'resilient/signature-contract-destructuring'],
            ['const {studioUtils}={studioUtils:42};studioUtils&&studioUtils.map(Boolean);', 'resilient/signature-contract-operation'],
            ['const Page=({studioUtils}={})=>studioUtils&&studioUtils();', 'resilient/no-unguarded-callback-invocation'],
            ['const Page=({studioUtils=null})=><Component {...(studioUtils&&{studioUtils})}/>;', 'resilient/no-null-assignment']
        ];

        examples.forEach(([source = '', rule = ''] = []) => {
            strictEqual(lint(source).some(({ ruleId = '' } = {}) => ruleId === rule), true);
        });
    });

    test('guarded spread preserves absence, payload identity, getters and failures without invocation', () => {
        const execute = runInNewContext(`(input,forward)=>{
        const {studioUtils}=input;
        return forward({...(studioUtils&&{studioUtils})});
    }`);
        const identity = value => value;
        const payload = Object.freeze({ tool: 'studio' });
        const failure = new Error('field failure');
        const callable = () => { throw failure; };
        const events = counter();
        const supplied = { get studioUtils() {
            events.increment('get');

            return payload;
        } };

        // eslint-disable-next-line resilient/no-null-assignment, resilient/no-undefined-assignment -- These supplied nullish payloads verify that a guarded spread preserves absence without invoking or normalizing it.
        [{}, { studioUtils: null }, { studioUtils: void 0 }, { studioUtils: false }, { studioUtils: 0 }, { studioUtils: '' }]
            .forEach(input => strictEqual(Object.hasOwn(execute(input, identity), 'studioUtils'), false));
        [payload, callable, [], 'studio', 42, true].forEach(studioUtils => strictEqual(execute({ studioUtils }, identity).studioUtils, studioUtils));
        strictEqual(execute(supplied, identity).studioUtils, payload);
        strictEqual(events.get('get'), 1);
        throws(() => execute({ get studioUtils() { throw failure; } }, identity), error => error === failure);
        throws(() => execute(supplied, () => { throw failure; }), error => error === failure);
    });

    test('presence queries reuse owned evidence and stay isolated across source revisions', () => {
        const source = 'const Page=({studioUtils}={})=>({...studioUtils&&{studioUtils}});Page();';
        const analysis = createAnalysis({ source });
        const second = createAnalysis({ source });
        const { index = -1 } = declarationFor(analysis);
        const work = counter();
        const { onWork = () => {} } = work;
        const expected = analysis.checkDeclaration({ index, onWork });
        const before = work.read();

        analysis.destructuringFields.toReversed().forEach(({ index = -1 } = {}) => analysis.checkDestructuringField({ index }));
        second.destructuringFields.forEach(({ index = -1 } = {}) => second.checkDestructuringField({ index }));
        deepStrictEqual(second.checkDeclaration({ index }), expected);
        deepStrictEqual(analysis.checkDeclaration({ index, onWork }), expected);
        deepStrictEqual(work.read(), before);
        strictEqual(createAnalysis({ source: source.replace('&&', '||') }).checkDeclaration({ index }).required, true);
        const interrupted = createAnalysis({ source });
        const failure = new Error('presence observation failed');

        throws(() => interrupted.checkDeclaration({ index, onWork: () => { throw failure; } }), error => error === failure);
        deepStrictEqual(interrupted.checkDeclaration({ index }), expected);
    });

    test('composed presence decisions agree with native selection for both branches', () => {
        const conditions = ['studioUtils', '!studioUtils', '!!studioUtils', 'studioUtils&&flag', 'studioUtils||flag',
            '!studioUtils&&flag', '!studioUtils||flag', '(studioUtils&&flag)||studioUtils', '(studioUtils||flag)&&studioUtils',
            '(studioUtils&&flag)||(!studioUtils&&other)', 'studioUtils&&(flag||other)', '!((!studioUtils||flag)&&other)'];

        conditions.forEach((condition) => {
            const selected = runInNewContext(`(studioUtils,flag,other)=>Boolean(${condition})`);

            [true, false].forEach((branch) => {
                // eslint-disable-next-line resilient/no-null-assignment, resilient/no-undefined-assignment -- The native branch oracle enumerates null and undefined to test composed presence decisions.
                const absentCanReach = [null, void 0, false, 0, ''].some(studioUtils => [true, false]
                    .some(flag => [true, false].some(other => selected(studioUtils, flag, other) === branch)));
                const source = `const Page=({studioUtils})=>${condition}?${branch ? '{studioUtils}' : '{}'}:${branch ? '{}' : '{studioUtils}'};`;
                const analysis = createAnalysis({ source });
                const { index = -1 } = declarationFor(analysis);

                strictEqual(analysis.checkDeclaration({ index }).required, absentCanReach, `${condition}, branch ${branch}`);
            });
        });
    });

    [16, 32, 64].forEach(width => test(`presence queries compose across ${width} independently guarded fields`, () => {
        const names = Array.from({ length: width }, (value, index) => `field${index}`);
        const analysis = createAnalysis({ source: `const {${names.join(',')}}={};const props={${names.map(name => `...(${name}&&{${name}})`).join(',')}};` });
        const leaves = analysis.declarations.filter(({ name = '' } = {}) => names.includes(name));
        const work = counter();
        const { onWork = () => {} } = work;

        leaves.forEach(({ index = -1 } = {}) => strictEqual(analysis.checkDeclaration({ index, onWork }).required, false));
        analysis.destructuringFields.toReversed().forEach(({ index = -1 } = {}) => {
            const { status = '', fact: { presence = [] } = {} } = analysis.checkDestructuringField({ index });

            strictEqual(status, 'agreement');
            strictEqual(presence.includes('absent'), true);
        });
        const before = work.read();

        leaves.toReversed().forEach(({ index = -1 } = {}) => analysis.checkDeclaration({ index, onWork }));
        deepStrictEqual(work.read(), before);
        strictEqual(work.get('absence-consumer'), width);
    }));
}
