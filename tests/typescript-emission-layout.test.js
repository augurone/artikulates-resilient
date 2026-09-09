import assert from 'node:assert/strict';

import { Linter } from 'eslint';
import typescript from 'typescript';

import { formatResilientOutput } from '../transforms/typescript/grammar/resolvers.js';

// Completed JavaScript owns values and native failure. Layout owns token gaps;
// its rejection outcome is unchanged text, never a synthesized result.
const mechanical = {
    'no-constant-condition': 'error',
    indent: ['error', 4, { SwitchCase: 1 }],
    'arrow-parens': ['error', 'as-needed', { requireForBlockBody: true }],
    'comma-dangle': ['error', 'never'],
    'operator-linebreak': ['error', 'before', { overrides: { '&&': 'after', '||': 'after' } }],
    'no-trailing-spaces': 'error',
    'lines-between-class-members': 'error',
    'padding-line-between-statements': ['error',
        { blankLine: 'always', prev: '*', next: 'if' },
        { blankLine: 'always', prev: 'if', next: '*' },
        { blankLine: 'always', prev: '*', next: 'return' },
        { blankLine: 'never', prev: 'return', next: 'return' }]
};
const linter = new Linter();
const cases = [
    'export const read = (value) => {\n  const next = value +\n  1;  \n if (next) return next;\n return 0;\n};\n',
    `export const nested = outer => inner => call(${Array.from({ length: 24 }, () => 'inner').join(', ')});\n`,
    `export const parenthesized = (outer) => (inner) => call(${Array.from({ length: 24 }, () => 'inner').join(', ')});\n`,
    [
        'export const tuple = (...semigroups) => ({ concat: (first, second) => {',
        'return semigroups.map((s, i) => s.concat((first[i] // Retained indexed operation ends here.',
        '), (second[i] // Retained indexed operation ends here.',
        '))); } });'
    ].join('\n'),
    'export const emptyLoop = () => { for (;;) { break; } };\n',
    'export const active = (left, right) => left\n && right;\n',
    'export const value =\n/*#__PURE__*/ Number(1);\n',
    'export class Cell {\n value;\n /** Method text stays intact. */\n read() {return this.value;}\n write(value) {this.value = value;}\n}\n',
    `export const collect = (input) => call(${Array.from({ length: 24 }, () => 'input').join(', ')});\n`,
    'export const f = (value) => {\n const next = value;\n // eslint-disable-next-line no-constant-condition -- retained test branch\n if (true) return next;\n return 0;\n};\n'
];
cases.forEach((source) => {
    const output = formatResilientOutput(source, typescript);
    assert.equal(formatResilientOutput(output, typescript), output, 'Layout must be idempotent.');
    const { fixed = false, messages = [] } = linter.verifyAndFix(output, { rules: mechanical });
    assert.equal(fixed, false, JSON.stringify({ source, output, messages }));
    assert.equal(messages.filter(({ ruleId = '' } = {}) => ruleId).length, 0, JSON.stringify(messages));
});

const parameters = Array.from({ length: 24 }, (_, index) => `value${index}`).join(', ');
const annotated = `export const annotated = (${parameters}) => { return 1; }; // eslint-disable-line no-unused-vars -- Entire signature owns this boundary.\n`;
assert.deepEqual(linter.verify(formatResilientOutput(annotated, typescript), { rules: { 'no-unused-vars': 'error' } }), []);
const argumentsText = Array.from({ length: 24 }, () => 'value').join(', ');
const longCall = `export const call = value => consume(${argumentsText}); // eslint-disable-line no-undef -- Consumer is supplied by the host.\n`;
assert.deepEqual(linter.verify(formatResilientOutput(longCall, typescript), { rules: { 'no-undef': 'error' } }), []);
const nextLineCall = `// eslint-disable-next-line no-undef -- Consumer is supplied by the host.\nexport const call = value => consume(${argumentsText});\n`;
assert.deepEqual(linter.verify(formatResilientOutput(nextLineCall, typescript), { rules: { 'no-undef': 'error' } }), []);
const trailingComment = '/* Tail comment\n    intentionally uneven spaces  \n * keep it. */';
assert.equal(formatResilientOutput(`export const value=1;\n  ${trailingComment}\n`, typescript).includes(trailingComment), true);

const commentedArguments = [
    'export const read = source => pair((',
    '    // eslint-disable-next-line no-unused-vars -- First binding stays at its source call position.',
    '    ({ first }) => 0)(source), (',
    '    // eslint-disable-next-line no-unused-vars -- Second binding stays at its source call position.',
    '    ({ second }) => 0)(source));',
    ''
].join('\n');
const argumentLayout = formatResilientOutput(commentedArguments, typescript);
assert.equal(formatResilientOutput(argumentLayout, typescript), argumentLayout);
assert.deepEqual(linter.verify(argumentLayout, { rules: { ...mechanical, 'no-unused-vars': 'error' } }), []);

