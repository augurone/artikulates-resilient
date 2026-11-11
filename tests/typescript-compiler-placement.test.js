import { deepStrictEqual, strictEqual, throws } from 'node:assert/strict';
import test from 'node:test';

import typescript from 'typescript';

import { createTypeScriptAnalysis } from 'eslint-plugin-resilient/analyzer/typescript';

import { lowerTupleConsumerBindings } from '../transforms/typescript/members/tuple-consumers.js';
import { compileDestructuringDecisions } from '../transforms/typescript/policy/decision-store.js';
import { collectConsumerBindingContracts } from '../transforms/typescript/understand/type-evidence.js';

const sourceText = 'function outer([value]: [number]) { return [value]; }';
const prepare = ({ filename = '/placement.ts', revision = '1', programRevision = '1', compilerOptionsIdentity = '{}' } = {}) => {
    const sourceFile = typescript.createSourceFile(filename, sourceText, 99, true);
    const analysis = createTypeScriptAnalysis({ typescript, sourceFile, sourceText, filename, revision, programRevision, compilerOptionsIdentity });
    const contracts = collectConsumerBindingContracts({ typescript, sourceFile, sourceAnalysis: analysis });
    const facts = new Map([...contracts].map(([key = '', contract = {}] = []) => [key, [{ kind: 'consumer', contract }]]));
    const { statements: [node = {}] = [] } = sourceFile;
    const { source = {} } = analysis;

    return { node, source, destructuringAgreements: compileDestructuringDecisions(facts) };
};

test('compiler placement: completed policy is consumed once without rewriting native syntax', () => {
    const input = prepare();
    const agreements = new Set();
    const { node = {} } = input;
    const result = lowerTupleConsumerBindings({ ...input, typescript, agreements });
    const [{ action = '', runtimeEvidence: { status = '' } = {} } = {}] = [...agreements];

    strictEqual(result, node);
    strictEqual(action, 'preserve-native-tuple');
    strictEqual(status, 'unknown');
});

[
    { filename: '/other.ts' },
    { revision: '2' },
    { programRevision: '2' },
    { compilerOptionsIdentity: '{"strict":true}' }
].forEach((revision, index) => test(`compiler placement: reject stale identity dimension ${index}`, () => {
    const old = prepare();
    const current = prepare(revision);
    const { source = {} } = current;
    const agreements = new Set();

    throws(() => lowerTupleConsumerBindings({ ...old, typescript, source, agreements }), /Stale compiler tuple placement/u);
    deepStrictEqual([...agreements], []);
}));

test('compiler placement: equal spans in a new AST cannot borrow the old decision', () => {
    const old = prepare();
    const { node = {} } = prepare();

    throws(() => lowerTupleConsumerBindings({ ...old, typescript, node }), /Stale compiler tuple placement/u);
});

test('compiler collection: foreign roots cannot lend equal-span proofs before or after demand', () => {
    const filename = '/original.ts';
    const sourceFile = typescript.createSourceFile(filename, sourceText, 99, true);
    const analysis = createTypeScriptAnalysis({ typescript, sourceFile, sourceText, filename,
        revision: '1', programRevision: '1', compilerOptionsIdentity: '{}' });
    const reject = () => ['/original.ts', '/foreign.ts'].forEach((name) => {
        const foreign = typescript.createSourceFile(name, sourceText, 99, true);

        throws(() => collectConsumerBindingContracts({ typescript, sourceFile: foreign, sourceAnalysis: analysis }), /source identity mismatch/u);
    });

    reject();
    analysis.checkTuple({ index: 0 });
    reject();
    strictEqual(collectConsumerBindingContracts({ typescript, sourceFile, sourceAnalysis: analysis }).size, 1);
});

