import { deepStrictEqual, strictEqual, throws } from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

import { Linter } from 'eslint';

import { createAnalysis } from 'eslint-plugin-resilient/analyzer';
import plugin from 'eslint-plugin-resilient/eslint';

import { counter } from './support/work.js';

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
    ['incoming null', 'const Page=({studioUtils}={})=>({...studioUtils&&{studioUtils}});Page({studioUtils:null});'],
    ['local absent field', 'const {studioUtils}={};const props={...(studioUtils&&{studioUtils})};']
].forEach(([name = '', source = ''] = []) => test(`presence guards own natural absence: ${name}`, () => {
    deepStrictEqual(lint(source), []);
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
