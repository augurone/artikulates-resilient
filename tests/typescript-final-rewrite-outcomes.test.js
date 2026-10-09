import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import typescript from 'typescript';

import { compileDestructuringDecisions } from '../transforms/typescript/policy/decision-store.js';
import { compilePlacementDecisions } from '../transforms/typescript/policy/placement.js';
import { collectDestructuringAgreements } from '../transforms/typescript/policy/source-agreements.js';
import { collectPlacementEvidence } from '../transforms/typescript/understand/placement-evidence.js';
import {
    getConsumerContractKey
} from '../transforms/typescript/understand/type-evidence.js';

const url = new URL('../transforms/typescript/grammar/final.js', import.meta.url);
const source = readFileSync(url, 'utf8');
const owners = ['getIndexedAssignment', 'getIndexedRead', 'getRuntimeGuardExpression'];
const parsed = typescript.createSourceFile('final.js', source, typescript.ScriptTarget.ESNext, true);
const findOwners = (node = {}) => {
    const { name = {}, initializer = {} } = node;

    return typescript.isVariableDeclaration(node) && owners.includes(name.getText(parsed))
        ? [initializer]
        : node.getChildren(parsed).flatMap(findOwners);
};
const bodies = findOwners(parsed);
assert.equal(bodies.length, 3);
const previous = bodies.toReversed().reduce((text = '', body = {}) => {
    const start = body.getStart(parsed);
    const end = Reflect.get(body, 'end');
    const original = text.slice(start, end).replace(/return false;/gu, 'return undefined;');

    return `${text.slice(0, start)}${original}${text.slice(end)}`;
}, source);
const load = (text = '', probe = false) => {
    const accessible = probe ? text.replace('return typescript.visitNode(sourceFile, visit);',
        `return { ${owners.join(', ')}, getRuntimeGuardStatements };`) : text;
    const rebased = accessible.replace(/from '([^']+)'/gu, (match, relative) => `from ${JSON.stringify(new URL(relative, url).href)}`);

    return import(`data:text/javascript;base64,${Buffer.from(rebased).toString('base64')}`);
};
const [[before = {}, after = {}] = [], [beforeProbe = {}, afterProbe = {}] = []] = await Promise.all([
    Promise.all([load(previous), load(source)]), Promise.all([load(previous, true), load(source, true)])
]);
const parse = (code = '') => typescript.createSourceFile('rewrite.ts', code, typescript.ScriptTarget.ESNext, true);
const code = 'function run(values: { [key: number]: number }, key: number) { values[0]; values[key]; values[0] = 1; values[0]++; }';
const root = parse(code);
const host = typescript.createCompilerHost({ noLib: true });
const program = typescript.createProgram(['rewrite.ts'], { noLib: true }, {
    ...host, getSourceFile: (name, version) => name === 'rewrite.ts' ? root : host.getSourceFile(name, version)
});
const placement = compilePlacementDecisions({ typescript, evidence: collectPlacementEvidence({ typescript, sourceFile: root, checker: program.getTypeChecker() }) });
const requireProof = (...args) => {
    throw new Error(`Missing proof owner for ${args.length} arguments.`);
};
const collect = (node = {}) => [node, ...node.getChildren(root).flatMap(collect)];
const nodes = collect(root);
const reads = nodes.filter(typescript.isElementAccessExpression);
const [read = {}] = reads;
const key = getConsumerContractKey(read);
const maps = [new Map(), collectDestructuringAgreements({
    collectionReconstructionContracts: new Map([[key, {
        action: 'operational-collection-builder', collection: { callbackParameterOwned: true, selectionRanges: [key] }
    }]])
}), ...['rest-array-fixed-selection', 'rest-array-staged-selection', 'rest-array-retained-index',
    'rest-array-retained-effect-order'].map(action => collectDestructuringAgreements({
    restArraySelectionContracts: new Map([[key, { action, captured: true }]])
}))];
maps.forEach((destructuringAgreements, mapIndex) => {
    const [prior = {}, current = {}] = [beforeProbe, afterProbe].map(({ lowerFinalGrammar = requireProof } = {}) => (
        lowerFinalGrammar({ typescript, sourceFile: root, placement, destructuringAgreements: compileDestructuringDecisions(destructuringAgreements) })
    ));
    reads.forEach((node) => {
        const { parent = {} } = node;
        const oldResult = prior.getIndexedRead(node, parent);
        const result = current.getIndexedRead(node, parent);
        assert.equal(Boolean(result), Boolean(oldResult));

        if (oldResult) assert.equal(typescript.createPrinter().printNode(typescript.EmitHint.Expression, result, root),
            typescript.createPrinter().printNode(typescript.EmitHint.Expression, oldResult, root));

        if (!oldResult) {
            assert.equal(result, false);
            assert.equal(result || node, oldResult || node, 'Declining a rewrite retains the exact input node.');
        }
    });
    assert.equal(Boolean(current.getIndexedRead(read)), mapIndex === 0,
        'A canonical static read is admitted; each completed operational/rest owner declines it.');
});
assert.equal(afterProbe.lowerFinalGrammar({ typescript, sourceFile: root }).getIndexedRead(read), false,
    'Without a canonical checker result no replacement/default is fabricated.');

