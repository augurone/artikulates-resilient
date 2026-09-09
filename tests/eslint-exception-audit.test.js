import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Linter } from 'eslint';

import {
    auditDirectory,
    auditSource,
    getDirectoryExceptionReport,
    getExceptionInventory,
    getExceptionEvidenceReport,
    getOuterStatementsInRange,
    getUnusedDirectiveFindings,
    summarizeExceptionInventory
} from '../scripts/audit-eslint-exceptions.js';

const validNextLine = `// eslint-disable-next-line resilient/example -- This external boundary preserves receiver identity.
external.call();`;
const validRegion = `/* eslint-disable resilient/example -- This external boundary requires one contained statement. */
const value = external.call();
/* eslint-enable */`;
const validSpecificRegion = `/* eslint-disable resilient/example, no-console -- This external boundary requires one contained statement. */
const value = external.call();
/* eslint-enable resilient/example, no-console */`;
const validNestedRegion = `/* eslint-disable no-use-before-define -- Preserve authored statement order. */
const run = () => {
    /* eslint-disable resilient/example -- Preserve the nested operation. */
    return later();
    /* eslint-enable resilient/example */
};
/* eslint-enable no-use-before-define */`;

assert.deepEqual(auditSource(validNextLine), []);
assert.deepEqual(auditSource(validRegion), []);
assert.deepEqual(auditSource(validSpecificRegion), []);
assert.deepEqual(auditSource(validNestedRegion), []);
assert.deepEqual(getExceptionInventory({ file: 'transforms/example.js', source: validNextLine }).entries, [{
    file: 'transforms/example.js',
    subsystem: 'transforms',
    form: 'next-line',
    rules: ['resilient/example'],
    reason: 'This external boundary preserves receiver identity.',
    location: { line: 1, column: 1 },
    range: [0, 100],
    enclosedAst: 'ExpressionStatement',
    enclosedRange: [101, 117],
    operation: 'external.call();'
}]);
assert.equal(getExceptionInventory({ file: 'scripts/example.js', source: validRegion }).entries[0].enclosedAst, 'VariableDeclaration');
assert.equal(getExceptionInventory({ file: 'scripts/example.js', source: validRegion }).entries.length, 1);
assert.deepEqual(getExceptionInventory({ file: 'scripts/example.js', source: validRegion }).entries[0].closeRange, [130, 149]);
assert.equal(getExceptionInventory({ source: validRegion }).entries[0].operation, 'const value = external.call();');

const repeatedReasonSource = `${validNextLine}\n${validNextLine.replace('external.call();', 'external.other();')}`;
const { entries: repeatedEntries = [] } = getExceptionInventory({ file: 'transforms/example.js', source: repeatedReasonSource });
const repeatedEvidence = repeatedEntries.map((entry = {}, index) => ({ ...entry, id: index + 1, proof: 'local proof' }));

assert.deepEqual(getExceptionEvidenceReport({ entries: repeatedEntries, evidence: repeatedEvidence }), {
    entries: repeatedEvidence, problems: []
});
const { entries: movedEntries = [] } = getExceptionInventory({ file: 'transforms/example.js', source: `\n${repeatedReasonSource}` });
const movedReport = getExceptionEvidenceReport({ entries: movedEntries, evidence: repeatedEvidence });

assert.deepEqual(movedReport.problems, []);
assert.deepEqual(movedReport.entries.map(({ id = 0, location: { line = 0 } = {} } = {}) => [id, line]), [[1, 2], [2, 4]]);
const [firstEvidence = {}] = repeatedEvidence;
const duplicateReport = getExceptionEvidenceReport({ entries: repeatedEntries, evidence: [firstEvidence, firstEvidence] });

assert.match(duplicateReport.problems[0], /duplicate evidence/u);
assert.match(duplicateReport.problems[1], /missing evidence/u);
assert.match(getExceptionEvidenceReport({ entries: repeatedEntries, evidence: [] }).problems[0], /missing evidence/u);
assert.match(getExceptionEvidenceReport({ entries: [], evidence: repeatedEvidence }).problems[0], /stale source operation/u);
assert.match(getExceptionEvidenceReport({
    entries: repeatedEntries, evidence: [{ ...repeatedEvidence[0], reason: 'Changed reason is not automatically approved.' }]
}).problems[0], /stale source operation/u);
const { entries: identicalEntries = [] } = getExceptionInventory({ file: 'transforms/example.js', source: `${validNextLine}\n${validNextLine}` });
const identicalEvidence = identicalEntries.map((entry = {}, index) => ({ ...entry, id: index + 1 }));

