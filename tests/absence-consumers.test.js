import { deepStrictEqual, strictEqual, throws } from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

import { Linter } from 'eslint';

import { createAnalysis } from 'eslint-plugin-resilient/analyzer';
import plugin from 'eslint-plugin-resilient/eslint';

import { counter } from './support/work.js';

const rules = Object.fromEntries(['prefer-safe-destructuring-defaults', 'signature-contract-destructuring', 'no-unguarded-callback-invocation']
    .map(name => [`resilient/${name}`, 'error']));
const lint = source => new Linter().verify(source, {
    languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } }, plugins: { resilient: plugin }, rules
});
const declarationFor = analysis => analysis.declarations.find(({ name = '' } = {}) => name === 'value') || {};
const decisionFor = (source) => {
    const analysis = createAnalysis({ source });
    const { index = -1 } = declarationFor(analysis);

    return analysis.checkDeclaration({ index });
};

[
    ['array spread', '[...(value&&[])]'],
    ['call spread', 'forward(...(value&&[]))'],
    ['constructor spread', 'new Factory(...(value&&[]))'],
    ['ordinary argument', 'forward(value&&[])'],
    ['assigned result', 'value&&[]'],
    ['array element', '[value&&[]]'],
    ['object field', '({field:value&&[]})'],
    ['JSX attribute', '<Component field={value&&[]}/>'],
    ['member receiver', '(value&&[]).length'],
    ['successive conjunctions', '[...((value&&[])&&[])]'],
    ['conditional result', '[...(flag?(value&&[]):[])]'],
    ['fallback right operand', '[...(other||(value&&[]))]'],
    ['nullish right operand', '[...(other??(value&&[]))]']
].forEach(([name = '', expression = ''] = []) => test(`logical result retains absence at ${name}`, () => {
    const source = `const {value}={};const out=${expression};`;

    strictEqual(decisionFor(source).required, true);
    strictEqual(lint(source).some(({ messageId = '' } = {}) => messageId === 'safeDefault'), true);
    strictEqual(lint(source).some(({ ruleId = '' } = {}) => ruleId === 'resilient/signature-contract-destructuring'), true);
}));

[
    ['object spread', 'const out={...(value&&{value})};'],
    ['JSX spread', 'const out=<Component {...(value&&{value})}/>;'],
    ['Boolean selection', 'if(value&&[])forward();'],
    ['conditional test', 'const out=(value&&[])?1:0;'],
    ['Boolean coercion', 'const out=!!(value&&[]);'],
    ['discarded result', 'value&&[];'],
    ['while test', 'while(value&&[])break;'],
    ['do-while test', 'do{}while(value&&[]);'],
    ['for test', 'for(;value&&[];)break;'],
    ['disjunction fallback', 'const out=[...((value&&[])||[])];'],
    ['nullish fallback', 'const out=[...((value&&[])??[])];'],
    ['conditional result into spread', 'const out={...(flag?(value&&{value}):{})};'],
    ['nested object spread', 'forward({...((value&&{})&&{value})});']
].forEach(([name = '', consumer = ''] = []) => test(`logical result consumes absence at ${name}`, () => {
    const source = `const {value}={};${consumer}`;

    strictEqual(decisionFor(source).required, false);
    deepStrictEqual(lint(source), []);
}));

test('the rejected array spread throws while object spreads and fallback consume the same absence', () => {
    throws(() => runInNewContext('const {items}={};const out=[...(items&&[])];'), ({ name = '' } = {}) => name === 'TypeError');
    strictEqual(runInNewContext('const {items}={};Object.keys({...(items&&[])}).length;'), 0);
    strictEqual(runInNewContext('const {items}={};[...((items&&[])||[])].length;'), 0);
    strictEqual(decisionFor('const {value}={};const out=()=>value&&[];').required, true);
    strictEqual(decisionFor('const {value}={};const out={...(value&&[])};forward(value&&[]);').required, true);
});

[
    ['named local', 'export {value};'],
    ['renamed local', 'export {value as other};'],
    ['string export name', 'export {value as "public-value"};'],
    ['default specifier', 'export {value as default};'],
    ['default expression', 'export default value;'],
    ['stable alias', 'const alias=value;export {alias};']
].forEach(([name = '', exported = ''] = []) => test(`local export retains its absence obligation: ${name}`, () => {
    const source = `const {value}={};${exported}!!value;`;

    strictEqual(decisionFor(source).required, true);
    strictEqual(lint(source).some(({ messageId = '' } = {}) => messageId === 'safeDefault'), true);
}));

test('export declarations are value escapes and callable predicates cannot discharge exports', () => {
    ['export const {value}={};!!value;', 'const {value}={};export const alias=value;!!value;',
        'const {value}={};export {value};typeof value==="function";',
        'const {value}={};export {value};isFunction(value);']
        .forEach(source => strictEqual(decisionFor(source).required, true));
});

[
    ['same-spelled re-export', 'export {value} from "dependency";'],
    ['renamed re-export', 'export {other as value} from "dependency";'],
    ['namespace re-export', 'export * as value from "dependency";'],
    ['local export-name collision', 'const other=1;export {other as value};'],
    ['unrelated export', 'const other=1;export {other};']
].forEach(([name = '', exported = ''] = []) => test(`export names keep separate binding identities: ${name}`, () => {
    const source = `const {value}={};${exported}!!value;`;

    strictEqual(decisionFor(source).required, false);
    deepStrictEqual(lint(source), []);
}));

test('only the local side of a renamed export escapes', () => {
    const analysis = createAnalysis({ source: 'const {value,other}={};export {other as value};!!value;' });
    const fields = analysis.declarations.filter(({ kind = '' } = {}) => kind === 'Identifier');

    deepStrictEqual(fields.map(({ index = -1 } = {}) => analysis.checkDeclaration({ index }).required), [false, true]);
});

test('logical consumers and exports preserve producer absence, query order and source revisions', () => {
    const source = 'const {value}={};const out={...(value&&[])};!!value;';
    const analysis = createAnalysis({ source });
    const { index = -1 } = declarationFor(analysis);
    const work = counter();
    const { onWork = () => {} } = work;
    const expected = analysis.checkDeclaration({ index, onWork });
    const before = work.read();
    const field = analysis.destructuringFields.find(({ name = '' } = {}) => name === 'value') || {};
    const { index: selected = -1 } = field;
    const { status = '', fact: { presence = [] } = {} } = analysis.checkDestructuringField({ index: selected });
    const { required = true } = expected;

    strictEqual(required, false);
    strictEqual(status, 'agreement');
    strictEqual(presence.includes('absent'), true);
    deepStrictEqual(analysis.checkDeclaration({ index, onWork }), expected);
    deepStrictEqual(work.read(), before);
    const revised = createAnalysis({ source: source.replace('{...(value&&[])}', '[...(value&&[])]') });

    strictEqual(revised.checkDestructuringField({ index: selected }).status, 'contradiction');
    strictEqual(revised.checkDeclaration({ index }).required, true);
    strictEqual(decisionFor(`${source}export {value};`).required, true);
    deepStrictEqual(analysis.checkDeclaration({ index }), expected);
});