test('compiler placement: a compiler clone with the original identity retains the decision', () => {
    const input = prepare();
    const { node = {} } = input;
    const clone = typescript.factory.updateFunctionDeclaration(node, typescript.factory.createNodeArray(),
        Reflect.get(node, 'asteriskToken'), Reflect.get(node, 'name'), Reflect.get(node, 'typeParameters'),
        Reflect.get(node, 'parameters'), Reflect.get(node, 'type'), Reflect.get(node, 'body'));
    const agreements = new Set();

    strictEqual(typescript.getOriginalNode(clone), node);
    strictEqual(lowerTupleConsumerBindings({ ...input, typescript, node: clone, agreements }), clone);
    strictEqual(agreements.size, 1);
});

['number', 'string'].forEach(family => test(`compiler pair placement: ${family} second requirement reaches completed native-preservation policy`, () => {
    const filename = '/pair-placement.ts';
    const sourceText = `function outer([left, right]: [number, ${family}]) { return [left, right]; } outer([3]);`;
    const sourceFile = typescript.createSourceFile(filename, sourceText, 99, true);
    const analysis = createTypeScriptAnalysis({ typescript, sourceFile, sourceText, filename,
        revision: '1', programRevision: '1', compilerOptionsIdentity: '{}' });
    const contracts = collectConsumerBindingContracts({ typescript, sourceFile, sourceAnalysis: analysis });
    const [{ tuple: { arity = 0, containers = [] } = {}, positions = [] } = {}] = [...contracts.values()];

    strictEqual(arity, 2);
    deepStrictEqual(containers, [{ path: [], arity: 2 }]);
    deepStrictEqual(positions.map(({ path = [], name = '', kind = '' } = {}) => ({ path, name, kind })),
        [{ path: [0], name: 'left', kind: 'number' }, { path: [1], name: 'right', kind: family }]);
    const facts = new Map([...contracts].map(([key = '', contract = {}] = []) => [key, [{ kind: 'consumer', contract }]]));
    const destructuringAgreements = compileDestructuringDecisions(facts);
    const { statements: [node = {}] = [] } = sourceFile;
    const { source = {} } = analysis;
    const agreements = new Set();

    strictEqual(lowerTupleConsumerBindings({ typescript, node, source, destructuringAgreements, agreements }), node);
    const [{ runtimeEvidence: { calls: [{ slots = [] } = {}] = [] } = {} } = {}] = [...agreements];

    deepStrictEqual(slots.map(({ result: { status = '' } = {} } = {}) => status), ['agreement', 'contradiction']);
}));

[
    'function inner(input: number) { return [input]; } return inner(value);',
    'const result = [value]; function inner() { const result = 1; return result; } return result;',
    'const unrelated = () => 1; return [value];',
    'const unrelated = function () { return 1; }; return [value];',
    'if (value) { function unrelated() { return 1; } } return [value];'
].forEach((body, index) => test(`compiler forwarding placement ${index}: consume the completed shared result without a checker`, () => {
    const filename = '/forwarding-placement.ts';
    const sourceText = `export function outer([value]: [number]) { ${body} } outer(['wrong']); outer(external);`;
    const sourceFile = typescript.createSourceFile(filename, sourceText, 99, true);
    const analysis = createTypeScriptAnalysis({ typescript, sourceFile, sourceText, filename,
        revision: '1', programRevision: '1', compilerOptionsIdentity: '{}' });
    const contracts = collectConsumerBindingContracts({ typescript, sourceFile, sourceAnalysis: analysis });
    const facts = new Map([...contracts].map(([key = '', contract = {}] = []) => [key, [{ kind: 'consumer', contract }]]));
    const destructuringAgreements = compileDestructuringDecisions(facts);
    const { statements: [node = {}] = [] } = sourceFile;
    const { source = {} } = analysis;
    const agreements = new Set();

    strictEqual(lowerTupleConsumerBindings({ typescript, node, source, destructuringAgreements, agreements }), node);
    const [{ runtimeEvidence = {} } = {}] = [...agreements];

    strictEqual(runtimeEvidence, analysis.checkTuple({ index: 0 }));
    deepStrictEqual(runtimeEvidence.calls.map(({ status = '' } = {}) => status), ['contradiction', 'unknown']);
}));