assert.deepEqual(getExceptionEvidenceReport({ entries: identicalEntries, evidence: identicalEvidence }).problems, []);
assert.match(getExceptionEvidenceReport({
    entries: identicalEntries, evidence: [{ ...identicalEvidence[0], range: [-1, -1] }]
}).problems[0], /ambiguous/u);
assert.deepEqual(getExceptionEvidenceReport(), { entries: [], problems: [] });
assert.deepEqual(getExceptionEvidenceReport({ entries: repeatedEntries, evidence: [...repeatedEvidence].toReversed() }).entries,
    repeatedEvidence);
const { entries: scopedEntries = [] } = getExceptionInventory({ file: 'scripts/example.js', source: validRegion });
const scopedReport = getExceptionEvidenceReport({ entries: scopedEntries, evidence: scopedEntries });

assert.deepEqual(scopedReport.problems, []);
assert.deepEqual(scopedReport.entries, scopedEntries);
assert.match(getExceptionEvidenceReport({
    entries: repeatedEntries, evidence: [{ ...firstEvidence, rules: ['no-undef'] }]
}).problems[0], /stale source operation/u);
assert.match(getExceptionEvidenceReport({
    entries: repeatedEntries, evidence: [{ ...firstEvidence, operation: 'unrelated();' }]
}).problems[0], /stale source operation/u);

// This is a derived crosswalk, not an exception approval registry. Assert every
// transformer record owns one real parsed operation and none silently disappears.
const { boundaries: transformerEvidence = [] } = JSON.parse(fs.readFileSync(
    new URL('../docs/engineering/transformer-authored-boundaries.json', import.meta.url), 'utf8'
));
const projectReport = getDirectoryExceptionReport(fileURLToPath(new URL('../', import.meta.url)));
const transformerEntries = projectReport.entries.filter(({ subsystem = '' } = {}) => subsystem === 'transforms');
const transformerReport = getExceptionEvidenceReport({ entries: transformerEntries, evidence: transformerEvidence });

assert.deepEqual(projectReport.problems, []);
assert.deepEqual(transformerReport.problems, []);
assert.equal(transformerReport.entries.length, transformerEvidence.length);
assert.equal(new Set(transformerEvidence.map(({ id = 0 } = {}) => id)).size, transformerEvidence.length);
transformerReport.entries.forEach((entry = {}) => {
    const { id = 0 } = entry;
    const record = transformerEvidence.find(({ id: evidenceId = 0 } = {}) => evidenceId === id);

    assert.deepEqual(entry, record, `Evidence ${id} must retain exact parsed endpoints, operation and adjacent reason.`);
});
assert.deepEqual(summarizeExceptionInventory(getExceptionInventory({ source: validNextLine }).entries), {
    boundaries: 1,
    ruleSites: 1,
    bySubsystem: { root: 1 },
    byForm: { 'next-line': 1 },
    byRule: { 'resilient/example': 1 }
});
assert.deepEqual(auditSource(`// eslint-disable-next-line resilient/example, no-console -- Preserve receiver and I/O.
external.call();`), []);
assert.match(auditSource(`// eslint-disable-next-line resilient/example -- Preserve receiver.

external.call();`)[0], /next line/u);
assert.match(auditSource('/* eslint-disable resilient/example -- reason */\n/* eslint-disable no-console -- nested */\nonly();\n/* eslint-enable */\n/* eslint-enable */')[0], /must not nest/u);
assert.match(auditSource('/* eslint-disable resilient/example -- reason */\nonly();\n/* eslint-enable no-console */')[0], /exactly match/u);
assert.match(auditSource([
    '/* eslint-disable resilient/example -- reason */',
    '/* eslint-disable resilient/example -- overlap */',
    'only();',
    '/* eslint-enable resilient/example */',
    '/* eslint-enable resilient/example */'
].join('\n'))[0], /must not overlap/u);
assert.match(auditSource('/* eslint-enable */\nonly();')[0], /no preceding/u);
assert.match(auditSource('// eslint-disable-next-line -- missing rules\nonly();')[0], /Only/u);
assert.match(auditSource('// eslint-disable-next-line resilient/example --   \nonly();')[0], /Only/u);
assert.match(auditSource('/* eslint-disable-next-line resilient/example -- reason */\nonly();')[0], /must use a \/\/ comment/u);
assert.match(auditSource('// eslint-disable resilient/example -- reason\nonly();')[0], /must use a \/\* \*\/ comment/u);
assert.match(
    auditSource('// resilient-allow-loop: legacy\nfor (const item of items) use(item);')[0],
    /Legacy resilient-allow markers/u
);
assert.match(
    auditSource('// eslint-disable-next-line resilient/example\nexternal.call();')[0],
    /Only/u
);
assert.match(
    auditSource('/* eslint-disable resilient/example -- reason */\nfirst();\nsecond();\n/* eslint-enable */')[0],
    /exactly one syntactic statement/u
);
assert.match(
    auditSource('/* eslint-disable resilient/example -- reason */\nonly();')[0],
    /must close/u
);
assert.match(
    auditSource('/* eslint-disable-line resilient/example -- reason */\nonly();')[0],
    /Only/u
);
assert.match(
    auditSource('// eslint-disable-next-line resilient/prefer-prototype-methods -- Source loop has unproven callback safety or sequential effects.\nfor (;;) break;')[0],
    /Generic loop exceptions/u
);
assert.match(auditSource('// eslint-disable-next-line no-undef -- Retain external binding.')[0], /next line/u);
assert.match(auditSource('const broken = ;')[0], /Parsing error/u);

