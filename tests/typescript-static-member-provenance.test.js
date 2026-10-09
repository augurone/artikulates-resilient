import assert from 'node:assert/strict';

import typescript from 'typescript';

import { compileDestructuringDecisions } from '../transforms/typescript/policy/decision-store.js';
import { annotateRetainedStaticMemberAccess } from '../transforms/typescript/policy/exceptions.js';
import { collectDestructuringAgreements } from '../transforms/typescript/policy/source-agreements.js';
import {
    getConsumerContractKey
} from '../transforms/typescript/understand/type-evidence.js';

const getNodes = ({ root = {}, kind = -1 } = {}) => {
    let nodes = [];
    const visit = (node = {}) => {
        const { kind: nodeKind = -1 } = node;

        if (nodeKind === kind) nodes = [...nodes, node];

        typescript.forEachChild(node, visit);
    };

    visit(root);

    return nodes;
};

const annotate = ({ source = '', projectionContracts = new Map(), tupleContracts = new Map() } = {}) => {
    const sourceFile = typescript.createSourceFile('provenance.ts', source, typescript.ScriptTarget.ESNext, true);
    const destructuringAgreements = collectDestructuringAgreements({
        receiverOrderedProjectionContracts: projectionContracts,
        shortCircuitTupleArgumentContracts: tupleContracts
    });
    const { transformed = [], dispose = () => {} } = typescript.transform(sourceFile, [context => root => (
        annotateRetainedStaticMemberAccess({ typescript, sourceFile: root, destructuringAgreements: compileDestructuringDecisions(destructuringAgreements), context })
    )]);
    const [annotated = sourceFile] = transformed;
    const printed = typescript.createPrinter().printFile(annotated);

    dispose();

    return printed;
};

const projectionSource = [
    'function first(as, S) { return as.reduce(S.concat); }',
    'function second(as, S) { return as.reduce(S.concat); }'
].join('\n');
const projectionFile = typescript.createSourceFile('projection.ts', projectionSource, typescript.ScriptTarget.ESNext, true);
const [firstProjectionRead = {}, secondProjectionRead = {}] = getNodes({
    root: projectionFile,
    kind: typescript.SyntaxKind.PropertyAccessExpression
}).filter(({ name: { text = '' } = {} } = {}) => text === 'concat');
const firstProjectionRange = getConsumerContractKey(firstProjectionRead);
const secondProjectionRange = getConsumerContractKey(secondProjectionRead);

assert.notEqual(firstProjectionRange, secondProjectionRange);
const projectionOutput = annotate({
    source: projectionSource,
    projectionContracts: new Map([[firstProjectionRange, {
        action: 'retain-receiver-ordered-projection', sourceRange: firstProjectionRange,
        providerName: 'S', receiverName: 'as', projectedMember: 'concat', receiverMethod: 'reduce'
    }]])
});

assert.equal(projectionOutput.split('projected method getter follows receiver method lookup').length - 1, 1);
assert.match(projectionOutput, /function first[\s\S]*eslint-disable-next-line resilient\/prefer-destructured-member-access[\s\S]*function second/);
assert.doesNotMatch(projectionOutput.split('function second')[1], /eslint-disable-next-line/);

const tupleSource = [
    'function first(found, SK, k) { if (!SK.equals(k, found.value[0])) return false; return true; }',
    'function second(found, SK, k) { if (!SK.equals(k, found.value[0])) return false; return true; }'
].join('\n');
const tupleFile = typescript.createSourceFile('tuple.ts', tupleSource, typescript.ScriptTarget.ESNext, true);
const [firstIf = {}] = getNodes({ root: tupleFile, kind: typescript.SyntaxKind.IfStatement });
const [firstTupleRead = {}, secondTupleRead = {}] = getNodes({
    root: tupleFile,
    kind: typescript.SyntaxKind.ElementAccessExpression
});
const firstTupleRange = getConsumerContractKey(firstTupleRead);

assert.notEqual(firstTupleRange, getConsumerContractKey(secondTupleRead));
const tupleOutput = annotate({
    source: tupleSource,
    tupleContracts: new Map([[firstTupleRange, {
        action: 'retain-receiver-ordered-tuple-argument', sourceRange: firstTupleRange,
        ifRange: getConsumerContractKey(firstIf), tupleOwnerName: 'found', tuplePropertyName: 'value',
        methodReceiverName: 'SK', methodPropertyName: 'equals', index: 0
    }]])
});

assert.equal(tupleOutput.split('short-circuit and receiver method lookup precede this tuple read').length - 1, 1);
assert.match(tupleOutput, /function first[\s\S]*eslint-disable-next-line resilient\/prefer-destructured-member-access[\s\S]*function second/);
assert.doesNotMatch(tupleOutput.split('function second')[1], /eslint-disable-next-line/);
