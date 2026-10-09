import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

import { Linter } from 'eslint';

import plugin from 'eslint-plugin-resilient/eslint';

const linter = new Linter();
const rules = {
    'resilient/prefer-falsey-returns': 'error',
    'resilient/no-undefined-assignment': 'error',
    'resilient/no-undefined-comparison': 'error'
};
const findings = (source, sourceType = 'script') => {
    const messages = linter.verify(source, {
        languageOptions: { sourceType }, plugins: { resilient: plugin }, rules
    });

    strictEqual(messages.some(({ fatal = false } = {}) => fatal), false);

    return messages;
};
const read = '()=>{const value=undefined;return value===undefined?undefined:value;}';
const dynamicSources = [
    ['body eval', `function outer(){eval("var undefined=[]");return ${read};}`],
    ['nested block eval', `function outer(){{eval("var undefined=[]");}return ${read};}`],
    ['parameter default eval', `const outer=(value=eval("var undefined=[]"))=>${read};`],
    ['computed parameter eval', `const outer=({[eval("var undefined=[]")]:value}={})=>${read};`],
    ['with closure', `function outer(){with({undefined:[]}){return ${read};}}`]
];

dynamicSources.forEach(([name = '', source = ''] = []) => {
    test(`dynamic native-absence lookup preserves ordinary supplied values: ${name}`, () => {
        strictEqual(runInNewContext(`${source};Array.isArray(outer()());`), true);
        deepStrictEqual(findings(source), []);
    });
});

const nativeMessages = ['undefinedAssignment', 'undefinedComparison', 'falseyReturn'];
[
    ['native undefined', `const outer=()=>${read};`],
    ['sibling execution', `function unused(){eval("var undefined=[]");}const outer=()=>${read};`],
    ['unexecuted nested function', `function outer(){const unused=()=>eval("var undefined=[]");return ${read};}`],
    ['unexecuted function default', `const outer=(value=()=>eval("var undefined=[]"))=>${read};`],
    ['eval text is not executable', `function outer(){const text='eval("var undefined=[]")';return ${read};}`],
    ['indirect eval', `function outer(){(0,eval)("var other=[]");return ${read};}`],
    ['member named eval', `function outer(){({eval(){}}).eval();return ${read};}`]
].forEach(([name = '', source = ''] = []) => {
    test(`unrelated syntax does not obscure native absence: ${name}`, () => {
        strictEqual(runInNewContext(`${source};outer()()===void 0;`), true);
        deepStrictEqual(findings(source).map(({ messageId = '' } = {}) => messageId), nativeMessages);
    });
});

test('with lookup uncertainty remains inside its lexical boundary', () => {
    const source = `function dynamic(){with({undefined:[]}){return ${read};}}const outer=()=>${read};`;

    strictEqual(runInNewContext(`${source};Array.isArray(dynamic()())&&outer()()===void 0;`), true);
    deepStrictEqual(findings(source).map(({ messageId = '' } = {}) => messageId), nativeMessages);
});

test('lexical undefined bindings remain ordinary values at each owned boundary', () => {
    [
        `const outer=undefined=>${read};`,
        `function outer(){const undefined=[];return ${read};}`,
        `function outer(){try{throw [];}catch(undefined){return ${read};}}`
    ].forEach((source) => {
        strictEqual(runInNewContext(`${source};Array.isArray(outer([])());`), true);
        deepStrictEqual(findings(source), []);
    });
});

test('dynamic undefined cannot erase explicit null, void or typeof findings', () => {
    const source = 'function outer(){eval("var undefined=[]");const nil=()=>null;const absent=()=>void 0;return typeof value==="undefined";}';

    deepStrictEqual(findings(source).map(({ messageId = '' } = {}) => messageId), [
        'falseyReturn', 'falseyReturn', 'undefinedComparison'
    ]);
});

test('separate lint invocations never reuse dynamic lookup classifications', () => {
    const [[, dynamic = ''] = []] = dynamicSources;
    const source = `const outer=()=>${read};`;

    deepStrictEqual(findings(dynamic), []);
    deepStrictEqual(findings(source).map(({ messageId = '' } = {}) => messageId), nativeMessages);
    deepStrictEqual(findings(dynamic), []);
    deepStrictEqual(findings(source).map(({ messageId = '' } = {}) => messageId), nativeMessages);
});

test('module-mode native absence and ordinary lexical bindings retain their findings', () => {
    deepStrictEqual(findings(`const outer=()=>${read};`, 'module').map(({ messageId = '' } = {}) => messageId), nativeMessages);
    deepStrictEqual(findings(`const outer=undefined=>${read};`, 'module'), []);
});

[
    ['optional eval', `function outer(){eval?.("var undefined=[]");return ${read};}`],
    ['parenthesized optional eval', `function outer(){(eval)?.("var undefined=[]");return ${read};}`]
].forEach(([name = '', source = ''] = []) => {
    test(`indirect eval preserves native-absence evidence: ${name}`, () => {
        strictEqual(runInNewContext(`${source};outer()()===void 0;`), true);
        deepStrictEqual(findings(source).map(({ messageId = '' } = {}) => messageId), nativeMessages);
    });
});

test('optional eval cannot hide a direct eval in its evaluated arguments', () => {
    const source = `function outer(){eval?.(eval("var undefined=[]"));return ${read};}`;

    strictEqual(runInNewContext(`${source};Array.isArray(outer()());`), true);
    deepStrictEqual(findings(source), []);
});

[
    ['block', '{function undefined(){return [];}}'],
    ['if block', 'if(true){function undefined(){return [];}}'],
    ['switch', 'switch(true){case true:function undefined(){return [];}}'],
    ['catch block', 'try{throw 1;}catch(error){function undefined(){return [];}}'],
    ['loop block', 'for(let i=0;i<1;i++){function undefined(){return [];}}']
].forEach(([name = '', declaration = ''] = []) => {
    test(`Annex B outer bindings cannot borrow native absence: ${name}`, () => {
        const source = `function outer(){${declaration}return ${read};}`;

        strictEqual(runInNewContext(`${source};typeof outer()()==="function";`), true);
        deepStrictEqual(findings(source), []);
    });
});

[
    ['strict ordinary block function', `function outer(){"use strict";{function undefined(){return [];}}return ${read};}`],
    ['async block function', `function outer(){{async function undefined(){return [];}}return ${read};}`],
    ['generator block function', `function outer(){{function* undefined(){yield [];}}return ${read};}`],
    ['async generator block function', `function outer(){{async function* undefined(){yield [];}}return ${read};}`],
    ['unrelated block function', `function outer(){{function other(){return [];}}return ${read};}`],
    ['sibling block function', `function sibling(){{function undefined(){return [];}}}const outer=()=>${read};`],
    ['unexecuted nested block function', `function outer(){const unused=()=>{{function undefined(){return [];}}};return ${read};}`],
    ['global block function', `{function undefined(){return [];}}const outer=()=>${read};`]
].forEach(([name = '', source = ''] = []) => {
    test(`non-Annex-B execution retains native absence: ${name}`, () => {
        strictEqual(runInNewContext(`${source};outer()()===void 0;`), true);
        deepStrictEqual(findings(source).map(({ messageId = '' } = {}) => messageId), nativeMessages);
    });
});

test('module block functions retain their lexical boundary', () => {
    const source = `function outer(){{function undefined(){return [];}}return ${read};}`;

    deepStrictEqual(findings(source, 'module').map(({ messageId = '' } = {}) => messageId), nativeMessages);
});
