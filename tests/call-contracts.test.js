import { deepStrictEqual, strictEqual, ok, throws, rejects } from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

import { ESLint, Linter, SourceCode } from 'eslint';
import { parse } from 'espree';

import { isCurrent } from 'eslint-plugin-resilient/agreement';
import { createAnalysis, createProgramAnalysis } from 'eslint-plugin-resilient/analyzer';
import plugin from 'eslint-plugin-resilient/eslint';

import { counter } from './support/work.js';

// Native call/default/normalization oracles and owned actual/generic contracts replace simple per-spelling status grids; report locations, identity, mutation, interruption and resource bounds remain.
const findingsShared = source => new Linter().verify(source, {
    plugins: { resilient: plugin }, rules: { 'resilient/signature-contract-operation': 'error' }
});

{
    const signature = 'const label = ({ title = "" } = {}) => title;';

    test('split result evidence preserves native regexp and custom splitter dispatch', () => {
        const source = "const parts='a b'.split(/\\s+/);parts.trim();";

        strictEqual(findingsShared(source).length, 1);
        throws(() => runInNewContext(source), ({ name = '' } = {}) => name === 'TypeError');
        const custom = "const splitter={[Symbol.split]:()=> 'ready'};'a'.split(splitter).trim();";
        const overridden = "const pattern=/a/;pattern[Symbol.split]=()=> 'ready';'a'.split(pattern).trim();";

        deepStrictEqual(findingsShared(custom), []);
        deepStrictEqual(findingsShared(overridden), []);
        strictEqual(runInNewContext(custom), 'ready');
        strictEqual(runInNewContext(overridden), 'ready');
    });

    test('callable aliases share one acquired signature across many calls and repeated demand', () => {
        const size = 2000;
        const source = ['const f0 = (value = "") => value;', ...Array.from({ length: size }, (_, index) => `const f${index + 1} = f${index};`),
            ...Array.from({ length: 100 }, () => `f${size}(42);`)].join('\n');
        const analysis = createAnalysis({ source });
        const { calls = [], callSignatures = [], counts: { signatures = 0, signatureParameters = 0 } = {} } = analysis;
        const work = counter();
        const first = analysis.checkCall({ index: 0, onWork: event => work.onWork(event) });
        const repeated = analysis.checkCall({ index: 0, onWork: event => work.onWork(event) });
        const { status = '' } = first;

        strictEqual(signatures, 1);
        strictEqual(signatureParameters, 1);
        strictEqual(callSignatures.length, 1);
        calls.forEach(({ signature: index = -1 } = {}) => strictEqual(index, 0));
        strictEqual(status, 'contradiction');
        strictEqual(first.obligations.at(0).facts.at(0), repeated.obligations.at(0).facts.at(0));
        strictEqual(work.get('establishment'), 1);
    });

    test('wide call fields use one writer index and reuse facts without copying signature requirements per call', () => {
        const size = 1000;
        const pattern = Array.from({ length: size }, (_, index) => `p${index} = ""`).join(',');
        const value = Array.from({ length: size }, (_, index) => `p${index}: "ready"`).join(',');
        const analysis = createAnalysis({ source: `const label = ({ ${pattern} } = {}) => ""; label({ ${value} });` });
        const work = counter();
        const first = analysis.checkCall({ index: 0, onWork: event => work.onWork(event) });
        const established = work.get('establishment');
        const repeated = analysis.checkCall({ index: 0, onWork: event => work.onWork(event) });
        const { status = '' } = first;

        strictEqual(status, 'agreement');
        strictEqual(first.obligations.length, size + 1);
        strictEqual(established, size * 2 + 1);
        strictEqual(work.get('field-index-entry'), 0, 'Evaluated records already own their writer index; queries do not rescan source syntax');
        strictEqual(work.get('establishment'), established);
        strictEqual(first.obligations.at(1).facts.at(-1), repeated.obligations.at(1).facts.at(-1));
    });

    test('call signatures, arguments and locations are owned before return and expose no registered handles', () => {
        const source = `${signature}\nlabel({ title: 42 });`;
        const program = parse(source, { ecmaVersion: 'latest', sourceType: 'module', range: true, loc: true });
        const pristine = structuredClone(program);
        const analysis = createProgramAnalysis({ program });
        const { body = [] } = program;
        const { declarations: [{ init = {} } = {}] = [] } = body.at(0);
        const { expression: { arguments: [argument = {}] = [] } = {} } = body.at(1);
        const { properties: [{ value = {} } = {}] = [] } = argument;

        deepStrictEqual(structuredClone(program), pristine);
        Object.defineProperty(init, 'params', { value: [] });
        Object.defineProperty(value, 'value', { value: 'changed' });
        const first = analysis.checkCall({ index: 0 });
        const { obligations = [], status = '' } = first;
        const { calls = [], callSignatures = [] } = analysis;

        strictEqual(status, 'contradiction');
        strictEqual(createProgramAnalysis({ program }).checkCall({ index: 0 }).obligations.at(0).kind, 'arity');
        strictEqual(isCurrent(first), false);
        [calls, calls.at(0), callSignatures, callSignatures.at(0), first, obligations, ...obligations].forEach(value => ok(Object.isFrozen(value)));
        obligations.flatMap(({ facts = [] } = {}) => facts).forEach((fact) => {
            ok(Object.isFrozen(fact));
            ok(!Object.hasOwn(fact, 'owner'));
            ok(!Object.hasOwn(fact, 'premises'));
        });
        [-1, 1, '0', NaN].forEach(index => throws(() => analysis.checkCall({ index }), RangeError));
        const failure = new Error('call observer failed');

        throws(() => analysis.checkCall({ index: 0, onWork: () => { throw failure; } }), error => error === failure);
    });

    const lint = new ESLint({ overrideConfigFile: true, overrideConfig: [{
        plugins: { resilient: plugin }, rules: { 'resilient/signature-contract-call-site': 'error' }
    }] });

    test('call-site lint preserves the established wording and exact supplied-value spans', async () => {
        const source = `${signature}\nlabel({ title: 42 });\nlabel(null);\nlabel(external);`;
        const [{ messages = [] } = {}] = await lint.lintText(source);

        deepStrictEqual(messages.map(({ ruleId = '', messageId = '', message = '', line = 0, column = 0, endColumn = 0 } = {}) => ({
            ruleId, messageId, message, line, column, endColumn
        })), [
            { ruleId: 'resilient/signature-contract-call-site', messageId: 'mismatch', message: 'title expects string-like, but this call supplies number-like.', line: 2, column: 16, endColumn: 18 },
            { ruleId: 'resilient/signature-contract-call-site', messageId: 'mismatch', message: 'argument expects object-like, but this call supplies null.', line: 3, column: 7, endColumn: 11 }
        ]);
    });

    test('call-site lint consumes the exact host AST and source acquisition failures propagate', async () => {
        const engine = new ESLint({ overrideConfigFile: true, overrideConfig: [{
            plugins: { resilient: plugin }, rules: { 'resilient/signature-contract-call-site': 'error' },
            languageOptions: { parser: { parseForESLint(source, options) { return { ast: parse(source.replace('xx', '42'), options) }; } } }
        }] });
        const [{ messages = [] } = {}] = await engine.lintText('const label = (title = "") => title; label(xx);');

        strictEqual(messages.length, 1);
        strictEqual(messages.at(0).message, 'argument expects string-like, but this call supplies number-like.');
        const failure = new Error('call source failed');
        const injector = { rules: { fail: { create() { return { 'Program:exit'({ body = [] } = {}) {
            const statement = body.at(1);

            if (!statement) throw new TypeError('Expected the host call statement');

            const { expression: { arguments: [argument = {}] = [] } = {} } = statement;

            Object.defineProperty(argument, 'properties', { get() { throw failure; } });
        } }; } } } };
        const failing = new ESLint({ overrideConfigFile: true, overrideConfig: [{
            plugins: { injector, resilient: plugin }, rules: { 'injector/fail': 'error', 'resilient/signature-contract-call-site': 'error' }
        }] });

        await rejects(failing.lintText(`${signature} label({ title: 42 });`), error => error === failure);
    });
}