const multilineImport = `import {
    value
// eslint-disable-next-line resilient/example -- Preserve the native module specifier on the closing import line.
} from 'external';`;
const importInventory = getExceptionInventory({ source: multilineImport });

assert.deepEqual(importInventory.problems, []);
assert.equal(importInventory.entries[0].enclosedAst, 'ImportDeclaration');
assert.deepEqual(importInventory.entries[0].enclosedRange, [0, multilineImport.length]);

const deferredCallback = `external(
    // eslint-disable-next-line resilient/example -- Retain the deferred callback's recursive ownership.
    (node) => visit(node)
);`;
const callbackInventory = getExceptionInventory({ source: deferredCallback });

assert.deepEqual(callbackInventory.problems, []);
assert.equal(callbackInventory.entries[0].enclosedAst, 'ArrowFunctionExpression');
const continuedGuard = `const run = () => {
    if (known &&
    // eslint-disable-next-line resilient/example -- Preserve the guarded absence result.
    inspect(value)) return undefined;
};`;
const guardInventory = getExceptionInventory({ source: continuedGuard });

assert.deepEqual(guardInventory.problems, []);
assert.equal(guardInventory.entries[0].enclosedAst, 'IfStatement');
assert.deepEqual(guardInventory.entries[0].enclosedRange, [
    continuedGuard.indexOf('if'), continuedGuard.indexOf('undefined;') + 'undefined;'.length
]);
const shorthandProperty = `external({
    // eslint-disable-next-line resilient/example -- Preserve the passed provider's exact identity.
    provider
});`;
const shorthandInventory = getExceptionInventory({ source: shorthandProperty });

assert.deepEqual(shorthandInventory.problems, []);
assert.equal(shorthandInventory.entries[0].enclosedAst, 'Property');
assert.deepEqual(shorthandInventory.entries[0].enclosedRange, [
    shorthandProperty.lastIndexOf('provider'), shorthandProperty.lastIndexOf('provider') + 'provider'.length
]);
assert.deepEqual(auditSource(`// eslint-disable-next-line resilient/example -- Retain one declaration.
const value = 1; // Parser metadata is not an executable child.`), []);
assert.match(auditSource(`// eslint-disable-next-line resilient/example -- A comment cannot be the controlled operation.
/* ordinary comment */
external();`)[0], /next line/u);
assert.match(auditSource(`// eslint-disable-next-line resilient/example -- A token in comment metadata is not a unit.
// ordinary comment`)[0], /next line/u);
assert.match(auditSource(`// eslint-disable-next-line resilient/example -- Two sibling operations are not one boundary.
first(); second();`)[0], /next line/u);
assert.match(auditSource(`import {
    value
// eslint-disable-next-line resilient/example -- Closing syntax must not hide a second operation.
} from 'external'; value();`)[0], /next line/u);
assert.match(auditSource(`// eslint-disable-next-line resilient/example -- A directive cannot control another comment.
/* eslint-disable resilient/example -- Retain one operation. */
external();
/* eslint-enable */`)[0], /next line/u);

const mixedRegion = `/* eslint-disable resilient/example -- One declaration owns its nested callback. */
const run = () => {
    // eslint-disable-next-line no-undef -- Preserve the external call inside the owned declaration.
    external();
};
/* eslint-enable */`;
const mixedInventory = getExceptionInventory({ source: mixedRegion });