// AST metadata Get and native factory failures remain local, even on a declined
// rewrite. An always-declining assignment path is not pure on hostile ASTs.
['getIndexedAssignment', 'getIndexedRead'].forEach((owner) => {
    ['kind', 'expression', 'operatorToken', 'left'].forEach((field) => {
        const failure = new Error(`${owner}:${field}`);
        const observe = (module = {}) => {
            let events = [];
            const node = new Proxy(read, { get(target = {}, property = '') {
                events = [...events, String(property)];

                if (property === field) throw failure;

                return Reflect.get(target, property);
            } });
            const capabilities = module.lowerFinalGrammar({ typescript, sourceFile: root, placement });
            let outcome;
            try { outcome = Boolean(capabilities[owner](node)); }
            catch (error) { assert.equal(error, failure); outcome = 'exact failure'; }

            return { outcome, events };
        };
        assert.deepEqual(observe(afterProbe), observe(beforeProbe));
    });
});
nodes.filter(typescript.isBinaryExpression).forEach((node) => {
    [beforeProbe, afterProbe].forEach((module) => {
        const result = module.lowerFinalGrammar({ typescript, sourceFile: root }).getIndexedAssignment(node);
        assert.equal(Boolean(result), false);
        assert.equal(result || node, node);
    });
});
['string', 'number', 'boolean', 'bigint', 'array', 'object', 'function', 'unknown', '', 'required'].forEach((kind) => {
    const [prior = {}, current = {}] = [beforeProbe, afterProbe].map(module => module.lowerFinalGrammar({ typescript, sourceFile: root }));
    const oldGuard = prior.getRuntimeGuardExpression(kind, 'value');
    const guard = current.getRuntimeGuardExpression(kind, 'value');
    assert.equal(Boolean(guard), Boolean(oldGuard));

    if (guard) assert.equal(typescript.createPrinter().printNode(typescript.EmitHint.Expression, guard, root),
        typescript.createPrinter().printNode(typescript.EmitHint.Expression, oldGuard, root));

    if (!guard) assert.equal(guard, false);
});
const failure = new Error('identifier construction');
[beforeProbe, afterProbe].forEach((module) => {
    const compiler = { ...typescript, factory: { ...typescript.factory, createIdentifier: () => { throw failure; } } };
    const capabilities = module.lowerFinalGrammar({ typescript: compiler, sourceFile: root });
    assert.throws(() => capabilities.getRuntimeGuardExpression('unknown', 'value'), error => error === failure);
});
const { statements: [unknownBinding = {}] = [] } = parse('const { value } = input;');
[beforeProbe, afterProbe].forEach((module) => {
    let guardStatements = 0;
    const compiler = { ...typescript, factory: { ...typescript.factory, createIfStatement: (...args) => {
        guardStatements += 1;

        return typescript.factory.createIfStatement(...args);
    } } };
    const capabilities = module.lowerFinalGrammar({ typescript: compiler, sourceFile: root });
    assert.deepEqual(capabilities.getRuntimeGuardStatements(unknownBinding, true), []);
    assert.equal(guardStatements, 0, 'An absent guard result is not passed to the factory.');
});
[
    code,
    'function run(value: number[]) { return value[0]; }',
    'function run({ value }: { value: unknown }) { return value; }',
    'function run({ value }: { value: number }) { return value; }'
].forEach((text) => {
    const outputs = [before, after].map(({ lowerFinalGrammar = requireProof } = {}) => {
        const input = parse(text);
        const { transformed: [output = input] = [], dispose = () => {} } = typescript.transform(input, [context => sourceFile => (
            lowerFinalGrammar({ typescript, sourceFile, context })
        )]);
        const printed = typescript.createPrinter().printFile(output);
        dispose();

        return printed;
    });
    const [oldOutput = '', newOutput = ''] = outputs;
    assert.equal(newOutput, oldOutput);
});
