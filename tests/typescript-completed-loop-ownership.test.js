import assert from 'node:assert/strict';

import typescript from 'typescript';

import { compileDestructuringDecisions } from '../transforms/typescript/policy/decision-store.js';
import { isCompletedLiveCollectionLoop } from '../transforms/typescript/policy/destructuring-agreements.js';
import { getConsumerContractKey } from '../transforms/typescript/understand/type-evidence.js';

const sourceFile = typescript.createSourceFile(
    'completed-loop.ts', 'for (const value of values) { use(value); }', typescript.ScriptTarget.Latest, true
);
const { statements: [loop = {}] = [] } = sourceFile;
const key = getConsumerContractKey(loop);
const check = (entry = {}, node = loop) => isCompletedLiveCollectionLoop({
    typescript,
    node,
    destructuringAgreements: compileDestructuringDecisions(new Map([[key, [entry]]]))
});
const collection = {
    kind: 'collection-reconstruction',
    contract: {
        action: 'operational-collection-builder',
        collection: { directLiveCollection: true, loopRange: key }
    }
};
const object = {
    kind: 'operational-object-builder',
    contract: { action: 'operational-object-builder', loopRange: key }
};
const array = {
    kind: 'live-array-visitation',
    contract: { action: 'retain-live-array-visitation', loopRange: key }
};

assert.equal(check(collection), true);
assert.equal(check(object), true);
assert.equal(check(array), true);

const cloned = typescript.factory.createForOfStatement(
    undefined, loop.initializer, loop.expression, loop.statement
);
typescript.setOriginalNode(cloned, loop);
assert.equal(check(collection, cloned), true);
assert.equal(check(collection, typescript.factory.createIdentifier('value')), false);
assert.equal(check({
    ...collection,
    contract: { ...collection.contract, collection: { directLiveCollection: false, loopRange: key } }
}), false);
assert.equal(check({ ...object, contract: { ...object.contract, loopRange: '0:0' } }), false);
assert.equal(check({ ...array, contract: { ...array.contract, action: 'retain' } }), false);
assert.equal(isCompletedLiveCollectionLoop({
    typescript, node: loop, ...JSON.parse('{"destructuringAgreements": false}')
}), false);