{
    const callsNamed = ({ analysis = {}, name = 'label' } = {}) => {
        const { calls = [] } = analysis;

        return calls.filter(({ callee = '' } = {}) => callee === name).map(({ index = -1 } = {}) => analysis.checkCall({ index }));
    };
    const statuses = source => callsNamed({ analysis: createAnalysis({ source }) }).map(({ status = '' } = {}) => status);
    const defaults = [
        { expression: '""', tag: '[object String]' },
        { expression: '0', tag: '[object Number]' },
        { expression: 'false', tag: '[object Boolean]' },
        { expression: '[]', tag: '[object Array]' },
        { expression: '{}', tag: '[object Object]' },
        { expression: '/value/u', tag: '[object RegExp]' },
        { expression: 'null', tag: '[object Null]' }
    ];

    test('supported call defaults match an independent JavaScript execution oracle', () => {
        const values = [...defaults.map(({ expression = '' } = {}) => expression), '() => 0'];
        const supplied = values.map(expression => ({ direct: expression, record: `{ value: ${expression} }` }));
        const inputs = [...supplied, { direct: '', record: '{}' }];

        defaults.forEach(({ expression: fallback = '', tag = '' } = {}) => {
            inputs.forEach(({ direct = '', record = '' } = {}) => {
                [
                    { parameters: `value = ${fallback}`, argument: direct },
                    { parameters: `{ value = ${fallback} } = {}`, argument: record }
                ].forEach(({ parameters = '', argument = '' } = {}) => {
                    // Execute only these generated, closed fixtures. JavaScript selects
                    // the actual default/value; the analyzer never executes the body.
                    const source = `const label = (${parameters}) => Object.prototype.toString.call(value); label(${argument});`;
                    const actual = runInNewContext(source);
                    const expected = actual === tag ? 'agreement' : 'contradiction';

                    deepStrictEqual(statuses(source), [expected], source);
                });
            });
            const omitted = `const label = ({ value = ${fallback} } = {}) => Object.prototype.toString.call(value); label();`;

            strictEqual(runInNewContext(omitted), tag);
            deepStrictEqual(statuses(omitted), ['agreement'], omitted);
        });
    });

    test('unknown values cannot select a default, while independent contradictions survive in every argument position', () => {
        const variants = ['external', '0n', 'getValue()', '(0, "ready")'];

        variants.forEach((value) => {
            const source = `const label = (first = "", second = "", third = "") => first;
            label(${value}); label(${value}, 42); label(42, ${value}); label("ready", ${value}, 42);
            label("ready", 42, ${value}); label(${value}, "ready", 42); label(42, "ready", ${value});`;

            deepStrictEqual(statuses(source), ['unknown', ...Array.from({ length: 6 }, () => 'contradiction')], value);
            deepStrictEqual(statuses(`const label = ({ value = "", count = 0 } = {}) => value;
            label({ value: ${value} }); label({ value: ${value}, count: "wrong" });`), ['unknown', 'contradiction'], value);
        });
    });

    test('fresh record writer order and unusual static keys preserve values and diagnostic spans', async () => {
        const source = `const label = ({ "": empty = "", 0: zero = "", "__proto__": proto = "" } = {}) => empty;
label({ "": 1, 0: 2, ["__proto__"]: 3 });
label({ "": 1, ...external, 0: 2, ["__proto__"]: "ok" });
label({ ...external, "": "ok", 0: "ok", ["__proto__"]: 3 });
label({ "": 1, "": "ok", 0: 2, 0: "ok", ["__proto__"]: 3, ["__proto__"]: "ok" });`;
        const analysis = createAnalysis({ source });
        const results = callsNamed({ analysis });
        const expected = [['1', '2', '3'], ['2'], ['3'], []];

        deepStrictEqual(results.map(({ status = '' } = {}) => status), ['contradiction', 'contradiction', 'contradiction', 'agreement']);
        results.forEach(({ obligations = [] } = {}, index) => deepStrictEqual(obligations.filter(({ status = '' } = {}) => status === 'contradiction')
            .map(({ location: { range: [start = 0, end = 0] = [] } = {} } = {}) => source.slice(start, end)), expected.at(index)));
        const engine = new ESLint({ overrideConfigFile: true, overrideConfig: [{
            plugins: { resilient: plugin }, rules: { 'resilient/signature-contract-call-site': 'error' }
        }] });
        const [{ messages = [] } = {}] = await engine.lintText(source);
        const lines = source.split('\n');

        deepStrictEqual(messages.map(({ line = 0, column = 0, endColumn = 0 } = {}) => lines.at(line - 1).slice(column - 1, endColumn - 1)), expected.flat());
    });

    test('callable correspondence respects nested scopes, switch ownership and capture boundaries', () => {
        const source = `const label = (value = "") => value;
{ const outer = label; const label = (value = 0) => value; outer(42); label(42); }
{ const alias = label; { const label = (value = 0) => value; alias(42); label(42); } }
switch (label(42)) { default: const label = (value = 0) => value; label(42); }
try {} catch (label) { label(42); }
const later = () => { const alias = label; alias(42); };
const local = () => { const value = (item = "") => item, alias = value; alias(42); };
label(42);`;
        const analysis = createAnalysis({ source });
        const { calls = [], callSignatures = [] } = analysis;

        deepStrictEqual(calls.map(({ index = -1 } = {}) => analysis.checkCall({ index }).status), [
            'unknown', 'agreement', 'contradiction', 'agreement', 'contradiction', 'agreement',
            'unknown', 'contradiction', 'contradiction', 'contradiction'
        ]);
        strictEqual(callSignatures.length, 7, 'Each source function owns one signature, including functions reached through values');
    });

    test('omitted defaults share evidence across calls and result production cannot corrupt retained judgments', () => {
        const count = 128;
        const source = `const label = ({ value = "" } = {}) => value;
        ${Array.from({ length: count }, () => 'label();').join('\n')}`;
        const analysis = createAnalysis({ source });
        const work = counter();
        const first = analysis.checkCall({ index: 0, onWork: event => work.onWork(event) });
        const established = work.get('establishment');
        const { calls = [], callSignatures = [] } = analysis;

        strictEqual(callSignatures.length, 1);
        strictEqual(established, 3, 'The shared absent field and the demanded body record family/field are cold');
        calls.forEach(({ index = -1 } = {}) => {
            const result = analysis.checkCall({ index, onWork: event => work.onWork(event) });
            const { status = '' } = result;

            strictEqual(status, 'agreement');
            strictEqual(result.obligations.at(1).facts.at(0), first.obligations.at(1).facts.at(0));
            ok(Object.isFrozen(result.obligations.at(1).facts.at(0).presence));
        });
        ok(work.get('establishment') <= established + 2 * (count - 1), 'Inert initialization can reuse call contexts; each new context demands at most its own record family and field');
        deepStrictEqual(first.obligations.at(1).facts.at(0).presence, ['absent']);
    });

    test('reusing the same ESLint SourceCode resets shared evidence in either consumer order', () => {
        const source = 'const label = ({ value = "" } = {}) => value; label({ value: 42 });';
        const program = parse(source, { ecmaVersion: 'latest', sourceType: 'module', range: true, loc: true, tokens: true, comment: true });
        const sourceCode = new SourceCode(source, program);
        const engine = new Linter();
        const { body = [] } = program;
        const { expression: { arguments: [{ properties: [{ value = {} } = {}] = [] } = {}] = [] } = {} } = body.at(1);
        const names = ['signature-contract-call-site', 'signature-contract-destructuring'];

        [names, names.toReversed()].forEach((order) => {
            const config = { plugins: { resilient: plugin }, rules: Object.fromEntries(order.map(name => [`resilient/${name}`, 'error'])) };

            Object.defineProperty(value, 'value', { value: 42 });
            strictEqual(engine.verify(sourceCode, config).length, 1);
            Object.defineProperty(value, 'value', { value: 'changed' });
            deepStrictEqual(engine.verify(sourceCode, config), []);
        });
    });

    test('intrinsic undefined and inert void select authored defaults without validating other supplied values', () => {
        ['undefined', 'void 0'].forEach((value) => {
            deepStrictEqual(statuses(`const label = (value = "") => value; label(${value}); label(external); label(42);`), ['agreement', 'unknown', 'contradiction']);
            deepStrictEqual(statuses(`const label = (value = "") => value; const use = undefined => label(undefined);`), ['unknown']);
            // The same owned argument evaluation recognizes intrinsic undefined inside a record.
            deepStrictEqual(statuses(`const label = ({ value = "" } = {}) => value; label({ value: ${value} });`), ['agreement']);
        });
    });
}

