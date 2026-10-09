import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

import { Linter } from 'eslint';
import { parse } from 'espree';

import plugin from 'eslint-plugin-resilient/eslint';

const linter = new Linter();
const lint = (source, name) => linter.verify(source, {
    plugins: { resilient: plugin },
    rules: { [`resilient/${name}`]: 'error' }
});
const comparisons = ['items.length === 0', '0 === items.length', 'items.length !== 0',
    '0 !== items.length', 'items.length > 0', '0 < items.length'];

comparisons.forEach(comparison => test(`length policy retains its finding without an unproved rewrite: ${comparison}`, () => {
    const source = `const check = items => ${comparison};`;
    const [finding = {}, ...others] = lint(source, 'no-length-comparison');
    const { ruleId = '', messageId = '', column = 0, endColumn = 0, suggestions = [], fix = false } = finding;

    deepStrictEqual(others, []);
    strictEqual(ruleId, 'resilient/no-length-comparison');
    strictEqual(messageId, 'lengthComparison');
    strictEqual(source.slice(column - 1, endColumn - 1), comparison);
    deepStrictEqual(suggestions, []);
    strictEqual(fix, false);
}));

test('length spelling does not establish a collection or a safe truthiness replacement', () => {
    const cases = [
        ['({ length: -1 }).length > 0', '!!({ length: -1 }).length'],
        ['({ length: null }).length === 0', '!({ length: null }).length'],
        ['({ length: 0n }).length === 0', '!({ length: 0n }).length'],
        ['({ length: NaN }).length !== 0', '!!({ length: NaN }).length']
    ];

    cases.forEach(([original = '', replacement = ''] = []) => {
        const [finding = {}] = lint(`const check = () => ${original};`, 'no-length-comparison');
        const { messageId = '', suggestions = [] } = finding;

        strictEqual(messageId, 'lengthComparison');
        deepStrictEqual(suggestions, []);
        strictEqual(runInNewContext(original), !runInNewContext(replacement));
    });
});

test('length policy leaves authored source unchanged when fixing', () => {
    const source = 'const check = items => items.length > 0;';
    const { output = '', fixed = false, messages = [] } = linter.verifyAndFix(source, {
        plugins: { resilient: plugin }, rules: { 'resilient/no-length-comparison': 'error' }
    });

    strictEqual(output, source);
    strictEqual(fixed, false);
    strictEqual(messages.length, 1);
});

test('an unavailable regex payload is not an authored null literal', () => {
    const source = 'const pattern=/(?i:a)/; const read=()=>/(?i:a)/; const absent=null; const missing=()=>null;';
    const { body: [{ declarations: [{ init: { value = {}, regex: { pattern = '' } = {} } = {} } = {}] = [] } = {}] = [] } = parse(source, {
        ecmaVersion: 'latest', sourceType: 'module'
    });

    strictEqual(value, null, 'The private Node parser cannot construct this newer regex payload');
    strictEqual(pattern, '(?i:a)');
    ['no-null-assignment', 'prefer-falsey-returns'].forEach((name) => {
        const [finding = {}, ...others] = lint(source, name);
        const { column = 0, endColumn = 0 } = finding;

        deepStrictEqual(others, []);
        strictEqual(source.slice(column - 1, endColumn - 1), 'null');
    });
});

test('exact cardinality and other length relations keep their own meaning', () => {
    ['items.length === 1', 'items.length > 1', 'items.length < 0', '0 > items.length',
        'items.length == 0', 'items.length >= 0', 'items.length', '!items.length', '!!items.length']
        .forEach(value => deepStrictEqual(lint(`const check = items => ${value};`, 'no-length-comparison'), []));
});

test('null assignment lookup keeps a bounded stack at 2000 logical operands', () => {
    const depth = 2000;
    const source = `const result = ${Array.from({ length: depth }, () => 'external').join(' || ')};`;
    const control = linter.verify(source, {
        plugins: { resilient: plugin }, rules: { 'resilient/no-null-assignment': 'off' }
    });

    deepStrictEqual(control, [], 'The public host can parse and traverse this source without the rule');
    deepStrictEqual(lint(source, 'no-null-assignment'), []);
});

test('null assignment lookup stays bounded beyond the host scope walker depth', (context) => {
    const init = Array.from({ length: 10000 }).reduce(left => ({
        type: 'LogicalExpression', operator: '||', left, right: { type: 'Identifier', name: 'external' }
    }), { type: 'Identifier', name: 'external' });
    const report = context.mock.fn();
    const listeners = plugin.rules['no-null-assignment'].create({ report });

    listeners.VariableDeclarator({ init });
    strictEqual(report.mock.callCount(), 0);
});

