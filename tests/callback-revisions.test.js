import { deepStrictEqual, ok, strictEqual } from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

import { Linter } from 'eslint';

import { createAnalysis } from 'eslint-plugin-resilient/analyzer';
import plugin from 'eslint-plugin-resilient/eslint';

const guardRule = 'no-unguarded-callback-invocation';
const returnRule = 'signature-contract-return-consistency';
const callRule = 'signature-contract-call-site';
const lint = (source, names = [guardRule]) => new Linter().verify(source, {
    plugins: { resilient: plugin }, rules: Object.fromEntries(names.map(name => [`resilient/${name}`, 'error']))
});
const callbacks = analysis => analysis.invocations.filter(({ optionalCallback = false } = {}) => optionalCallback);
const statuses = analysis => callbacks(analysis).map(({ index = -1 } = {}) => analysis.checkInvocation({ index }).status);

[
    ['stale guard', 'if(typeof done==="function"){done=external;done();}', ['contradiction']],
    ['fresh guard', 'done=external;if(typeof done==="function")done();', ['agreement']],
    ['fresh nested guard', 'if(typeof done==="function"){done=external;if(typeof done==="function")done();}', ['agreement']],
    ['early exit guard', 'done=external;if(typeof done!=="function")return;done();', ['agreement']],
    ['earlier invocation', 'if(typeof done==="function"){done();done=external;}', ['agreement']],
    ['conditional write', 'if(typeof done==="function"){if(flag)done=external;done();}', ['contradiction']],
    ['terminated write path', 'if(typeof done==="function"){if(flag){done=external;return;}done();}', ['agreement']],
    ['thrown write path', 'if(typeof done==="function"){if(flag){done=external;throw 0;}done();}', ['agreement']],
    ['unreachable write', 'if(typeof done==="function"){if(false)done=external;done();}', ['agreement']],
    ['successive writes', 'done=first;if(typeof done!=="function")return;done=second;done();', ['contradiction']],
    ['successive guards', 'done=first;if(typeof done!=="function")return;done=second;if(typeof done==="function")done();', ['agreement']],
    ['joined guards', 'if(flag){done=first;}else{done=second;}if(typeof done==="function")done();', ['agreement']],
    ['independent return', 'if(flag)return;done=external;if(typeof done==="function")done();', ['agreement']],
    ['later finalizer', 'if(typeof done==="function"){try{done();}finally{done=external;}}', ['agreement']],
    ['earlier finalizer', 'if(typeof done==="function"){try{}finally{done=external;}done();}', ['contradiction']],
    ['captured stale guard', 'if(typeof done==="function"){const invoke=()=>done();done=external;return invoke;}', ['contradiction']],
    ['captured local guard', 'done=external;return ()=>{if(typeof done==="function")done();};', ['agreement']],
    ['capture after final write', 'done=external;if(typeof done==="function")return ()=>done();', ['agreement']],
    ['unreachable write preserves capture', 'if(typeof done==="function"){if(false)done=external;return ()=>done();}', ['agreement']],
    ['opposite write path preserves capture', 'if(typeof done==="function"){if(flag){done=external;return;}return ()=>done();}', ['agreement']],
    ['suspended mutable capture', 'const invoke=async()=>{if(typeof done==="function"){await wait;done();}};done=external;return invoke;', ['unknown']],
    ['mutable alias has its own guard', 'const alias=done;done=external;if(typeof alias==="function")alias();', ['agreement']],
    ['alias cannot guard new value', 'const alias=done;done=external;if(typeof alias==="function")done();', ['contradiction']],
    ['new value cannot guard alias', 'const alias=done;done=external;if(typeof done==="function")alias();', ['contradiction']],
    ['unresolved stale predicate', 'if(isFunction(done)){done=external;done();}', ['contradiction']],
    ['unresolved fresh predicate', 'done=external;if(isFunction(done))done();', ['agreement']],
    ['unresolved successive predicate', 'if(isFunction(done)){done=external;if(isFunction(done))done();}', ['agreement']],
    ['capture after syntax guard and final write', 'done=external;if(isFunction(done))return ()=>done();', ['agreement']],
    ['syntax capture before later write', 'if(isFunction(done)){const invoke=()=>done();done=external;return invoke;}', ['contradiction']],
    ['receiver call', 'done=external;if(typeof done==="function")done.call(receiver);', ['agreement']],
    ['receiver apply', 'if(typeof done==="function"){done=external;done.apply(receiver,args);}', ['contradiction']],
    ['unsupported compound write', 'if(typeof done==="function"){done+=external;done();}', ['unknown']],
    ['unsupported expression write', 'if(typeof done==="function"){(done=external,done());}', ['unknown']],
    ['unsupported captured write', 'const change=()=>{done=external;};if(typeof done==="function"){change();done();}', ['unknown']],
    ['unsupported repeated write', 'do{done=external;}while(flag);if(typeof done==="function")done();', ['unknown']]
].forEach(([name = '', body = '', expected = []] = []) => test(`callback revision: ${name}`, () => {
    const source = `const run=({done}={})=>{${body}};`;
    const analysis = createAnalysis({ source });

    deepStrictEqual(statuses(analysis), expected);
    const direct = callbacks(analysis).filter(({ direct = false } = {}) => direct);

    strictEqual(lint(source).length, direct.filter(({ index = -1 } = {}) => analysis.checkInvocation({ index }).status === 'contradiction').length);
    const engine = new Linter();
    const { output = '', fixed = false } = engine.verifyAndFix(source, { plugins: { resilient: plugin }, rules: { [`resilient/${guardRule}`]: 'error' } });

    strictEqual(output, source);
    strictEqual(fixed, false);
}));