{
    const cases = [
        ['declaration owns its signature', 'function read(value=""){return value;} read(42);', 'read', 'contradiction', ['mismatch']],
        ['native count dispatch', 'function read(value,callback){switch(arguments.length){case 1:return value;case 2:return callback(value);}}read(42);', 'read', 'agreement', []],
        ['count dispatch through alias', 'const read=function(value,callback){switch(arguments.length){case 1:return value;}};const alias=read;alias(42);', 'alias', 'agreement', []],
        ['omitted formal read', 'function read(value,callback){switch(arguments.length){case 1:return callback;}}read(42);', 'read', 'contradiction', ['arity']],
        ['omitted formal captured', 'function read(value,callback){switch(arguments.length){case 1:return ()=>callback;}}read(42);', 'read', 'contradiction', ['arity']],
        ['duplicate dispatch cannot supersede first match',
            'function read(value,callback){switch(arguments.length){case 1:return callback;case 1:return value;}}read(42);', 'read', 'contradiction', ['arity']],
        ['shadowed arguments', 'function read(arguments,callback){switch(arguments.length){case 1:return arguments;}}read(42);', 'read', 'contradiction', ['arity'], 'script'],
        ['inherited arguments', 'function outer(){const read=(value,callback)=>{switch(arguments.length){case 1:return value;}};read(42);}', 'read', 'contradiction', ['arity']],
        ['current arguments captured', 'function read(value,callback){switch(arguments.length){case 1:return ()=>arguments.length;}}read(42);', 'read', 'contradiction', ['arity']],
        ['returned regular function owns arguments',
            'function read(value,callback){switch(arguments.length){case 1:return function(){return arguments[0];};}}read(42);', 'read', 'agreement', []],
        ['renamed regular function preserves owner',
            'function choose(first,later){switch(arguments.length){case 1:return function renamed(){return arguments[0];};}}choose(42);', 'choose', 'agreement', []],
        ['returned regular function still captures omitted formal',
            'function read(value,callback){switch(arguments.length){case 1:return function(){return callback(arguments[0]);};}}read(42);', 'read', 'contradiction', ['arity']],
        ['returned regular function may capture supplied formal',
            'function read(value,callback){switch(arguments.length){case 1:return function(){return value(arguments[0]);};}}read(external);', 'read', 'agreement', []],
        ['returned function dynamic lookup may capture omitted formal',
            'function read(value,callback){switch(arguments.length){case 1:return function(){return eval("callback");};}}read(42);', 'read', 'contradiction', ['arity']],
        ['returned arrow dynamic lookup may capture omitted formal',
            'function read(value,callback){switch(arguments.length){case 1:return ()=>eval("callback");}}read(42);', 'read', 'contradiction', ['arity']],
        ['dispatch return dynamic lookup may read omitted formal',
            'function read(value,callback){switch(arguments.length){case 1:return eval("callback");}}read(42);', 'read', 'contradiction', ['arity']],
        ['returned function shadows omitted formal',
            'function read(value,callback){switch(arguments.length){case 1:return function(callback){return callback(arguments[0]);};}}read(42);', 'read', 'agreement', []],
        ['unknown case effect', 'function read(value,callback){switch(arguments.length){case external():return value;case 1:return value;}}read(42);', 'read', 'contradiction', ['arity']],
        ['pre-dispatch effect', 'function read(value,callback){external();switch(arguments.length){case 1:return value;}}read(42);', 'read', 'contradiction', ['arity']],
        ['parameter initialization effect', 'const read=function(value=external(),callback){switch(arguments.length){case 1:return value;}};read(42);', 'read', 'contradiction', ['arity']],
        ['fallthrough dispatch', 'function read(value,callback){switch(arguments.length){case 1:case 2:return value;}}read(42);', 'read', 'contradiction', ['arity']],
        ['hoisted closure dependency', 'function read(value,callback){switch(arguments.length){case 1:return capture;}function capture(){return callback;}}read(42);',
            'read', 'contradiction', ['arity']],
        ['nested partial evidence preserves sibling contradiction', 'const read=({config:{name="",[key]:value}={}}={})=>name;read({config:{name:42}});', 'read', 'contradiction', ['mismatch']],
        ['nested unsupported pattern preserves outer contradiction', 'const read=({config:{[key]:value}={}}={})=>value;read({config:42});', 'read', 'contradiction', ['mismatch']],
        ['nested unknown default preserves supplied contradiction', 'const read=({config:{name=""}=external()}={})=>name;read({config:{name:42}});', 'read', 'contradiction', ['mismatch']],
        ['nested unknown default remains unknown when omitted', 'const read=({config:{name=""}=external()}={})=>name;read({});', 'read', 'unknown', []],
        ['nested closed excess property', 'const read=({config:{name=""}={}}={})=>name;read({config:{name:"a",extra:42}});', 'read', 'contradiction', ['excessProperty']],
        ['owned array slots satisfy the acquired pattern', 'const read=([value]=[])=>value;read([]);', 'read', 'agreement', []],
        ['guarded value excludes false', 'const read=(value={})=>value;const item=flag&&{};item?read(item):[];', 'read', 'agreement', []],
        ['required argument', 'const read=value=>value; read();', 'read', 'contradiction', ['arity']],
        ['extra argument', 'const read=(value="")=>value; read("a", "b");', 'read', 'contradiction', ['arity']],
        ['rest owns additional arguments', 'const read=(value="",...rest)=>value; read("a", "b");', 'read', 'agreement', []],
        ['rest preserves fixed argument contract', 'const read=(value="",...rest)=>value; read(42, "b");', 'read', 'contradiction', ['mismatch']],
        ['nested contradiction', 'const read=({config:{name=""}={}}={})=>name; read({config:{name:null}});', 'read', 'contradiction', ['mismatch']],
        ['nested authored absence', 'const read=({config:{name=""}={}}={})=>name; read({});', 'read', 'agreement', []],
        ['supplied undefined selects nested default', 'const read=({config:{name=""}={}}={})=>name; read({config:{name:undefined}});', 'read', 'agreement', []],
        ['unknown beside nested contradiction', 'const read=({config:{name="",count=0}={}}={})=>name; read({config:{name:42,count:external}});', 'read', 'contradiction', ['mismatch']],
        ['wrong outer family reports once', 'const read=({config:{name=""}={}}={})=>name; read({config:42});', 'read', 'contradiction', ['mismatch']],
        ['closed caller record', 'const read=({name=""}={})=>name; read({name:"a",extra:42});', 'read', 'contradiction', ['excessProperty']],
        ['rest opens caller record', 'const read=({name="",...rest}={})=>name; read({name:"a",extra:42});', 'read', 'agreement', []],
        ['returned callable', 'const make=()=>(value="")=>value; const read=make(); read(42);', 'read', 'contradiction', ['mismatch']],
        ['member callable', 'const api={read:(value="")=>value}; api.read(42);', 'read', 'contradiction', ['mismatch']],
        ['callback actual input', 'const apply=(callback,value)=>callback(value); const read=({name=""}={})=>name; apply(read,{name:42});', 'apply', 'contradiction', ['mismatch']],
        ['callback required argument', 'const apply=callback=>callback(); const read=value=>value; apply(read);', 'apply', 'contradiction', ['arity']],
        ['callback extra argument', 'const apply=callback=>callback("a",true); const read=value=>value; apply(read);', 'apply', 'contradiction', ['arity']],
        ['known callable beside unknown', 'const read=flag ? (value="")=>value : external; read(42);', 'read', 'contradiction', ['mismatch']],
        ['unknown callable is not agreement', 'const read=flag ? (value="")=>value : external; read("a");', 'read', 'unknown', []],
        ['incompatible callable alternatives', 'const read=flag ? (value="")=>value : (value=0)=>value; read(42);', 'read', 'contradiction', ['mismatch']],
        ['bound record before exposure', 'const read=({name=""}={})=>name; const item={name:42}; read(item);', 'read', 'contradiction', ['mismatch']],
        ['later argument invalidates earlier record', 'const read=({name=""}={},effect)=>name; const item={name:42}; read(item,external(item));', 'read', 'unknown', []],
        ['escaped record is unknown', 'const read=({name=""}={})=>name; const item={name:42}; external(item); read(item);', 'read', 'unknown', []],
        ['getter does not establish a field', 'const read=({name=""}={})=>name; read({get name(){return 42;}});', 'read', 'unknown', []],
        ['unknown supplied value remains unknown', 'const read=(value="")=>value; read(external);', 'read', 'unknown', []],
        ['unsupported default remains unknown', 'const read=(value=external())=>value; read(42);', 'read', 'unknown', []]
    ];

    cases.forEach(([name = '', source = '', selected = '', expected = '', messages = [], sourceType = 'module'] = []) => {
        test(`call agreement: ${name}`, () => {
            const analysis = createAnalysis({ source, sourceType });
            const { calls = [] } = analysis;
            const { index = -1 } = calls.find(({ callee = '' } = {}) => callee === selected) ?? {};

            strictEqual(analysis.checkCall({ index }).status, expected);
        });
        test(`call findings: ${name}`, () => {
            const linter = new Linter();
            const findings = linter.verify(source, { languageOptions: { sourceType }, plugins: { resilient: plugin }, rules: { 'resilient/signature-contract-call-site': 'error' } });

            deepStrictEqual(findings.map(({ messageId = '' } = {}) => messageId), messages);
        });
    });

    test('actual callback agreement does not enter a generic callee proof or depend on query order', () => {
        const source = 'const apply=(callback,value)=>callback(value); const read=(value="")=>value; apply(read,42); apply(read,"a");';
        const first = createAnalysis({ source });
        const second = createAnalysis({ source });
        const summarize = analysis => analysis.calls.map(({ index = -1 } = {}) => analysis.checkCall({ index }));
        const before = first.checkFunction({ index: 0 });
        const results = summarize(first);

        second.calls.toReversed().forEach(({ index = -1 } = {}) => second.checkCall({ index }));
        deepStrictEqual(summarize(second), results);
        deepStrictEqual(first.checkFunction({ index: 0 }), before);
        strictEqual(results.at(0).status, 'unknown');
        strictEqual(results.at(1).status, 'contradiction');
        strictEqual(results.at(2).status, 'agreement');
    });

    test('nested diagnostics own the supplied leaf location', () => {
        const source = 'const read=({config:{name=""}={}}={})=>name;read({config:{name:42}});';
        const analysis = createAnalysis({ source });
        const { obligations = [] } = analysis.checkCall({ index: 0 });
        const { location: { range = [] } = {} } = obligations.find(({ status = '' } = {}) => status === 'contradiction');

        strictEqual(source.slice(...range), '42');
    });

    test('dispatch evidence belongs to the retained source revision', () => {
        const original = 'function read(value,callback){switch(arguments.length){case 1:return value;}}read(42);';
        const before = createAnalysis({ source: original });
        const after = createAnalysis({ source: original.replace('return value', 'return callback') });

        strictEqual(after.checkCall({ index: 0 }).status, 'contradiction');
        strictEqual(before.checkCall({ index: 0 }).status, 'agreement');
    });

    test('forwarded contradictions are located at the caller use with owned origin evidence', () => {
        const source = 'const apply=(callback,value)=>callback(value);const read=(value="")=>value;apply(read,42);';
        const analysis = createAnalysis({ source });
        const { index = -1 } = analysis.calls.find(({ callee = '' } = {}) => callee === 'apply');
        const { obligations = [] } = analysis.checkCall({ index });
        const { location: { range = [] } = {}, origin: { range: origin = [] } = {} } = obligations.find(({ status = '' } = {}) => status === 'contradiction');

        strictEqual(source.slice(...range), 'apply(read,42)');
        strictEqual(source.slice(...origin), 'value');
    });

    test('local call predicates remain correlated across later binding reads and nested forwarding', () => {
        const source = ['const expect=(value={})=>value;const read=value=>expect(value);const get=({ready=0}={})=>ready;const forward=value=>get(value);',
            'const f=()=>{const item=forward(external)?external():false;return item?read(item):42;};'].join('');
        const first = createAnalysis({ source });
        const second = createAnalysis({ source });
        const selected = first.calls.find(({ callee = '' } = {}) => callee === 'read');
        const { index = -1 } = selected;

        strictEqual(first.checkCall({ index }).status, 'unknown');
        first.functions.forEach(({ index = -1 } = {}) => first.checkFunction({ index }));
        second.calls.toReversed().forEach(({ index = -1 } = {}) => second.checkCall({ index }));
        deepStrictEqual(first.checkCall({ index }), second.checkCall({ index }));
        deepStrictEqual(new Linter().verify(source, { plugins: { resilient: plugin }, rules: { 'resilient/signature-contract-call-site': 'error' } }), []);
    });

    test('guarded destructuring and calls select the same completed use without erasing test alternatives', () => {
        const source = ['const make=()=>flag?false:{};const accept=(value={})=>value;',
            'const run=()=>{const value=make();if(!value)return;const {name}=value;accept(value);return name;};'].join('');
        const first = createAnalysis({ source });
        const second = createAnalysis({ source });
        const { index = -1 } = first.calls.find(({ callee = '' } = {}) => callee === 'accept');
        const before = first.checkFunction({ index: 0 });

        strictEqual(first.checkDestructuring({ index: 0 }).status, 'agreement');
        strictEqual(first.checkCall({ index }).status, 'agreement');
        deepStrictEqual(first.checkFunction({ index: 0 }), before);
        second.calls.toReversed().forEach(({ index = -1 } = {}) => second.checkCall({ index }));
        deepStrictEqual(first.checkDestructuring({ index: 0 }), second.checkDestructuring({ index: 0 }));
        const findings = new Linter().verify(source, { plugins: { resilient: plugin }, rules: {
            'resilient/signature-contract-call-site': 'error', 'resilient/signature-contract-destructuring': 'error'
        } });

        deepStrictEqual(findings.map(({ messageId = '' } = {}) => messageId), ['missingProperty']);
    });

    test('a forwarded known promise cannot poison unknown caller values or the generic callee', () => {
        const source = 'const invoke=callback=>callback();const load=async()=>1;invoke(load);invoke(external);';
        const first = createAnalysis({ source });
        const second = createAnalysis({ source });
        const before = first.checkFunction({ index: 0 });
        const check = analysis => analysis.promiseUses.map(({ index = -1 } = {}) => analysis.checkPromiseUse({ index }));
        const results = check(first);

        second.promiseUses.toReversed().forEach(({ index = -1 } = {}) => second.checkPromiseUse({ index }));
        deepStrictEqual(check(second), results);
        strictEqual(results.filter(({ unhandled = false } = {}) => unhandled).length, 1);
        deepStrictEqual(first.checkFunction({ index: 0 }), before);
        deepStrictEqual(second.checkFunction({ index: 0 }), before);
    });
}