test('null assignment lookup retains its first source-order literal after a long logical prefix', () => {
    const source = `const result = ${[...Array.from({ length: 2000 }, () => 'external'), 'null', 'null'].join(' || ')};`;
    const [finding = {}, ...others] = lint(source, 'no-null-assignment');
    const { ruleId = '', messageId = '', column = 0, endColumn = 0 } = finding;

    deepStrictEqual(others, []);
    strictEqual(ruleId, 'resilient/no-null-assignment');
    strictEqual(messageId, 'nullAssignment');
    strictEqual(column, source.indexOf('null') + 1);
    strictEqual(endColumn, column + 4);
});

[
    ['sequential guards', 'if (a) run(); if (b) stop();', []],
    ['nested blocks', 'if (a) { { if (b) stop(); } }', ['if (b)']],
    ['loop inside a branch', 'if (a) { for (;;) { if (b) break; } }', ['if (b)']],
    ['alternate branch', 'if (a) run(); else if (b) stop();', ['if (b)']],
    ['arrow callback owns its branches', 'if (a) use(() => { if (b) stop(); });', []],
    ['function expression owns its branches', 'if (a) use(function () { if (b) stop(); });', []],
    ['nested function still reports its own nesting', 'if (a) use(() => { if (b) { if (c) stop(); } });', ['if (c)']],
    ['function exit restores the surrounding branch', 'if (a) { use(() => { if (b) stop(); }); if (c) finish(); }', ['if (c)']],
    ['outer branch exit releases its nesting', 'if (a) { if (b) stop(); } if (c) finish();', ['if (b)']]
].forEach(([name = '', source = '', expected = []] = []) => test(`nested-if control ownership: ${name}`, () => {
    const messages = lint(source, 'no-nested-if');

    deepStrictEqual(messages.map(({ messageId = '', column = 0 } = {}) => {
        strictEqual(messageId, 'nestedIf');

        return source.slice(column - 1, column + 5);
    }), expected);
}));

test('no-else reports every alternate and offers no control-flow rewrite', () => {
    const source = 'if (a) run(); else if (b) stop(); else finish();';
    const messages = lint(source, 'no-else');

    deepStrictEqual(messages.map(({ messageId = '', column = 0, suggestions = [], fix = false } = {}) => {
        strictEqual(messageId, 'noElse');
        deepStrictEqual(suggestions, []);
        strictEqual(fix, false);

        return column;
    }), [source.indexOf('if (b)') + 1, source.indexOf('finish') + 1]);
});

test('return findings preserve selected spans and native versus shadowed absence in source order', () => {
    const lines = [
        'const native = (flag, other) => (null, flag ? (value = null) : other ? void 0 : undefined);',
        'const shadowed = undefined => (void 9, flag ? (value = null) : other ? void 1 : undefined);'
    ];
    const messages = lint(lines.join('\n'), 'prefer-falsey-returns');

    deepStrictEqual(messages.map(({ ruleId = '', messageId = '', line = 0, column = 0, endColumn = 0 } = {}) => {
        strictEqual(ruleId, 'resilient/prefer-falsey-returns');
        strictEqual(messageId, 'falseyReturn');

        return { line, column, endColumn, text: lines.at(line - 1).slice(column - 1, endColumn - 1) };
    }), [[1, 'null'], [1, 'void 0'], [1, 'undefined'], [2, 'null'], [2, 'void 1']].map(([line = 0, text = ''] = []) => {
        const column = lines.at(line - 1).lastIndexOf(text) + 1;

        return { line, column, endColumn: column + text.length, text };
    }));
});

test('the recommended public preset enables all five control and layout policies', () => {
    const sources = [
        ['no-else', 'if (a) run(); else stop();'],
        ['no-nested-if', 'if (a) { if (b) stop(); }'],
        ['no-length-comparison', 'const check = items => items.length > 0;'],
        ['prefer-falsey-returns', 'const check = () => null;'],
        ['operator-linebreak', 'const total =\n    left + right;']
    ];

    sources.forEach(([name = '', source = ''] = []) => {
        const findings = linter.verify(source, plugin.configs.recommended);
        const matching = findings.filter(({ ruleId = '' } = {}) => ruleId === `resilient/${name}`);
        const [{ severity = 0 } = {}] = matching;

        strictEqual(matching.length, 1, name);
        strictEqual(severity, 2, name);
    });
});
