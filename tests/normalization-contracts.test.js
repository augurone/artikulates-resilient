import { deepStrictEqual, strictEqual, throws } from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

import { ESLint, Linter } from 'eslint';

import { createAnalysis } from 'eslint-plugin-resilient/analyzer';
import plugin from 'eslint-plugin-resilient/eslint';

import { counter } from './support/work.js';

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
    ['lexical shadow', 'const Object=external;'],
    ['overwritten intrinsic', 'Object.prototype.toString=external;'],
    ['overwritten call protocol', 'Function.prototype.call=external;'],
    ['prototype escape', 'external(Object.prototype);'],
    ['source-visible tag replacement', 'Array.prototype[Symbol.toStringTag]="Object";']
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
        + 'const read=value=>{const {kind=""}=normalize(value);return kind;};'
        + 'const field=value=>normalize(value).kind;objects.getObject(external).child;normalize({}).missing;';
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
    const source = `${objectNormalizer}normalize(${branches}external);${successive};`;
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
    const source = `${objectNormalizer}normalize({kind:1}).kind;const read=x=>{const {kind=""}=normalize(x);return kind;};`;
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