[
    ['value=>true', 'contradiction'],
    ['()=>({})', 'unknown'],
    ['()=>()=>0', 'contradiction'],
    ['async value=>typeof value==="function"', 'contradiction'],
    ['function*(value){return typeof value==="function";}', 'contradiction'],
    ['value=>typeof value==="function"', 'agreement'],
    ['value=>value&&typeof value==="function"', 'agreement'],
    ['value=>external(value)', 'unknown']
].forEach(([helper = '', expected = ''] = []) => test(`helper evidence: ${helper}`, () => {
    const source = `const isFunction=${helper};const run=({done}={})=>isFunction(done)&&done();`;

    deepStrictEqual(statuses(createAnalysis({ source })), [expected]);
    strictEqual(lint(source).length, Number(expected === 'contradiction'));
}));

['()=>[]', 'function named(){return [];}'].forEach(fallback => test(`authored default and supplied value: ${fallback}`, () => {
    const source = `const read=(cb=${fallback})=>cb();read();read(void 0);read(()=>"");read(external);`;
    const analysis = createAnalysis({ source });
    const calls = analysis.calls.filter(({ callee = '' } = {}) => callee === 'read');

    deepStrictEqual(calls.map(({ index = -1 } = {}) => analysis.checkCallResult({ index, required: 'array' }).status), ['agreement', 'agreement', 'contradiction', 'unknown']);
    strictEqual(analysis.checkFunction({ index: 0 }).status, 'unknown');
}));

[
    'const read=(cb=()=>0)=>{if(flag)return [];return "";};',
    'const read=(cb=function(){return 0;})=>{if(flag)return [];return "";};',
    'const read=({cb=()=>0}={})=>{if(flag)return [];return "";};',
    'const read=(cb=async()=>0)=>{if(flag)return [];return "";};'
].forEach(source => test(`default creation preserves enclosing contradictions: ${source}`, () => {
    const analysis = createAnalysis({ source });

    strictEqual(analysis.checkFunction({ index: 0 }).status, 'contradiction');
    strictEqual(lint(source, [returnRule]).length, 2);
}));

test('acquired default body keeps its own diagnostics and forwarded call origin', () => {
    const source = 'const read=(cb=(value="")=>value)=>cb(42);read();';
    const findings = lint(source, [callRule]);

    strictEqual(findings.length, 1);
    const [{ column = 0, endColumn = 0, message = '' } = {}] = findings;

    strictEqual(source.slice(column - 1, endColumn - 1), 'read()');
    strictEqual(message, 'argument expects string-like, but this call supplies number-like.');
    const nested = 'const read=(cb=flag=>flag?[]:"")=>cb;';

    strictEqual(createAnalysis({ source: nested }).checkFunction({ index: 1 }).status, 'contradiction');
    strictEqual(lint(nested, [returnRule]).length, 2);
});