const payloadSource = [
    'export const quoted = "https://host/(x) => x /* text */";',
    'export const pattern = /https?:\\/\\/[^/]+\\/(?:x|y)/g;',
    'export const template = String.raw`  first',
    '  // not a comment ${((x) => x)("middle")} ',
    'return payload  `;',
    '/* Authored block\n    intentionally uneven spaces  \n * keep it. */',
    'export const observe = () => {',
    '    const values = [1, ,];',
    '    let calls = 0;',
    '    const receiver = { get value() { calls++; return calls; } };',
    '    const read = (enabled) => enabled && (receiver.value + receiver.value);',
    '    const skipped = read(false);',
    '    const used = read(true);',
    '    const asi = () => { return',
    '        used;',
    '    };',
    '    return [quoted, pattern.source, template, values.length, 1 in values, skipped, used, calls, asi()];',
    '};',
    ''
].join('\n');
const formatted = formatResilientOutput(payloadSource, typescript);
const literals = (source) => {
    const tree = typescript.createSourceFile('payload.js', source, typescript.ScriptTarget.Latest, true, typescript.ScriptKind.JS);
    let values = [];
    const visit = (node) => {
        if (typescript.isLiteralExpression(node) || typescript.isTemplateLiteralToken(node)) values = [...values, node.getText(tree)];

        typescript.forEachChild(node, visit);
    };
    visit(tree);

    return values;
};
assert.deepEqual(literals(formatted), literals(payloadSource));
assert.match(formatted, /\/\* Authored block\n {4}intentionally uneven spaces {2}\n \* keep it\. \*\//u);
assert.equal(formatResilientOutput(formatted, typescript), formatted);
const load = text => import(`data:text/javascript,${encodeURIComponent(text)}`);
const original = await load(payloadSource);
const lowered = await load(formatted);
assert.deepEqual(lowered.observe(), original.observe());

const moduleOrder = "import './z-effect.js';\nimport { value } from './a-value.js';\nexport { value };\n";
assert.equal(formatResilientOutput(moduleOrder, typescript), moduleOrder, 'Authored module evaluation order remains fixed.');
assert.equal(formatResilientOutput(payloadSource), payloadSource, 'Missing compiler rejects layout.');

assert.equal(formatResilientOutput('const = ;', typescript), 'const = ;');

assert.match(formatResilientOutput('export const f = () => { for (;;) { break; } };', typescript), /for \(;;\)/u);
assert.match(formatResilientOutput("import { read } from 'vendor';\nimport { local } from './local.js';\n", typescript), /vendor';\n\nimport/u);

const comments = [
    '// Only a comment with uneven tail  ',
    '/* Only a block\n  keep this spacing  \n*/',
    '/* eslint-disable no-undef -- Exact directive payload.  */\nhost();\n/* eslint-enable no-undef */',
    '// eslint-disable-next-line no-undef -- EOF stays unused.  \n'
];
comments.forEach((code) => {
    const output = formatResilientOutput(code, typescript);
    assert.equal(output.includes(code), true, 'Comment-only and EOF payload bytes survive.');
    assert.equal(formatResilientOutput(output, typescript), output);
});

const deepCases = [6, 12, 24].flatMap(depth => ['calls', 'arrows', 'parenthesized', 'arrays'].map((shape) => {
    const expression = Array.from({ length: depth }).reduce((body, _, index) => {
        if (shape === 'calls') return `call(${body}, ${'value'.repeat(15)})`;

        if (shape === 'arrays') return `[${body}, ${'value'.repeat(15)}]`;

        return shape === 'arrows' ? `value${index} => ${body}` : `(value${index}) => ${body}`;
    }, `[${Array.from({ length: 24 }, (_, index) => index).join(', ')}]`);

    return `export const deep = ${expression};\n`;
}));
deepCases.forEach((code) => {
    const output = formatResilientOutput(code, typescript);
    assert.deepEqual(typescript.createSourceFile('deep.js', output, typescript.ScriptTarget.Latest, true).parseDiagnostics, []);
    assert.equal(formatResilientOutput(output, typescript), output, 'Deep layout returns a fixed point.');
});

const directiveCases = [
    'export const value = (/* eslint-disable-next-line no-undef -- Existing target\n stays on its original line. */host());\n',
    `before();\n${longCall}after();\n`,
    `before();\n${nextLineCall}after();\n`,
    'export const value = 1; // eslint-disable-next-line no-undef -- Host condition.\nif (host) { host(); }\nneighbor();\n',
    'export const run = () => {\n const value=1; // eslint-disable-next-line no-undef -- Host result.\n return host(value);\n};\nneighbor();\n',
    'before();\n/* eslint-disable-next-line no-undef -- Block directive. */\nhost();\nafter();\n',
    'before();\n/* eslint-disable no-undef -- One wrapped call. */\n' + longCall.replace(/; \/\/[^\n]*/u, ';') + '/* eslint-enable no-undef */\nafter();\n',
    commentedArguments,
    'export const read = () => {\n const value=1;\n return host(value); // eslint-disable-line no-undef -- Host result.\n};\nneighbor();\n'
];
const diagnostics = (code) => {
    const findings = linter.verify(code, { rules: { 'no-undef': 'error', 'no-unused-vars': 'error' } });
    const identify = ({ ruleId = '', message = '', suppressions = [] }) => ({ ruleId, message, suppressions });

    return { raw: findings.map(identify), suppressed: linter.getSuppressedMessages().map(identify) };
};
directiveCases.forEach((code) => {
    const output = formatResilientOutput(code, typescript);
    assert.deepEqual(diagnostics(output), diagnostics(code), 'The same findings stay raw/suppressed; neighbors remain visible.');
    assert.equal(formatResilientOutput(output, typescript), output);
});

const restrictedLines = [
    'export const run = () => { return\n ({ value: 1 }); };\n',
    'export const run = () => { let value = 1; let next = 2; value\n ++next; return [value, next]; };\n',
    'export function* run() { yield\n 7; yield 9; }\n',
    'const async = value => value; export const run = () => { async\n function inner() { return 3; } return inner(); };\n',
    'export const run = async () => await\n Promise.resolve(5);\n',
    'export const run = () => { const values = []; outer: for (let i = 0; i < 2; i++) { for (;;) { values.push(i); break\n outer; } } return values; };\n',
    'export const run = () => { let count = 0; outer: for (let i = 0; i < 2; i++) { for (let j = 0; j < 2; j++) { count++; continue\n outer; } } return count; };\n',
    'export const run = () => { const a = [1, 2,]; const b = [1,,]; const c = [,,]; return [a.length, b.length, c.length, 1 in b, 0 in c]; };\n'
];
// eslint-disable-next-line resilient/prefer-prototype-methods -- Await each original/formatted module pair before comparing its completion.
for (const code of restrictedLines) {
    const output = formatResilientOutput(code, typescript);
    assert.equal(formatResilientOutput(output, typescript), output);
    const before = await load(code);
    const after = await load(output);
    const observe = async ({ run = () => 0 } = {}) => {
        const result = await run();

        const { next = false } = Object(result);

        return typeof next === 'function' ? [...result] : [result];
    };
    assert.deepEqual(await observe(after), await observe(before));
}
const rejectionCases = ['const = ;', 'export const run = () => { throw\n new Error(); };', 'const run = async\n () => 1;'];
rejectionCases.forEach(code => assert.equal(formatResilientOutput(code, typescript), code));

const timingSource = [
    'export const run = (events, failure, token, mode) => {',
    ' const mark = value => { events.push(value); if (value === mode) throw failure; return token; };',
    ' const owner = { get invoke() { events.push("getter"); if (mode === "getter") throw failure;',
    '   return function (first, second) { events.push("call"); if (mode === "call") throw failure; return [this === owner, first === token, second === token]; }; } };',
    ' if (mode === "skip") return false && owner.invoke(mark("first"), mark("second"));',
    ' if (mode === "native-get") return null.value;',
    ' if (mode === "native-call") return ({ invoke: 0 }).invoke(mark("first"), mark("second"));',
    ' return owner.invoke(mark("first"), mark("second"));',
    '};',
    'export const iterate = (events) => {',
    ' const values = [1, 2]; let count = 0;',
    ' for (const value of values) { events.push(value); count++; if (value === 1) values.push(3); }',
    ' return [values, count];',
    '};',
    'export const close = (iterable) => { for (const value of iterable) { return value; } };',
    ''
].join('\n');
const timingOutput = formatResilientOutput(timingSource, typescript);
assert.equal(formatResilientOutput(timingOutput, typescript), timingOutput);
const timingOriginal = await load(timingSource);
const timingFormatted = await load(timingOutput);
['normal', 'skip', 'getter', 'first', 'second', 'call', 'native-get', 'native-call'].forEach((mode) => {
    const failure = {};
    const token = {};
    const observe = (module) => {
        const events = [];
        try {
            return { result: module.run(events, failure, token, mode), events };
        } catch (error) {
            return { exactFailure: error === failure, nativeFailure: error instanceof TypeError, events };
        }
    };
    assert.deepEqual(observe(timingFormatted), observe(timingOriginal), mode);
});
const observeIteration = (module) => {
    let events = [];
    const result = module.iterate(events);
    const iterator = {
        [Symbol.iterator]() { events = [...events, 'iterator'];

            return this; },
        next() { events = [...events, 'next'];

            return { value: 8, done: false }; },
        return() { events = [...events, 'close'];

            return { done: true }; }
    };

    return { result, first: module.close(iterator), events };
};
assert.deepEqual(observeIteration(timingFormatted), observeIteration(timingOriginal));

// A compiler formatting service that corrupts syntax must fail visibly.
assert.throws(() => formatResilientOutput('export const value = 1;\n', {
    ...typescript,
    createLanguageService: () => ({
        getFormattingEditsForDocument: () => [{ span: { start: 0, length: 0 }, newText: 'const = ;' }],
        dispose() {}
    })
}), /produced invalid JavaScript/u);

const layoutProofCases = [
    ...cases, annotated, longCall, nextLineCall, commentedArguments, payloadSource,
    moduleOrder, ...comments, ...deepCases, ...directiveCases, ...restrictedLines, timingSource
];
export { layoutProofCases };

let slowPasses = 0;
const settlingCompiler = {
    ...typescript,
    createLanguageService: (host) => {
        slowPasses += 1;
        const snapshot = host.getScriptSnapshot('emission.js');
        const text = snapshot.getText(0, snapshot.getLength());

        return {
            getFormattingEditsForDocument: () => text.endsWith('\n'.repeat(7)) ? [] : [
                { span: { start: text.length, length: 0 }, newText: '\n' }
            ],
            dispose() {}
        };
    }
};
const settled = formatResilientOutput(deepCases[0], settlingCompiler);
assert.equal(slowPasses > 4, true, 'A valid compiler layout sequence must settle beyond the former four-pass cap.');
assert.equal(formatResilientOutput(settled, settlingCompiler), settled);
assert.throws(() => formatResilientOutput('export const value = 1;\n', {
    ...typescript,
    createLanguageService: host => ({
        getFormattingEditsForDocument: () => [{ span: { start: host.getScriptSnapshot('emission.js').getLength(), length: 0 }, newText: '\n' }],
        dispose() {}
    })
}), /did not converge/u, 'A nonconverging service cannot return a partial result.');
assert.deepEqual(linter.verify(formatResilientOutput('export const values = [1, 2,];\nexport const sparse = [1,,];\n', typescript), {
    rules: { 'comma-dangle': ['error', 'never'] }
}), []);

assert.throws(() => formatResilientOutput('export const value = 1;\n', {
    ...typescript,
    createLanguageService: () => ({
        getFormattingEditsForDocument: () => [{ span: { start: 0, length: 0 }, newText: 'throw\n' }],
        dispose() {}
    })
}), /produced invalid JavaScript/u, 'A missing throw operand is invalid even when TypeScript has no parse diagnostic.');

// Closing a local scope must not overflow or detach an existing line-bound
// operation. The endpoint moves across whitespace only, before the same token.
const endpointCode = [
    '/* eslint-disable no-alert -- Retained call. */',
    `alert("${'value'.repeat(23)}"); // eslint-disable-line no-undef -- Host operation.`,
    '/* eslint-enable no-alert */',
    'alert("neighbor");'
].join('\n');
const endpointInput = endpointCode.replace('; // eslint-disable-line no-undef -- Host operation.\n/* eslint-enable no-alert */',
    '; /* eslint-disable-line no-undef -- Host operation. */ /* eslint-enable no-alert */');
const endpointOutput = formatResilientOutput(endpointInput, typescript);
assert.match(endpointOutput, /Host operation\. \*\/\n\/\* eslint-enable no-alert/u);
assert.equal(formatResilientOutput(endpointOutput, typescript), endpointOutput);
assert.deepEqual(linter.verify(endpointOutput, { linterOptions: { reportUnusedDisableDirectives: 'off' },
    rules: { 'no-alert': 'error', 'no-undef': 'error', 'max-len': ['error', 200] } }).map(({ ruleId = '' }) => ruleId), ['no-alert', 'no-undef']);
assert.equal(linter.getSuppressedMessages().filter(({ ruleId = '' }) => ruleId === 'no-undef').length, 1);
assert.equal(linter.verifyAndFix(endpointOutput, { linterOptions: { reportUnusedDisableDirectives: 'off' }, rules: mechanical }).fixed, false);