{
    const rule = 'resilient/signature-contract-call-site';
    const config = { plugins: { resilient: plugin }, rules: { [rule]: 'error' } };
    const lint = source => new Linter().verify(source, config);
    const spans = (source, findings) => findings.map(({ column = 0, endColumn = 0 } = {}) => source.slice(column - 1, endColumn - 1));
    const conflictsFor = (analysis, name) => {
        const calls = analysis.calls.filter(({ callee = '' } = {}) => callee === name);

        strictEqual(calls.length, 1);

        return analysis.checkCall({ index: calls.at(0).index }).obligations.filter(({ status = '' } = {}) => status === 'contradiction');
    };
    const directoryFor = (context) => {
        const directory = mkdtempSync(join(tmpdir(), 'resilient-call-diagnostics-'));

        context.after(() => rmSync(directory, { recursive: true, force: true }));

        return directory;
    };

    [
        ['map', 'flag?42:""'], ['map', 'flag?42:external'], ['map', 'flag?42:void 0'], ['map', 'flag?42:other?"":external'],
        ['filter', 'flag?42:external'], ['find', 'flag?42:external'], ['some', 'flag?42:external'], ['forEach', 'flag?42:external']
    ].forEach(([method = '', value = ''] = []) => test(`callback reporting preserves known conflict beside other evidence: ${method} ${value}`, () => {
        const call = `[${value},42].${method}(read)`;
        const source = `const read=(value="")=>value;${call};`;
        const findings = lint(source);

        strictEqual(findings.length, 1);
        strictEqual(findings.at(0).message, `${method}.callback expects string-like, but this call supplies number-like.`);
        deepStrictEqual(spans(source, findings), [call]);
        const conflicts = conflictsFor(createAnalysis({ source }), method);

        ok(conflicts.length >= 2, 'Reporting must not delete analyzer contributions');
    }));

    [
        ['const read=(value="")=>value;const apply=value=>read(value);const relay=flag=>{apply(flag?42:"");apply(42);};relay(flag);',
            ['apply(flag?42:"")', 'apply(42)', 'relay(flag)']],
        ['const read=(value="")=>value;const apply=value=>read(value);const relay=value=>{apply(value);apply(42);};relay(flag?42:"");',
            ['apply(42)', 'relay(flag?42:"")']],
        ['const read=(value="")=>value;const relay=value=>[value,42].map(read);relay(flag?42:"");', ['[value,42].map(read)']],
        ['const read=(value="")=>value;const relay=value=>[value,42].map(read);relay(flag?42:external);', ['[value,42].map(read)']],
        ['const read=(value="")=>value;const relay=value=>{read(value);read(value);};relay(42);', ['relay(42)', 'relay(42)']],
        ['const read=(value="")=>value;const relay=value=>read(value);relay(42);relay(42);', ['relay(42)', 'relay(42)']],
        ['const read=()=>0;const relay=value=>{read(value);read(value);};relay(42);', ['read(value)', 'read(value)']]
    ].forEach(([source = '', expected = []] = []) => test(`report identity preserves origin and caller boundaries: ${source}`, () => {
        deepStrictEqual(spans(source, lint(source)), expected);
    }));

    [
        ['const read=(value="")=>value;[42,false].map(read);', ['number-like', 'boolean-like']],
        ['const read=flag?((value="")=>value):((value=false)=>value);[42,42].map(read);', ['number-like', 'number-like']]
    ].forEach(([source = '', actual = []] = []) => test(`different messages or requirements cannot merge: ${source}`, () => {
        const findings = lint(source);

        strictEqual(findings.length, 2);
        deepStrictEqual(findings.map(({ message = '' } = {}) => message.split('supplies ').at(-1)), actual.map(value => `${value}.`));
        strictEqual(new Set(findings.map(({ message = '' } = {}) => message)).size, 2);
    }));

    test('distinct parameter paths survive repeated native callback contributions', () => {
        const source = 'const read=(state="",value="")=>state;[42,42].reduce(read,42);';
        const findings = lint(source);

        strictEqual(findings.length, 2);
        deepStrictEqual(findings.map(({ message = '' } = {}) => message), [
            'reduce.callback expects string-like, but this call supplies number-like.',
            'reduce.callback.argument[1] expects string-like, but this call supplies number-like.'
        ]);
    });

    test('multiline callback duplicates have one exact report and no source rewrite', () => {
        const source = 'const read=(value="")=>value;\n[\n flag?42:"",\n 42\n].map(read);';
        const findings = lint(source);

        strictEqual(findings.length, 1);
        const [{ line = 0, column = 0, endLine = 0, endColumn = 0 } = {}] = findings;

        deepStrictEqual([line, column, endLine, endColumn], [2, 1, 5, 12]);
        const { output = '', fixed = true } = new Linter().verifyAndFix(source, config);

        strictEqual(output, source);
        strictEqual(fixed, false);
    });

    test('unrelated module origins with equal ranges cannot suppress one another', (context) => {
        const directory = directoryFor(context);
        const filename = join(directory, 'main.js');
        const dependencyFile = join(directory, 'dep.js');
        const source = 'import{relay}from"./dep.js";const read=(x="")=>x;read(42);relay(42);';
        const dependency = '     const read=(x="")=>x;export const relay=xx=>read(xx);';

        strictEqual(source.indexOf('42'), dependency.lastIndexOf('xx'));
        writeFileSync(dependencyFile, dependency);
        const engine = new Linter({ cwd: directory });
        const findings = engine.verify(source, config, { filename });

        deepStrictEqual(spans(source, findings), ['42', 'relay(42)']);
        const analysis = createAnalysis({ source, filename, resolveModule: () => ({ filename: dependencyFile, source: dependency }) });
        const [{ origin = {} } = {}] = conflictsFor(analysis, 'relay');
        const { range = [], filename: from = '' } = origin;

        strictEqual(from, dependencyFile);
        strictEqual(dependency.slice(...range), 'xx');
        ok(Object.isFrozen(origin));
        ok(Object.isFrozen(range));

        // Reuse the host AST while the imported source changes, then restore it.
        const host = engine.getSourceCode();

        writeFileSync(dependencyFile, dependency.replace('(x="")', '(x=0)'));
        deepStrictEqual(spans(source, engine.verify(host, config, { filename })), ['42']);
        writeFileSync(dependencyFile, dependency);
        deepStrictEqual(engine.verify(host, config, { filename }), findings);
        strictEqual(conflictsFor(analysis, 'relay').at(0).origin.filename, dependencyFile);
    });

    test('direct versus forwarded calls use acquired identity rather than equal start offsets', (context) => {
        const directory = directoryFor(context);
        const filename = join(directory, 'main.js');
        const dependencyFile = join(directory, 'dep.js');
        const dependency = 'const read=(x="")=>x;export const relay=xx=>read(xx);';
        const body = 'import{relay}from"./dep.js";relay(42);';
        const source = ' '.repeat(dependency.lastIndexOf('read(') - body.lastIndexOf('relay(')) + body;

        strictEqual(source.lastIndexOf('relay('), dependency.lastIndexOf('read('));
        writeFileSync(dependencyFile, dependency);
        const analysis = createAnalysis({ source, filename, resolveModule: () => ({ filename: dependencyFile, source: dependency }) });
        const [{ location: { range = [] } = {}, origin: { range: from = [], filename: origin = '' } = {} } = {}] = conflictsFor(analysis, 'relay');

        strictEqual(source.slice(...range), 'relay(42)');
        strictEqual(dependency.slice(...from), 'xx');
        strictEqual(origin, dependencyFile);
        deepStrictEqual(spans(source, new Linter({ cwd: directory }).verify(source, config, { filename })), ['relay(42)']);
    });

    test('distinct imported sources retain separate same-range obligations at one caller', (context) => {
        const directory = directoryFor(context);
        const filename = join(directory, 'main.js');
        const source = 'import{emit as a}from"./a.js";import{emit as b}from"./b.js";const relay=value=>{a(value);b(value);};relay(42);';
        const dependency = 'const read=(x="")=>x;export const emit=value=>read(value);';

        ['a.js', 'b.js'].forEach(name => writeFileSync(join(directory, name), dependency));
        const analysis = createAnalysis({ source, filename, resolveModule: ({ source = '' } = {}) => ({ filename: join(directory, source), source: dependency }) });
        const conflicts = conflictsFor(analysis, 'relay');

        strictEqual(conflicts.length, 2);
        strictEqual(new Set(conflicts.map(({ origin: { filename = '' } = {} } = {}) => filename)).size, 2);
        deepStrictEqual(spans(source, new Linter({ cwd: directory }).verify(source, config, { filename })), ['relay(42)', 'relay(42)']);
    });

    test('equal imported arity origins retain both source owners', (context) => {
        const directory = directoryFor(context);
        const filename = join(directory, 'main.js');
        const source = 'import{emit as a}from"./a.js";import{emit as b}from"./b.js";const relay=()=>{a();b();};relay();';
        const dependency = 'const read=value=>value;export const emit=()=>read();';

        ['a.js', 'b.js'].forEach(name => writeFileSync(join(directory, name), dependency));
        const findings = new Linter({ cwd: directory }).verify(source, config, { filename });

        deepStrictEqual(findings.map(({ messageId = '' } = {}) => messageId), ['arity', 'arity', 'arity', 'arity']);
        deepStrictEqual(spans(source, findings), ['a()', 'b()', 'relay()', 'relay()']);
    });
}