test('authored function contract does not validate supplied nonfunctions', () => {
    const source = 'const read=(cb=()=>[])=>cb();read(42);read(null);read(external);read(()=>[]);';
    const findings = lint(source, [callRule]);

    deepStrictEqual(findings.map(({ column = 0, endColumn = 0 } = {}) => source.slice(column - 1, endColumn - 1)), ['42', 'null']);
});

test('parameter closure does not resolve names from body declarations', () => {
    const source = 'const value=[];const read=(cb=()=>value)=>{const value="";return cb();};read();';
    const analysis = createAnalysis({ source });
    const [{ index = -1 } = {}] = analysis.calls.filter(({ callee = '' } = {}) => callee === 'read');
    const { status = '', fact: { causes = [] } = {} } = analysis.checkCallResult({ index, required: 'array' });

    strictEqual(runInNewContext(`${source.slice(0, -7)}JSON.stringify(read());`), '[]');
    strictEqual(status, 'unknown');
    ok(causes.some(({ code = '' } = {}) => code === 'captured-value'));
});

test('product queries are independent of query order and later source revisions', () => {
    const source = 'const run=({done}={})=>{done=external;if(typeof done!=="function")return;done();done=other;done();};';
    const inspect = (analysis, reverse = false) => {
        const queries = [
            ...analysis.calls.map(({ index = -1 } = {}) => () => analysis.checkCall({ index })),
            ...analysis.calls.map(({ index = -1 } = {}) => () => analysis.checkCallResult({ index, required: 'array' })),
            ...analysis.functions.map(({ index = -1 } = {}) => () => analysis.checkFunction({ index })),
            ...analysis.invocations.map(({ index = -1 } = {}) => () => analysis.checkInvocation({ index }))
        ];

        if (reverse) queries.toReversed().forEach(query => query());

        return queries.map(query => query());
    };
    const original = createAnalysis({ source });
    const expected = inspect(original);

    deepStrictEqual(statuses(original), ['agreement', 'contradiction']);
    deepStrictEqual(inspect(createAnalysis({ source }), true), expected);
    const revised = createAnalysis({ source: source.replace('done=other;done();', 'done=other;if(typeof done==="function")done();') });

    deepStrictEqual(statuses(revised), ['agreement', 'agreement']);
    deepStrictEqual(inspect(original, true), expected);
});

test('cannot turn an illegal immutable write into a successful revision', () => {
    const source = 'const run=({done}={})=>{const alias=done;if(typeof alias==="function"){alias=external;alias();}};';
    const analysis = createAnalysis({ source });

    strictEqual(analysis.invocations.length, 1);
    strictEqual(analysis.checkInvocation({ index: 0 }).status, 'unknown');
    deepStrictEqual(lint(source), []);
});

test('inert defaults preserve unrelated function findings', () => {
    const source = 'function zip(as,bs){if(bs===undefined)return bs=>zip(bs,as);return [];}function unrelated(callback=()=>true){return [];}';
    const findings = lint(source, [returnRule]);

    deepStrictEqual(findings.map(({ messageId = '' } = {}) => messageId), ['inconsistent', 'inconsistentValue', 'inconsistent']);
    const [{ column = 0, endColumn = 0 } = {}] = findings.filter(({ messageId = '' } = {}) => messageId === 'inconsistentValue');

    strictEqual(source.slice(column - 1, endColumn - 1), 'zip(bs,as)');
    strictEqual(runInNewContext(`${source} typeof zip()([]);`), 'function');
    strictEqual(runInNewContext(`${source} Array.isArray(zip([])([]));`), true);
});

test('wide callback revisions retain the final guard within the decision budget', () => {
    const size = 128;
    const writes = Array.from({ length: size }, (_, index) => `if(flag${index})done=external${index};`).join('');
    const source = `const run=({done}={})=>{${writes}if(typeof done==="function")done();};`;
    const analysis = createAnalysis({ source, limits: { decisions: 60000, demand: 60000 } });

    deepStrictEqual(statuses(analysis), ['agreement']);
    const { counts = {} } = analysis;

    deepStrictEqual(statuses(analysis), ['agreement']);
    const { counts: repeated = {} } = analysis;

    deepStrictEqual(repeated, counts);
});