assert.deepEqual(mixedInventory.problems, []);
assert.deepEqual(mixedInventory.entries.map(({ form = '', enclosedAst = '' } = {}) => [form, enclosedAst]), [
    ['next-line', 'ExpressionStatement'],
    ['scoped-disable', 'VariableDeclaration']
]);
assert.deepEqual(auditSource(`/* eslint-disable resilient/example -- Preserve one unit. */
/* eslint-disable no-undef -- Nested regions must remain invalid. */
external();
/* eslint-enable */
/* eslint-enable */`), ['line 4: Scoped eslint-disable regions must not nest with a bare eslint-enable.']);
assert.deepEqual(auditSource(`/* eslint-disable resilient/example -- Preserve one unit. */
external();
// eslint-enable`), [
    'line 3: eslint-enable has no preceding scoped eslint-disable.',
    'line 1: Scoped eslint-disable must close with /* eslint-enable [rules] */.'
]);
assert.match(auditSource(`/* eslint-disable resilient/example -- Empty regions are invalid. */
/* ordinary comment */
/* eslint-enable */`)[0], /exactly one/u);
assert.deepEqual(getExceptionInventory({ source: 'const broken = ;' }).entries, []);

const innerStatement = Object.freeze({ type: 'ExpressionStatement', range: Object.freeze([10, 15]) });
const outerStatement = Object.freeze({
    type: 'BlockStatement', range: Object.freeze([5, 20]), body: Object.freeze([innerStatement])
});
const siblingStatement = Object.freeze({ type: 'VariableDeclaration', range: Object.freeze([25, 35]) });
const metadataStatement = Object.freeze({ type: 'ExpressionStatement', range: Object.freeze([36, 40]) });
const parserTree = Object.freeze({
    type: 'Program', range: Object.freeze([0, 50]),
    body: Object.freeze([outerStatement, siblingStatement]),
    comments: Object.freeze([metadataStatement]), tokens: Object.freeze([metadataStatement]),
    parent: metadataStatement, loc: metadataStatement
});

assert.deepEqual(getOuterStatementsInRange({ ast: parserTree, start: 0, end: 50 }), [outerStatement, siblingStatement]);
assert.equal(getOuterStatementsInRange({ ast: parserTree, start: 10, end: 15 })[0], innerStatement);
assert.deepEqual(getOuterStatementsInRange({ nodes: [outerStatement, outerStatement], start: 0, end: 50 }), [
    outerStatement, outerStatement
]);
assert.deepEqual(getOuterStatementsInRange({
    nodes: [innerStatement, { ...innerStatement }], start: 10, end: 15
}), []);
assert.deepEqual(getOuterStatementsInRange(), []);

const fixtureDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'resilient-audit-discovery-'));

try {
    ['docs', 'node_modules', '.git', 'tests/fixtures', 'tests/proofs/fp-ts/checkout', 'tests/authored'].forEach((relativeDirectory = '') => {
        const directory = path.join(fixtureDirectory, relativeDirectory);

        fs.mkdirSync(directory, { recursive: true });
        fs.writeFileSync(path.join(directory, 'entry.js'), validNextLine);
    });
    fs.writeFileSync(path.join(fixtureDirectory, 'entry.js'), validRegion);
    fs.writeFileSync(path.join(fixtureDirectory, 'ignored.txt'), validNextLine);
    fs.symlinkSync(path.join(fixtureDirectory, 'entry.js'), path.join(fixtureDirectory, 'linked.js'));

    const directoryReport = getDirectoryExceptionReport(fixtureDirectory);

    assert.deepEqual(directoryReport.problems, []);
    assert.deepEqual(auditDirectory(fixtureDirectory), []);
    assert.deepEqual(directoryReport.entries.map(({ file = '' } = {}) => file), [
        'entry.js', path.join('tests', 'authored', 'entry.js')
    ]);
    assert.throws(() => getDirectoryExceptionReport(path.join(fixtureDirectory, 'missing')), { code: 'ENOENT' });
} finally {
    fs.rmSync(fixtureDirectory, { recursive: true, force: true });
}

assert.deepEqual(getUnusedDirectiveFindings([{
    filePath: '/project/tests/example.js',
    messages: [
        { line: 1, column: 1, message: "Unused eslint-disable directive (no problems were reported from 'no-undef')." },
        { line: 2, column: 1, message: 'Unexpected console statement.' }
    ]
}], '/project'), [{
    file: 'tests/example.js',
    location: { line: 1, column: 1 },
    message: "Unused eslint-disable directive (no problems were reported from 'no-undef')."
}]);
const linter = new Linter({ configType: 'flat' });
const unusedMessages = linter.verify('// eslint-disable-next-line no-undef -- The name is already bound.\nconst value = 1;', [{
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: { 'no-undef': 'error' }
}]);
const usedMessages = linter.verify('// eslint-disable-next-line no-undef -- The external name is deliberately unresolved.\nexternal();', [{
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: { 'no-undef': 'error' }
}]);
assert.equal(getUnusedDirectiveFindings([{ filePath: '/project/unused.js', messages: unusedMessages }], '/project').length, 1);
assert.deepEqual(getUnusedDirectiveFindings([{ filePath: '/project/used.js', messages: usedMessages }], '/project'), []);