{
    const composition = (size, input, body = 'value') => [`const f0=value=>${body};`,
        ...Array.from({ length: size }, (unused, index) => `const f${index + 1}=value=>{f${index}(value);return f${index}(value);};`), `f${size}(${input});`].join('');

    [
        ['42', 'number', 'agreement', 'value'], ['external', 'number', 'unknown', 'value'],
        ['external?{}:[]', 'object', 'contradiction', 'value']
    ].forEach(([input = '', required = '', status = '', body = ''] = []) => test(`repeated pure calls share owned evidence for ${body} with ${input}`, () => {
        const samples = [50, 100, 200].map((size) => {
            const analysis = createAnalysis({ source: composition(size, input, body) });
            const { calls = [] } = analysis;
            const { index = -1 } = calls.findLast(({ callee = '' } = {}) => callee === `f${size}`) ?? {};
            const work = counter();
            const result = analysis.checkCallResult({ index, required, onWork: event => work.onWork(event) });
            const { status: actual = '' } = result;
            const before = work.read();

            strictEqual(actual, status);
            deepStrictEqual(analysis.checkCallResult({ index, required, onWork: event => work.onWork(event) }), result);
            const after = work.read();

            ['function-context', 'value-demand', 'flow-contribution'].forEach(kind => strictEqual(Reflect.get(after, kind), Reflect.get(before, kind)));
            const { counts = {} } = analysis;

            return { ...before, ...counts };
        });

        ['function-context', 'value-demand', 'contexts', 'values'].forEach((kind) => {
            const [first = 0, second = 0, third = 0] = samples.map(sample => Reflect.get(sample, kind));

            strictEqual(third - second, 2 * (second - first));
        });
    }));

    test('shared bodies retain contract findings at both actual caller uses', () => {
        const source = 'const wrong=42;const read=(value="")=>value;read(wrong);read(wrong);';
        const findings = new Linter().verify(source, { plugins: { resilient: plugin }, rules: { 'resilient/signature-contract-call-site': 'error' } });

        strictEqual(findings.length, 2);
        const [{ column: first = 0 } = {}, { column: second = 0 } = {}] = findings;

        strictEqual(first < second, true);
    });

    test('caller values cannot replace generic or earlier evidence', () => {
        const source = 'const read=(value="")=>value;const number=42;read(number);read(number);read("");';
        const first = createAnalysis({ source });
        const second = createAnalysis({ source });
        const { calls = [] } = second;
        const before = first.checkFunction({ index: 0 });

        calls.toReversed().forEach(({ index = -1 } = {}) => second.checkCallResult({ index, required: 'number' }));
        deepStrictEqual(second.checkFunction({ index: 0 }), before);
        deepStrictEqual(first.checkFunction({ index: 0 }), before);
        const revision = createAnalysis({ source: source.replace('number=42', 'number=""') });

        strictEqual(revision.checkCallResult({ index: 0, required: 'number' }).status, 'contradiction');
        strictEqual(first.checkCallResult({ index: 0, required: 'number' }).status, 'agreement');
    });

    test('nested shared obligations remain at both caller boundaries', () => {
        const source = 'const read=(value="")=>value;const repeat=value=>{read(value);return read(value);};const wrong=42;repeat(wrong);repeat(wrong);';
        const analysis = createAnalysis({ source });
        const { calls = [] } = analysis;
        const uses = calls.filter(({ callee = '' } = {}) => callee === 'repeat');
        const expected = uses.map(({ index = -1 } = {}) => analysis.checkCall({ index }));
        const reversed = createAnalysis({ source });

        deepStrictEqual(uses.toReversed().map(({ index = -1 } = {}) => reversed.checkCall({ index })).toReversed(), expected);
        expected.forEach(({ status = '', obligations = [] } = {}) => {
            strictEqual(status, 'contradiction');
            strictEqual(obligations.filter(({ status = '' } = {}) => status === 'contradiction').length, 2);
        });
        const findings = new Linter().verify(source, { plugins: { resilient: plugin }, rules: { 'resilient/signature-contract-call-site': 'error' } });

        strictEqual(findings.length, 4);
        strictEqual(new Set(findings.map(({ column = 0 } = {}) => column)).size, 2);
    });

    [
        ['external(record);', 1], ['record.value="";', 1], ['const alias=record;external(alias);', 1],
        ['const observe=()=>record;external(observe);', 0]
    ].forEach(([effect = '', count = 0] = []) => test(`a shared return never revives retired fields after ${effect}`, () => {
        const source = `const read=value=>value;const record={value:42};read(record).value.trim();${effect}read(record).value.trim();`;
        const forward = createAnalysis({ source });
        const reversed = createAnalysis({ source });
        const { memberAccesses = [] } = forward;
        const expected = memberAccesses.map(({ index = -1 } = {}) => forward.checkMemberAccess({ index }));

        deepStrictEqual(memberAccesses.toReversed().map(({ index = -1 } = {}) => reversed.checkMemberAccess({ index })).toReversed(), expected);
        const findings = new Linter().verify(source, { plugins: { resilient: plugin }, rules: { 'resilient/signature-contract-operation': 'error' } });

        // Captured records have no local structural lifetime proof at either use.
        strictEqual(findings.length, count);
        const [{ column = 0 } = {}] = findings;

        strictEqual(column < source.indexOf(effect), true);
    }));

    test('same-spelled callees and distinct argument tuples own distinct results', () => {
        const source = 'const read=value=>value;const count=42;read(count);{const read=value=>"";read(count);}read("");read(count);';
        const analysis = createAnalysis({ source });
        const { calls = [] } = analysis;
        const statuses = calls.map(({ index = -1 } = {}) => analysis.checkCallResult({ index, required: 'number' }).status);

        deepStrictEqual(statuses, ['agreement', 'contradiction', 'contradiction', 'agreement']);
    });

    test('interrupted sharing proofs publish only completed callee evidence', () => {
        const source = composition(4, '42');
        const first = createAnalysis({ source });
        const { calls = [] } = first;
        const { index = -1 } = calls.findLast(({ callee = '' } = {}) => callee === 'f4') ?? {};
        const work = counter();
        const expected = first.checkCallResult({ index, required: 'number', onWork: event => work.onWork(event) });

        Object.keys(work.read()).forEach((interrupted) => {
            const analysis = createAnalysis({ source });
            const failure = new Error(interrupted);

            throws(() => analysis.checkCallResult({ index, required: 'number', onWork: ({ kind = '' } = {}) => {
                if (kind === interrupted) throw failure;
            } }), error => error === failure);
            deepStrictEqual(analysis.checkCallResult({ index, required: 'number' }), expected);
        });
    });
}

