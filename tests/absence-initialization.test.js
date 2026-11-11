import { deepStrictEqual, doesNotThrow, strictEqual, throws } from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

import { Linter } from 'eslint';

import { createAnalysis } from 'eslint-plugin-resilient/analyzer';
import plugin from 'eslint-plugin-resilient/eslint';

const configuration = { plugins: { resilient: plugin }, rules: {
    'resilient/prefer-safe-destructuring-defaults': 'error', 'resilient/signature-contract-destructuring': 'error'
} };
const decision = (source, name = 'value') => {
    const analysis = createAnalysis({ source });
    const { index = -1 } = analysis.declarations.find(({ name: selected = '' } = {}) => selected === name) ?? {};

    return analysis.checkDeclaration({ index });
};
const placements = [
    ['later parameter', expression => `const run=({value},next=${expression})=>!!value;`],
    ['sibling property', expression => `const run=({value,next=${expression}})=>!!value;`],
    ['nested property', expression => `const run=({value,options:{next=${expression}}={}})=>!!value;`],
    ['later destructured parameter', expression => `const run=({value},{next=${expression}}={})=>!!value;`],
    ['local pattern', expression => `const run=({value})=>{const {next=${expression}}={};return !!value;};`],
    ['opaque catch pattern', expression => `const run=({value})=>{try{throw {};}catch({next=${expression}}){}return !!value;};`, true],
    ['nested execution', expression => `const outer=({value})=>(next=${expression})=>!!value;const run=input=>outer(input)();`]
];
const inputs = [
    { name: 'member receiver', expression: 'value.length', required: true },
    { name: 'invocation', expression: 'value()', required: true },
    { name: 'iterable spread', expression: '[...value]', required: true },
    { name: 'logical iterable spread', expression: '[...(value&&[])]', required: true },
    { name: 'native receiver', expression: 'Object.keys(value)', required: true },
    { name: 'Boolean read', expression: '!!value', required: false },
    { name: 'typeof read', expression: 'typeof value', required: false },
    { name: 'conditional member read', expression: 'value?value.length:0', required: false },
    { name: 'conditional forwarding', expression: 'value?value:0', required: false },
    { name: 'object spread', expression: '({...value})', required: false },
    { name: 'guarded object spread', expression: '({...value&&{value}})', required: false },
    { name: 'disjunction fallback', expression: 'value||[]', required: false },
    { name: 'nullish fallback', expression: 'value??[]', required: false },
    { name: 'property name collision', expression: '({value:1})', required: false },
    { name: 'method name collision', expression: '({value(){return 1;}})', required: false },
    { name: 'function name collision', expression: '(function value(){return 1;})', required: false }
];

placements.forEach(([placement = '', make = () => '', opaque = false] = []) => inputs.forEach(({ name = '', expression = '', required = true } = {}) => {
    test(`initializer absence: ${placement}, ${name}`, () => {
        const source = make(expression);

        // Catch patterns already retain an opaque execution boundary, even
        // when this individual initializer can execute safely with absence.
        strictEqual(decision(source).required, required || opaque, source);
        const findings = new Linter().verify(source, configuration);

        strictEqual(findings.some(({ messageId = '', column = 0 } = {}) => messageId === 'safeDefault' && column === source.indexOf('value') + 1), required || opaque);
        ['{}', '{value:null}'].forEach((input) => {
            const execute = () => runInNewContext(`${source}run(${input});`);

            if (required) {
                throws(execute, ({ name = '' } = {}) => name === 'TypeError');

                return;
            }

            doesNotThrow(execute);
        });
    });
}));

test('computed parameter keys, enclosing defaults and closure reads retain their own obligations', () => {
    ['const run=({value},{[value.length]:next}={})=>!!value;',
        'const run=({value},[next=value.length]=[])=>!!value;',
        'const run=({value},{next}={next:value.length})=>!!value;',
        'const run=({value},next=()=>value.length)=>!!value;',
        'const run=({value},next=(value.length,0))=>!!value;',
        'const run=({value},next=`${value.length}`)=>!!value;']
        .forEach(source => strictEqual(decision(source).required, true, source));
});

test('a guarded invocation cannot discharge another data read before or after it', () => {
    ['const run=({value},next=value.length)=>{if(typeof value==="function")value();};',
        'const run=({value})=>{const next=value.length;if(typeof value==="function")value();};',
        'const run=({value})=>{if(typeof value==="function")value();return value.length;};',
        'const run=({value})=>{if(typeof value==="function")value();return ()=>value.length;};',
        'const run=({value})=>{external(value);if(typeof value==="function")value();};',
        'const run=({value})=>{if(typeof value==="function")value();return external(value);};',
        'const run=({value})=>{if(typeof value==="function")value();return values.map(value);};',
        'const {value}={};export {value};if(typeof value==="function")value();']
        .forEach(source => strictEqual(decision(source).required, true, source));
    const guarded = 'const run=({value})=>{if(typeof value!=="function")return;value();return value.length;};';

    strictEqual(decision(guarded).required, false);
    strictEqual(decision('const run=({value})=>{if(typeof value!=="function")return;external(value);value();};').required, false);
});

test('namespace and import labels and meta-properties do not read colliding locals', () => {
    ['const {value}={};export * as value from "dependency";!!value;',
        'const {value}={};import {value as other} from "dependency";!!value;',
        'const {value}={};export {value as other} from "dependency";!!value;']
        .forEach((source) => {
            strictEqual(decision(source).required, false, source);
            deepStrictEqual(new Linter().verify(source, configuration), []);
        });
    strictEqual(decision('const run=function({target}){new.target;return !!target;};', 'target').required, false);
    strictEqual(decision('const {meta}={};import.meta;!!meta;', 'meta').required, false);
});

test('initializer references are isolated across source revisions and query orders', () => {
    const safe = 'const run=({value},next=!!value)=>!!value;run({});';
    const unsafe = safe.replace('next=!!value', 'next=value.length');
    const analysis = createAnalysis({ source: safe });
    const revised = createAnalysis({ source: unsafe });
    const fields = analysis.declarations.filter(({ name = '' } = {}) => name === 'value');
    const [{ index = -1 } = {}] = fields;
    const before = analysis.checkDeclaration({ index });
    const { required = true } = before;

    revised.calls.toReversed().forEach(({ index = -1 } = {}) => revised.checkCall({ index }));
    strictEqual(revised.checkDeclaration({ index }).required, true);
    deepStrictEqual(analysis.checkDeclaration({ index }), before);
    strictEqual(required, false);
});

test('parameter reads precede body guards and supplied later arguments cannot author a generic absence contract', () => {
    const source = 'const run=({value},next=value.length)=>!!value;';

    strictEqual(decision(`${source}run({},0);`).required, true);
    strictEqual(runInNewContext(`${source}run({},0);`), false);
    const trace = runInNewContext(`
        const events=[];
        const input={get value(){events.push('field');return undefined;}};
        const run=({value},next=(events.push('initializer'),value.length))=>{
            events.push('body');return !!value;
        };
        try{run(input);}catch(error){events.push(error.name);}
        JSON.stringify(events);
    `);

    deepStrictEqual(JSON.parse(trace), ['field', 'initializer', 'TypeError']);
});
