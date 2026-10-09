import assert from 'node:assert/strict';

import typescript from 'typescript';

import { lowerCollectionAgreementPlacements } from '../transforms/typescript/lowering/collection-reconstruction.js';
import { compileDestructuringDecisions } from '../transforms/typescript/policy/decision-store.js';
import { collectDestructuringAgreements } from '../transforms/typescript/policy/source-agreements.js';
import {
    getConsumerContractKey
} from '../transforms/typescript/understand/type-evidence.js';

const source = [
    'function build(step) {',
    '    const result = new Map();',
    '    const value = step.value;',
    '    result.set(1, value);',
    '    {',
    '        const result = { set() {} };',
    '        result.set(2, value);',
    '    }',
    '    return result;',
    '}'
].join('\n');
const sourceFile = typescript.createSourceFile('collection-phase.ts', source, typescript.ScriptTarget.ESNext, true);
const { statements: [owner = {}] = [] } = sourceFile;
const { body = {} } = owner;
const { statements: [builder = {}, selected = {}, update = {}] = [] } = body;
const { declarationList: builderList = {} } = builder;
const { declarations: [builderDeclaration = {}] = [] } = builderList;
const { declarationList: selectionList = {} } = selected;
const { declarations: [selectionDeclaration = {}] = [] } = selectionList;
const { initializer: selectedRead = {} } = selectionDeclaration;
const builderRange = getConsumerContractKey(builderDeclaration);
const selectedRange = getConsumerContractKey(selectedRead);
const updateRange = getConsumerContractKey(update.expression);
const destructuringAgreements = collectDestructuringAgreements({
    collectionReconstructionContracts: new Map([[builderRange, {
        action: 'operational-collection-builder',
        collection: {
            name: 'result', type: 'Map', ownerName: 'build',
            mutationSites: [{ key: updateRange, method: 'set' }],
            iteratorResultBindings: [{ key: selectedRange, stateName: 'step', aliasName: 'value' }]
        }
    }]])
});
const printPhase = ({ annotationsOnly = false } = {}) => {
    const parsed = typescript.createSourceFile('collection-phase.ts', source, typescript.ScriptTarget.ESNext, true);
    const { transformed = [], dispose = () => {} } = typescript.transform(parsed, [context => root => (
        lowerCollectionAgreementPlacements({
            typescript, node: root, destructuringAgreements: compileDestructuringDecisions(destructuringAgreements), context, annotationsOnly
        })
    )]);
    const [placed = parsed] = transformed;
    const printed = typescript.createPrinter().printFile(placed);

    dispose();

    return printed;
};

const sourceTime = printPhase();
const finalAnnotations = printPhase({ annotationsOnly: true });

assert.match(sourceTime, /const \{ value = undefined \} = step;/);
assert.doesNotMatch(sourceTime, /const value = step\.value;/);
assert.match(finalAnnotations, /const value = step\.value;/);
assert.doesNotMatch(finalAnnotations, /const \{ value = undefined \} = step;/);
assert.match(finalAnnotations, /Owned Map\/Set builder preserves source iterator staging and transfers only at return/);
const annotationMatches = finalAnnotations.match(/Owned Map\/Set builder preserves source iterator staging/g) || [];

assert.equal(annotationMatches.length, 1);