{
    const findings = findingsShared;

    test('native factories evaluate arguments before establishing a normal result', () => {
        const source = 'const fail=()=>{throw 42;};Math.max(String(fail())).trim();';
        const analysis = createAnalysis({ source });
        const { calls = [] } = analysis;
        const { index = -1 } = calls.find(({ callee = '' } = {}) => callee === 'String') ?? {};
        const { normal = true, thrown = false } = analysis.checkCallResult({ index, required: 'string' });

        strictEqual(normal, false);
        strictEqual(thrown, true);
        const outer = calls.find(({ callee = '' } = {}) => callee === 'max');

        strictEqual(analysis.checkCallResult({ ...outer, required: 'number' }).normal, false);
        deepStrictEqual(findings(source), []);
    });

    test('native ownership is independent of source revision and query order', () => {
        const source = [
            'const renamed=String;renamed(42).map(Boolean);',
            'const copied=Array.from([1]);copied.length.trim();',
            'const fields=Object.fromEntries([["value",1]]);const read=([value=""]=[])=>value;read(fields);',
            'const arithmetic=Math;const parse=Number.parseInt;const clock=Date.now;const total=arithmetic.max(parse("2"),clock());total.trim();',
            'const sliced="abc".slice(1);sliced.map(Boolean);',
            'const serialized=JSON.stringify({value:1});serialized.map(Boolean);'
        ].join('');
        const first = createAnalysis({ source });
        const second = createAnalysis({ source });
        const revised = createAnalysis({ source: source.replace('String', 'external') });
        const before = first.checkCallResult({ index: 0, required: 'string' });
        const receivers = first.receivers.map(({ index = -1 } = {}) => first.check({ index }));

        deepStrictEqual(receivers.map(({ fact: { families = [] } = {} } = {}) => families), [['string'], ['number'], ['number'], ['string'], ['string']]);
        strictEqual(findings(source).length, 5);
        const selected = first.calls.find(({ callee = '' } = {}) => callee === 'read');

        ok(first.checkCall(selected).obligations.some(({ status = '' } = {}) => status === 'contradiction'), 'An object result cannot supply the array-pattern contract');

        second.memberAccesses.toReversed().forEach(({ index = -1 } = {}) => second.checkMemberAccess({ index }));
        deepStrictEqual(second.checkCallResult({ index: 0, required: 'string' }), before);
        deepStrictEqual(second.receivers.map(({ index = -1 } = {}) => second.check({ index })), receivers);
        strictEqual(revised.checkCallResult({ index: 0, required: 'string' }).status, 'unknown');
        deepStrictEqual(first.checkCallResult({ index: 0, required: 'string' }), before);
    });

    test('source context selection is shared until membership changes without admitting standalone evidence', () => {
        [[16, 16], [64, 16], [64, 32]].forEach(([callers = 0, members = 0] = []) => {
            const source = ['const read=(value=0)=>{const record={value:Array.from([value]).length};',
                ...Array.from({ length: members }, () => 'record.value;'), 'return record.value;};',
                ...Array.from({ length: callers }, (_, index) => `read(${index});`)].join('');
            const analysis = createAnalysis({ source });
            const { memberAccesses = [], calls = [] } = analysis;
            const selected = memberAccesses.filter(({ name = '' } = {}) => name === 'value');
            const work = counter();
            const { onWork = () => {} } = work;
            const results = selected.map(member => analysis.checkMemberAccess({ ...member, onWork }));

            strictEqual(work.get('source-context-selection'), 1, 'Stable model membership must share one filtered context view across source members');
            ok(results.every(({ missing = false, conflicts = [], evidence = [] } = {}) => !missing && !conflicts.length &&
                evidence.some(({ families = [] } = {}) => families.includes('object'))));
            const call = calls.findLast(({ callee = '' } = {}) => callee === 'read');
            const { status = '', fact: { families = [] } = {} } = analysis.checkCallResult({ ...call, required: 'number' });

            strictEqual(status, 'agreement');
            deepStrictEqual(families, ['number']);
            strictEqual(runInNewContext(source), 1);
        });

        const source = 'const read=(value="")=>{value.trim();value.trim();return value;};read("ready");if(false){read([]);}';
        const analysis = createAnalysis({ source });
        const { memberAccesses = [], promiseUses = [] } = analysis;
        const [first = {}, second = {}] = memberAccesses.filter(({ name = '' } = {}) => name === 'trim');
        const work = counter();
        const { onWork = () => {} } = work;
        const before = analysis.checkMemberAccess({ ...first, onWork });
        const { conflicts: beforeConflicts = [], incomplete: beforeIncomplete = false } = before;

        deepStrictEqual(beforeConflicts, []);
        strictEqual(work.get('source-context-selection'), 1);
        analysis.checkPromiseUse(promiseUses.at(-1));
        const { conflicts = [], incomplete = false } = analysis.checkMemberAccess({ ...second, onWork });

        deepStrictEqual(conflicts, []);
        strictEqual(incomplete, beforeIncomplete);
        strictEqual(work.get('source-context-selection'), 2, 'A new standalone frame must invalidate the old view and remain outside source evidence');
    });

    test('serialization preserves admitted roots beside unknown without inventing custom protocol results', () => {
        const samples = [8, 16].map((width) => {
            const source = ['const root=flag?"ready":external;', 'const v0=root;',
                ...Array.from({ length: width }, (_, index) => `const v${index + 1}=g${index}?v${index}:root;`),
                `const text=JSON.stringify(v${width});text.map(Boolean);`].join('');
            const analysis = createAnalysis({ source });
            const work = counter();
            const { onWork = () => {} } = work;
            const result = analysis.check({ index: 0, onWork });
            const { fact: { families = [], incomplete = false } = {} } = result;

            deepStrictEqual(families, ['string']);
            strictEqual(incomplete, true);
            strictEqual(findings(source).length, 1);
            const before = work.read();

            deepStrictEqual(analysis.check({ index: 0, onWork }), result);
            ['value-demand', 'flow-contribution', 'value-selection'].forEach(kind => strictEqual(work.get(kind), Reflect.get(before, kind) || 0));

            return work.get('value-demand') + work.get('flow-contribution') + work.get('value-selection');
        });

        ok(samples.at(0) > 0);
        ok(samples.at(1) <= samples.at(0) * 3, 'Successive shared selections must not multiply the serialized root histories');
        const source = 'JSON.stringify();JSON.stringify({toJSON:()=>void 0});JSON.stringify({value:1},()=>void 0);';
        const analysis = createAnalysis({ source });
        const calls = analysis.calls.filter(({ callee = '' } = {}) => callee === 'stringify');
        const [
            { fact: { families: absentFamilies = [] } = {} } = {},
            { fact: { families: customFamilies = [] } = {}, status: customStatus = '' } = {},
            { fact: { families: replacedFamilies = [] } = {}, status: replacedStatus = '' } = {}
        ] = calls.map(({ index = -1 } = {}) => analysis.checkCallResult({ index, required: 'string' }));

        deepStrictEqual(absentFamilies, ['nullish']);
        deepStrictEqual(customFamilies, []);
        deepStrictEqual(replacedFamilies, []);
        strictEqual(customStatus, 'unknown');
        strictEqual(replacedStatus, 'unknown');
        strictEqual(runInNewContext('JSON.stringify({toJSON:()=>void 0})'), runInNewContext('JSON.stringify({value:1},()=>void 0)'));
    });

    test('callback agreements remain explicit inside an unknown native call summary', () => {
        const analysis = createAnalysis({ source: 'const read=(state="",value=0)=>state;[1,2].reduce(read,"");' });
        const { status = '', obligations = [] } = analysis.checkCall({ index: 0 });

        strictEqual(status, 'unknown');
        strictEqual(obligations.length, 4);
        deepStrictEqual(obligations.map(({ status: result = '' } = {}) => result), ['agreement', 'agreement', 'agreement', 'agreement']);
    });
}

{
    const lint = findingsShared;

    test('primitive defaults retain independent generic evidence across revisions and query order', () => {
        const source = 'const read=(value=-1)=>value;read().trim();read("").map(Boolean);';
        const first = createAnalysis({ source });
        const second = createAnalysis({ source });
        const revised = createAnalysis({ source: source.replace('value=-1', 'value=""') });
        const before = first.checkFunction({ index: 0 });
        const { memberAccesses = [] } = second;

        memberAccesses.toReversed().forEach(({ index = -1 } = {}) => second.checkMemberAccess({ index }));
        deepStrictEqual(second.checkFunction({ index: 0 }), before);
        deepStrictEqual(first.checkFunction({ index: 0 }), before);
        deepStrictEqual(revised.checkFunction({ index: 0 }), before);
        strictEqual(lint(source).length, 2);
        strictEqual(lint(source.replace('value=-1', 'value=""')).length, 1);
    });
}

{
    const lint = (source, rule = 'signature-contract-operation') => new Linter().verify(source, {
        plugins: { resilient: plugin }, rules: { [`resilient/${rule}`]: 'error' }
    });

    test('positive native array evidence reaches destructuring policy without claiming fields', () => {
        const source = 'const read=value=>{if(Array.isArray(value)){const {name}=value;return name;}return "";};';
        const analysis = createAnalysis({ source });

        strictEqual(analysis.checkDestructuring({ index: 0 }).status, 'contradiction');
        strictEqual(lint(source, 'signature-contract-destructuring').length, 1);
    });

    test('guarded callable evidence preserves known local signatures at the caller', () => {
        const source = 'const select=value=>typeof value==="function"?value:()=>"";select((value="")=>value)(42);';

        strictEqual(lint(source, 'signature-contract-call-site').length, 1);
    });

    test('a captured field identity never claims to be the entire returned parameter', () => {
        const analysis = createAnalysis({ source: 'const field=({value}={})=>value;const whole=value=>value;' });

        strictEqual(analysis.checkFunction({ index: 0 }).returnedParameter, false);
        strictEqual(analysis.checkFunction({ index: 1 }).returnedParameter.index, 0);
    });

    test('native predicate evaluates its argument before producing a result', () => {
        const source = 'const fail=()=>{throw 1;};const read=()=>Array.isArray(fail());';
        const analysis = createAnalysis({ source });
        const { normal = true, thrown = false } = analysis.checkFunction({ index: 1 });

        strictEqual(normal, false);
        strictEqual(thrown, true);
    });

    test('guard queries preserve generic contracts, source revisions and query order', () => {
        const source = 'const read=value=>{if(typeof value==="number")return value.trim();return "";};read(42);read(external);';
        const first = createAnalysis({ source });
        const second = createAnalysis({ source });
        const revised = createAnalysis({ source: source.replace('==="number"', '!=="number"') });
        const { memberAccesses = [], calls = [] } = second;
        const before = first.checkFunction({ index: 0 });

        calls.toReversed().forEach(({ index = -1 } = {}) => second.checkCall({ index }));
        memberAccesses.toReversed().forEach(({ index = -1 } = {}) => second.checkMemberAccess({ index }));
        deepStrictEqual(second.checkFunction({ index: 0 }), before);
        deepStrictEqual(first.checkFunction({ index: 0 }), before);
        deepStrictEqual(revised.checkMemberAccess({ index: 0 }).conflicts, []);
        strictEqual(lint(source).length, 1);
    });
}

