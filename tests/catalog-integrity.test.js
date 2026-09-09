import assert from 'node:assert/strict';
import fs from 'node:fs';

import typescript from 'typescript';

import {
    checkEmitterCatalog,
    checkProofCatalogs,
    collectDirectiveCandidates,
    collectSyntheticCommentCalls
} from '../scripts/proof-catalogs.js';
import { getChildren } from '../transforms/utils/ast-traversal.js';

assert.deepEqual(checkProofCatalogs(), { routes: 57, emitters: { calls: 76, strings: 94 } });

const emitterCatalog = JSON.parse(fs.readFileSync(new URL('../docs/engineering/transformer-source-emitters.json', import.meta.url), 'utf8'));
const sourceTree = ({ file = 'transforms/typescript/fixture.js', source = '' } = {}) => {
    const tree = typescript.createSourceFile(file, source, typescript.ScriptTarget.ESNext, true);
    const getNodes = (node = {}) => [node, ...getChildren({ typescript, node }).flatMap(getNodes)];

    return { file, tree, nodes: getNodes(tree) };
};
const fixtureTree = sourceTree({ source: [
    "const prefix = 'eslint-disable-next-line ';",
    "const combined = 'eslint-disable-next-line ' + rules;",
    "const templated = `eslint-enable ${rules}`;"
].join('\n') });
assert.deepEqual(collectDirectiveCandidates([fixtureTree]).map(({ text = '' } = {}) => text), [
    "'eslint-disable-next-line '",
    "'eslint-disable-next-line ' + rules",
    "'eslint-disable-next-line '",
    '`eslint-enable ${rules}`'
]);

const noCalls = { ...emitterCatalog, syntheticCommentCalls: [] };
const singleDirectiveTree = sourceTree({ source: "const directive = 'eslint-disable-next-line no-undef -- retained test boundary.';" });
const [candidate = {}] = collectDirectiveCandidates([singleDirectiveTree]);
const directiveCatalog = { ...noCalls, directiveStrings: [candidate] };

assert.deepEqual(checkEmitterCatalog([singleDirectiveTree], directiveCatalog), { calls: 0, strings: 1 });
assert.throws(() => checkEmitterCatalog([singleDirectiveTree], { ...directiveCatalog, directiveStrings: [] }), /Missing directive catalog entry/u);
assert.throws(() => checkEmitterCatalog([singleDirectiveTree], {
    ...directiveCatalog,
    directiveStrings: [candidate, candidate]
}), /Duplicate directive catalog entry/u);
assert.throws(() => checkEmitterCatalog([singleDirectiveTree], {
    ...directiveCatalog,
    directiveStrings: [{ ...candidate, text: "'eslint-disable-next-line no-undef -- stale.'" }]
}), /Changed directive catalog entry/u);
assert.throws(() => checkEmitterCatalog([singleDirectiveTree], {
    ...directiveCatalog,
    directiveStrings: [{ ...candidate, range: [0, 1] }]
}), /Stale directive catalog entry/u);

const commentTree = sourceTree({ source: [
    "typescript.addSyntheticLeadingComment(first, kind, 'eslint-disable-next-line no-undef -- first.', true);",
    "typescript.addSyntheticLeadingComment(second, kind, 'eslint-disable-next-line no-undef -- second.', true);"
].join('\n') });
const commentCalls = collectSyntheticCommentCalls([commentTree]);
const commentStrings = collectDirectiveCandidates([commentTree]);
const commentCatalog = { syntheticCommentCalls: commentCalls, directiveStrings: commentStrings };
const [firstCall = {}, secondCall = {}] = commentCalls;

assert.deepEqual(checkEmitterCatalog([commentTree], commentCatalog), { calls: 2, strings: 2 });
assert.throws(() => checkEmitterCatalog([commentTree], {
    ...commentCatalog,
    syntheticCommentCalls: [firstCall, firstCall]
}), /Duplicate emitter catalog entry/u);
assert.throws(() => checkEmitterCatalog([commentTree], {
    ...commentCatalog,
    syntheticCommentCalls: [firstCall]
}), /Missing emitter catalog entry/u);
assert.throws(() => checkEmitterCatalog([commentTree], {
    ...commentCatalog,
    syntheticCommentCalls: [firstCall, { ...secondCall, range: [0, 1] }]
}), /Stale emitter catalog entry/u);
assert.throws(() => checkEmitterCatalog([commentTree], {
    ...commentCatalog,
    syntheticCommentCalls: [firstCall, { ...secondCall, method: 'addSyntheticTrailingComment' }]
}), /Changed emitter method/u);
assert.throws(() => checkEmitterCatalog([commentTree], {
    ...commentCatalog,
    syntheticCommentCalls: [firstCall, { ...secondCall, textExpression: "'eslint-disable-next-line no-undef -- changed.'" }]
}), /Changed emitter text/u);