{
    const objectPredicate = 'const isObject=value=>Object.prototype.toString.call(value)==="[object Object]";';
    const objectNormalizer = `${objectPredicate}const normalize=value=>isObject(value)?value:{};`;
    const lint = source => new Linter().verify(source, plugin.configs.contracts);
    const functionFact = (analysis, index) => {
        const { fact = {} } = analysis.checkFunction({ index });

        return fact;
    };

    [
        ['string', 'typeof value === "string"', '""'],
        ['number', 'typeof value === "number"', '0'],
        ['boolean', 'typeof value === "boolean"', 'false'],
        ['array', 'Array.isArray(value)', '[]'],
        ['function', 'typeof value === "function"', '()=>0'],
        ['object', 'Object.prototype.toString.call(value) === "[object Object]"', '{}']
    ].forEach(([family = '', predicate = '', fallback = ''] = []) => {
        [
            ['direct predicate', `const normalize=value=>${predicate}?value:${fallback};`, 0],
            ['helper predicate', `const check=value=>${predicate};const normalize=value=>check(value)?value:${fallback};`, 1],
            ['aliased predicate and value', `const check=value=>${predicate};const alias=check;`
                + `const normalize=value=>{const selected=value;const valid=alias(selected);return valid?selected:${fallback};};`, 1],
            ['negative guard', `const check=value=>${predicate};const normalize=value=>{if(!check(value))return ${fallback};return value;};`, 1],
            ['returned predicate field', `const check=value=>({valid:${predicate}});const normalize=value=>check(value).valid?value:${fallback};`, 1]
        ].forEach(([name = '', source = '', index = 0] = []) => test(`normalization ${family}: ${name} preserves the input proof`, () => {
            const analysis = createAnalysis({ source });
            const { families = [], incomplete = true } = functionFact(analysis, index);

            deepStrictEqual(families, [family]);
            strictEqual(incomplete, false);
            deepStrictEqual(lint(source), []);
            const supplied = createAnalysis({ source: `${source}normalize(external);normalize(flag?external:other);` });
            const { calls = [] } = supplied;

            calls.filter(({ callee = '' } = {}) => callee === 'normalize').forEach(({ index = -1 } = {}) => {
                strictEqual(supplied.checkCallResult({ index, required: family }).status, 'agreement');
            });
        }));
    });

    [
        ['undefined', '{}'], ['null', '{}'], ['0', '{}'], ['false', '{}'], ['"text"', '{}'], ['[]', '{}'],
        ['({kind:"Identifier"})', '{kind:"Identifier"}']
    ].forEach(([input = '', expected = ''] = []) => test(`object normalization preserves the container contract for ${input}`, () => {
        const source = `${objectNormalizer}const {kind=""}=normalize(${input});`;

        deepStrictEqual(lint(source), []);
        strictEqual(runInNewContext(`${objectNormalizer}JSON.stringify(normalize(${input}));`),
            runInNewContext(`JSON.stringify(${expected});`));
    }));

    test('normalization preserves known fields and reports genuinely missing fields', () => {
        const source = `${objectNormalizer}normalize({kind:1}).kind;normalize({}).missing;normalize(undefined).missing;`;
        const analysis = createAnalysis({ source });
        const { memberAccesses = [] } = analysis;
        const members = memberAccesses.filter(({ name = '' } = {}) => ['kind', 'missing'].includes(name));

        deepStrictEqual(members.map(({ index = -1 } = {}) => analysis.checkMemberAccess({ index }).missing), [false, true, true]);
        deepStrictEqual(lint(source).map(({ messageId = '' } = {}) => messageId), ['missingProperty', 'missingProperty']);
    });

    test('normalization does not fabricate fields on generic inputs', () => {
        const source = `${objectNormalizer}const read=value=>{const {kind=""}=normalize(value);return kind;};`;

        deepStrictEqual(lint(source), []);
        strictEqual(functionFact(createAnalysis({ source }), 1).incomplete, false);
        strictEqual(functionFact(createAnalysis({ source }), 2).incomplete, true);
    });

    [
        ['generic formal', 'const read=value=>normalize(value).kind;'],
        ['external input', 'normalize(external).kind;'],
        ['known field beside unknown', 'normalize(flag?{kind:1}:external).kind;'],
        ['successive fields', 'const read=value=>normalize(normalize(value).child).kind;'],
        ['retired object fields', 'const value={};opaque(value);normalize(value).kind;'],
        ['aliased result', 'const read=value=>{const selected=normalize(value);const alias=selected;return alias.kind;};']
    ].forEach(([name = '', use = ''] = []) => test(`empty normalization fallback stays open: ${name}`, () => {
        const source = `${objectNormalizer}${use}`;
        const analysis = createAnalysis({ source });
        const { memberAccesses = [], checkMemberAccess = () => ({}) } = analysis;
        const [{ index = -1 } = {}] = memberAccesses.filter(({ name = '' } = {}) => name === 'kind');
        const { missing = true, incomplete = false } = checkMemberAccess({ index });

        strictEqual(missing, false);
        // Open means no field claim, not proof that kind exists or has a family.
        strictEqual(incomplete, true);
        deepStrictEqual(lint(source), []);
    }));

    [
        ['inline conditional', 'const read=value=>(isObject(value)?value:{}).kind;'],
        ['logical selection', 'const read=value=>(isObject(value)&&value||{}).kind;'],
        ['early return', 'const normalize=value=>{if(!isObject(value))return {};return value;};const read=value=>normalize(value).kind;'],
        ['destructured input', 'const normalize=({value}={})=>isObject(value)?value:{};normalize(flag?{value:{kind:1}}:external).kind;'],
        ['predicate field', 'const check=value=>({valid:isObject(value)});const normalize=value=>check(value).valid?value:{};normalize(external).kind;']
    ].forEach(([name = '', source = ''] = []) => test(`open normalization composes through ${name}`, () => {
        deepStrictEqual(lint(`${objectPredicate}${source}`), []);
    }));

    [
        ['concrete empty', '{}'], ['absence', 'undefined'], ['Boolean', 'false'], ['array', '[]'],
        ['typo on known input', '{other:1}'], ['empty beside unknown', 'flag?{}:external'],
        ['primitive beside unknown', 'flag?false:external'], ['absence beside known field', 'flag?{kind:1}:undefined']
    ].forEach(([name = '', input = ''] = []) => test(`open normalization retains real missing fields: ${name}`, () => {
        const source = `${objectNormalizer}normalize(${input}).kind;`;

        deepStrictEqual(lint(source).map(({ messageId = '' } = {}) => messageId), ['missingProperty']);
    }));

    [
        ['ordinary empty alternative', '(flag?{}:external).kind;'],
        ['constructed result', 'const normalize=value=>isObject(value)?{other:1}:{};normalize(external).kind;'],
        ['nonempty fallback', 'const normalize=value=>isObject(value)?value:{other:1};normalize(external).kind;'],
        ['unrelated argument', 'const normalize=(first,second)=>isObject(first)?second:{};normalize(external,other).kind;'],
        ['independent empty return', 'const normalize=value=>flag?(isObject(value)?value:{}):{};normalize(external).kind;'],
        ['empty return on passing guard', 'const normalize=value=>isObject(value)?flag?value:{}:{};normalize(external).kind;']
    ].forEach(([name = '', source = ''] = []) => test(`open normalization is not a blanket empty-object exemption: ${name}`, () => {
        deepStrictEqual(lint(`${objectPredicate}${source}`).map(({ messageId = '' } = {}) => messageId), ['missingProperty']);
    }));

    test('a mismatched fallback retains the known return contradiction', () => {
        const source = `${objectPredicate}const normalize=value=>isObject(value)?value:[];`;
        const analysis = createAnalysis({ source });

        deepStrictEqual(functionFact(analysis, 1).families.toSorted(), ['array', 'object']);
        deepStrictEqual(lint(source).map(({ ruleId = '' } = {}) => ruleId), [
            'resilient/signature-contract-return-consistency', 'resilient/signature-contract-return-consistency'
        ]);
    });

    test('known contradiction survives beside an unresolved predicate result', () => {
        const source = 'const check=value=>typeof value==="string";const normalize=value=>check(value)?value:external?unknown:42;';
        const analysis = createAnalysis({ source });
        const { families = [], incomplete = false } = functionFact(analysis, 1);

        deepStrictEqual(families.toSorted(), ['number', 'string']);
        strictEqual(incomplete, true);
        strictEqual(lint(source).filter(({ ruleId = '' } = {}) => ruleId.endsWith('return-consistency')).length, 2);
    });

    [
        ['namespace alias', 'const Native=Object;const check=value=>Native.prototype.toString.call(value)==="[object Object]";'],
        ['method alias', 'const tag=Object.prototype.toString;const check=value=>tag.call(value)==="[object Object]";'],
        ['reversed equality', 'const check=value=>"[object Object]"===Object.prototype.toString.call(value);']
    ].forEach(([name = '', predicate = ''] = []) => test(`native tag identity: ${name}`, () => {
        const source = `${predicate}const normalize=value=>check(value)?value:{};`;

        deepStrictEqual(functionFact(createAnalysis({ source }), 1).families, ['object']);
        strictEqual(functionFact(createAnalysis({ source }), 1).incomplete, false);
    }));

    [
        ['lexical shadow', 'const Object=external;']
    ].forEach(([name = '', prefix = ''] = []) => test(`normalization retires proof after ${name}`, () => {
        strictEqual(functionFact(createAnalysis({ source: `${prefix}${objectNormalizer}` }), 1).incomplete, true);
    }));

    test('an extracted call method does not acquire its former receiver', () => {
        const source = 'const call=Object.prototype.toString.call;const check=value=>call(value)==="[object Object]";const normalize=value=>check(value)?value:{};';

        strictEqual(functionFact(createAnalysis({ source }), 1).incomplete, true);
        throws(() => runInNewContext(`${source}normalize({});`), /TypeError/u);
    });

    test('tag observation preserves argument failure and object identity', () => {
        const source = `${objectNormalizer}const fail=()=>{throw 7;};normalize(fail());`;
        const analysis = createAnalysis({ source });
        const { calls = [] } = analysis;
        const [{ index = -1 } = {}] = calls.filter(({ callee = '' } = {}) => callee === 'normalize');
        const { normal = true, thrown = false } = analysis.checkCallResult({ index, required: 'object' });

        strictEqual(normal, false);
        strictEqual(thrown, true);
        strictEqual(runInNewContext(`${objectNormalizer}const input={};normalize(input)===input;`), true);
    });

    test('normalization composes across renamed imports and source revisions', () => {
        const filename = '/normalization/main.js';
        const source = 'import {convert as selected} from "./barrel.js";const {kind=""}=selected(undefined);selected({kind:1}).kind;';
        const modules = new Map([
            ['/normalization/barrel.js', 'export {normalize as convert} from "./worker.js";'],
            ['/normalization/worker.js', `${objectPredicate}export const normalize=value=>isObject(value)?value:{};`]
        ]);
        const resolver = ({ source = '' } = {}) => `/normalization/${source.slice(2)}`;
        const analysis = createAnalysis({ source, filename, resolveModule: (input) => {
            const filename = resolver(input);

            return { filename, source: modules.get(filename) };
        } });
        const { calls = [] } = analysis;

        calls.filter(({ callee = '' } = {}) => callee === 'selected').forEach(({ index = -1 } = {}) => {
            strictEqual(analysis.checkCallResult({ index, required: 'object' }).status, 'agreement');
        });
        const revised = createAnalysis({ source: `${objectPredicate}const normalize=value=>isObject(value)?value:42;` });

        deepStrictEqual(functionFact(revised, 1).families.toSorted(), ['number', 'object']);
        calls.filter(({ callee = '' } = {}) => callee === 'selected').forEach(({ index = -1 } = {}) => {
            strictEqual(analysis.checkCallResult({ index, required: 'object' }).status, 'agreement');
        });
    });

    test('product rules consume the installed normalizer contract through named and namespace imports', async () => {
        const filename = fileURLToPath(new URL('normalization-input.js', import.meta.url));
        const normalizer = fileURLToPath(import.meta.resolve('eslint-plugin-resilient/standard/object'));
        const resolver = ({ source = '' } = {}) => source === 'eslint-plugin-resilient/standard/object' ? normalizer : '';
        const engine = new ESLint({ overrideConfigFile: true, overrideConfig: [plugin.configs.contracts, {
            settings: { resilient: { resolver } }
        }] });
        const source = 'import {getObject as normalize} from "eslint-plugin-resilient/standard/object";'
            + 'import * as objects from "eslint-plugin-resilient/standard/object";'
            + 'const {kind=""}=normalize(undefined);objects.getObject({kind:1}).kind;'
            + 'const {count=0}=normalize(false);void count;'
            + 'const read=value=>{const {kind=""}=normalize(value);return kind;};'
            + 'const field=value=>normalize(value).kind;objects.getObject(external).child;normalize({}).missing;'
            + 'const inspect=value=>Object.getOwnPropertyDescriptors(value);void inspect;';
        const [{ messages = [] } = {}] = await engine.lintText(source, { filePath: filename });

        deepStrictEqual(messages.map(({ messageId = '' } = {}) => messageId), ['missingProperty']);
    });

    test('guarded selected values retain known field alternatives', () => {
        const source = `${objectPredicate}const normalize=({value}={})=>isObject(value)?value:{};`
            + 'normalize({value:{kind:1}}).kind;normalize(flag?{value:{kind:1}}:{value:{}}).kind;'
            + 'normalize(flag?{value:{kind:1}}:unknown).kind;';

        // An unknown input's empty normalization fallback does not declare a
        // closed shape; the explicit supplied {value:{}} still lacks kind.
        deepStrictEqual(lint(source).map(({ messageId = '' } = {}) => messageId), ['missingProperty']);
    });

    [
        ['Boolean(x)', 'Boolean'], ['String(x)', 'String'], ['Number(x)', 'Number'],
        ['(x?external:false)', 'returned false alternative']
    ].forEach(([value = '', name = ''] = []) => test(`object normalization retains primitive evidence after ${name} escapes`, () => {
        const source = `${objectNormalizer}const read=x=>{const value=flag?${value}:external;opaque(value);`
            + 'const {kind=""}=normalize(value);return normalize(value);};';
        const analysis = createAnalysis({ source });
        const { families = [], incomplete = true } = functionFact(analysis, 2);

        deepStrictEqual(families, ['object']);
        strictEqual(incomplete, false);
        deepStrictEqual(lint(source), []);
    }));

    test('primitive object tags do not claim that boxed values are primitives', () => {
        ['String', 'Number', 'Boolean'].forEach((tag) => {
            const source = `const check=value=>Object.prototype.toString.call(value)==="[object ${tag}]";const normalize=value=>check(value)?value:"";`;

            strictEqual(functionFact(createAnalysis({ source }), 1).incomplete, true);
            strictEqual(runInNewContext(`${source}typeof normalize(new ${tag}());`), 'object');
        });
    });

    test('a predicate cannot refine another argument or a later replacement', () => {
        [
            `${objectPredicate}const normalize=(first,second)=>isObject(first)?second:{};`,
            `${objectPredicate}const normalize=value=>{let selected=value;if(isObject(selected)){selected=external;return selected;}return {};};`,
            'const check=value=>true;const normalize=value=>check(value)?value:{};',
            'const check=value=>typeof value==="object";const normalize=value=>check(value)?value:{};'
        ].forEach((source) => {
            strictEqual(functionFact(createAnalysis({ source }), 1).incomplete, true);
        });
    });

    [12, 24, 48].forEach(width => test(`normalization preserves wide and successive joins at ${width}`, (context) => {
        const branches = Array.from({ length: width }, (item, index) => `flag${index}?{kind:${index}}:`).join('');
        const successive = Array.from({ length: width }).reduce(source => `normalize(${source})`, 'external');
        const source = `${objectNormalizer}normalize(${branches}external);${successive};`
            + Array.from({ length: width }, (_, index) => `const inspect${index}=value=>Object.getOwnPropertyDescriptors(value);void inspect${index};`).join('');
        const work = counter();
        const { onWork = () => {} } = work;
        const analysis = createAnalysis({ source });
        const { calls = [], checkCallResult = () => ({}) } = analysis;
        const normalizations = calls.filter(({ callee = '' } = {}) => callee === 'normalize');

        normalizations.forEach(({ index = -1 } = {}) => {
            strictEqual(checkCallResult({ index, required: 'object', onWork }).status, 'agreement');
        });
        const { counts = {} } = analysis;

        normalizations.toReversed().forEach(({ index = -1 } = {}) => {
            strictEqual(checkCallResult({ index, required: 'object' }).status, 'agreement');
        });
        const { counts: repeated = {} } = analysis;

        deepStrictEqual(repeated, counts);
        context.diagnostic(JSON.stringify({ width, ...work.read(), counts }));
    }));

    [12, 24, 48].forEach(width => test(`open normalized fields preserve wide and successive composition at ${width}`, () => {
        const branches = Array.from({ length: width }, (item, index) => `flag${index}?{kind:${index}}:`).join('');
        const successive = Array.from({ length: width }).reduce(source => `normalize(${source})`, 'external');
        const source = `${objectNormalizer}normalize(${branches}external).kind;${successive}.kind;normalize(flag?{}:external).missing;`;
        const analysis = createAnalysis({ source });
        const { memberAccesses = [], checkMemberAccess = () => ({}) } = analysis;
        const selected = memberAccesses.filter(({ name = '' } = {}) => ['kind', 'missing'].includes(name));
        const expected = selected.map(({ index = -1 } = {}) => checkMemberAccess({ index }));
        const work = counter();
        const { onWork = () => {} } = work;

        deepStrictEqual(expected.map(({ missing = false } = {}) => missing), [false, false, true]);
        deepStrictEqual(selected.toReversed().map(({ index = -1 } = {}) => checkMemberAccess({ index, onWork })).toReversed(), expected);
        strictEqual(work.get('value-demand'), 0);
        strictEqual(work.get('value-selection'), 0);
        deepStrictEqual(lint(source).map(({ messageId = '' } = {}) => messageId), ['missingProperty']);
    }));

    test('open fallback evidence remains local to its source revision and recovers after observation failure', () => {
        const source = `${objectNormalizer}normalize(external).kind;`;
        const analysis = createAnalysis({ source });
        const { memberAccesses = [], checkMemberAccess = () => ({}) } = analysis;
        const [{ index = -1 } = {}] = memberAccesses.filter(({ name = '' } = {}) => name === 'kind');
        const failure = new Error('shape observation failed');

        throws(() => checkMemberAccess({ index, onWork: ({ kind = '' } = {}) => {
            if (kind === 'value-selection') throw failure;
        } }), error => error === failure);
        const expected = createAnalysis({ source }).checkMemberAccess({ index });
        const { missing = true } = expected;

        strictEqual(missing, false);
        deepStrictEqual(checkMemberAccess({ index }), expected);
        deepStrictEqual(lint(source.replace('normalize(external)', 'normalize({})')).map(({ messageId = '' } = {}) => messageId), ['missingProperty']);
        deepStrictEqual(checkMemberAccess({ index }), expected);
    });

    test('query order and warm demand keep normalizer evidence stable', () => {
        const source = `${objectNormalizer}normalize({kind:1}).kind;const read=x=>{const {kind=""}=normalize(x);return kind;};`
            + 'const inspect=value=>Object.getOwnPropertyDescriptors(value);void inspect;';
        const first = createAnalysis({ source });
        const second = createAnalysis({ source });
        const before = first.checkFunction({ index: 1 });
        const work = counter();
        const { onWork = () => {} } = work;
        const { memberAccesses = [], calls = [], checkCallResult = () => ({}) } = second;

        calls.toReversed().forEach(({ index = -1 } = {}) => checkCallResult({ index, required: 'object' }));
        const { checkMemberAccess = () => ({}) } = second;

        memberAccesses.toReversed().forEach(({ index = -1 } = {}) => checkMemberAccess({ index }));
        deepStrictEqual(second.checkFunction({ index: 1 }), before);
        first.checkFunction({ index: 1, onWork });
        strictEqual(work.get('value-demand'), 0);
        const failure = new Error('observation failed');

        throws(() => createAnalysis({ source }).checkFunction({ index: 1, onWork: () => { throw failure; } }), error => error === failure);
    });
}
