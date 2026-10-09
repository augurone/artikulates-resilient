import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import typescript from 'typescript';

import { writeJsonReport } from './json-report.js';
import { listFiles, readJson, readText } from './proof-files.js';
import { getObject } from '../rules/support/object.js';
import { completeGroups } from '../tests/support/decision-routes.js';
import { compileDestructuringDecisions } from '../transforms/typescript/policy/decision-store.js';
import { collectDestructuringAgreements } from '../transforms/typescript/policy/source-agreements.js';
import { getChildren } from '../transforms/utils/ast-traversal.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const getNodes = node => [node, ...getChildren({ typescript, node }).flatMap(getNodes)];
const getTrees = () => listFiles(path.join(root, 'transforms')).filter(file => file.endsWith('.js')).map((file) => {
    const relative = path.relative(root, file);
    const tree = typescript.createSourceFile(relative, readText(file), typescript.ScriptTarget.ESNext, true);

    return { file: relative, tree, nodes: getNodes(tree) };
});
const owners = [
    ['transforms/typescript/understand/source-census.js', 'createSourceCensus'],
    ['transforms/typescript/policy/source-agreements.js', 'collectDestructuringAgreements'],
    ['transforms/typescript/policy/decision-store.js', 'compileDestructuringDecisions'],
    ['transforms/typescript/policy/defaults.js', 'getDestructuringAgreement'],
    ['transforms/typescript/understand/placement-evidence.js', 'collectPlacementEvidence']
];
const buildDecisionCatalog = (trees = getTrees()) => {
    const { byKind = new Map() } = compileDestructuringDecisions(collectDestructuringAgreements(completeGroups));

    const { nodes: publicationNodes = [] } = getObject(trees.find(({ file = '' } = {}) => file === 'transforms/typescript/policy/source-agreements.js'));
    const declaration = publicationNodes.find(node => typescript.isVariableDeclaration(node) && node.name.getText() === 'collectDestructuringAgreements');
    const { initializer: { parameters: [{ name: { elements = [] } = {} } = {}] = [] } = {} } = getObject(declaration);
    const inputs = elements.filter(({ initializer = {} } = {}) => typescript.isNewExpression(initializer))
        .map(({ name = {} } = {}) => name.getText()).toSorted();

    if (JSON.stringify(inputs) !== JSON.stringify(Object.keys(completeGroups).toSorted())) throw new Error('Publication probes must cover every production input map.');

    return {
        scope: 'Current parsed navigation and finite publication probes, not semantic admission or exception authority. No callable census is an ownership proof.',
        authority: 'docs/engineering/REARCHITECTURE.md',
        analyzerOwnerCatalog: 'docs/engineering/REARCHITECTURE.md#analyzer-and-rule-ownership',
        acceptedTransformerOwnerCatalog: 'docs/engineering/REARCHITECTURE.md#transformer-ownership',
        proof: 'tests/typescript-decision-store.test.js',
        publicationInputs: inputs,
        owners: owners.map(([file = '', name = '']) => {
            const { tree = {}, nodes = [] } = getObject(trees.find(({ file: candidate = '' } = {}) => candidate === file));
            const declaration = nodes.find(node => typescript.isVariableDeclaration(node) && node.name.getText(tree) === name);

            if (!declaration) throw new Error(`Missing catalog owner: ${file}:${name}`);

            const { line = 0 } = tree.getLineAndCharacterOfPosition(declaration.getStart(tree));

            return { file, name, line: line + 1 };
        }),
        semanticRoutes: [...byKind.keys()].toSorted().map(kind => ({
            kind,
            interpretation: 'Compiled once by compileDestructuringDecisions through getDestructuringAgreement; placement consumes the completed store.',
            references: trees.flatMap(({ file = '', tree = {}, nodes = [] } = {}) => nodes
                .filter(node => typescript.isStringLiteral(node) && getObject(node).text === kind)
                .map((node) => {
                    const start = node.getStart(tree);
                    const { line = 0 } = tree.getLineAndCharacterOfPosition(start);

                    return { file, line: line + 1, range: [start, getObject(node).end] };
                }))
        }))
    };
};
const emitterCatalogFile = path.join(root, 'docs/engineering/transformer-source-emitters.json');
const getDirectiveKey = ({ file = '', range: [start = 0, end = 0] = [] } = {}) => `${file}:${start}:${end}`;
const syntheticCommentMethodPattern = /^(?:add|set)Synthetic(?:Leading|Trailing)Comments?$/u;
const collectSyntheticCommentCalls = (trees = []) => trees.flatMap(({ file = '', tree = {}, nodes = [] } = {}) => nodes
    .filter(node => typescript.isCallExpression(node) && syntheticCommentMethodPattern.test(node.expression.getText().split('.').at(-1)))
    .map((node) => {
        const start = node.getStart(tree);
        const { line = 0 } = tree.getLineAndCharacterOfPosition(start);
        const method = node.expression.getText().split('.').at(-1);
        const { arguments: args = [] } = node;

        return {
            file,
            line: line + 1,
            range: [start, getObject(node).end],
            method,
            textExpression: getObject(args.at(method.startsWith('setSynthetic') ? 1 : 2)).getText(tree)
        };
    }));
const isDirectiveExpression = (node = {}, tree = {}) => {
    const { operatorToken = {} } = getObject(node);
    const { kind = 0 } = getObject(operatorToken);
    const stringExpression = typescript.isStringLiteral(node) || typescript.isNoSubstitutionTemplateLiteral(node) ||
        typescript.isTemplateExpression(node) || typescript.isBinaryExpression(node) && kind === typescript.SyntaxKind.PlusToken;

    return stringExpression && /eslint-(?:disable|enable)/u.test(node.getText(tree));
};
// This deliberately records expression roots and directive fragments. A
// template or concatenation is an executable template in its own right, while
// its literal fragments remain independently auditable source candidates.
const collectDirectiveCandidates = (trees = []) => trees.flatMap(({ file = '', tree = {}, nodes = [] } = {}) => nodes
    .filter(node => isDirectiveExpression(node, tree))
    .map((node) => {
        const start = node.getStart(tree);
        const { line = 0 } = tree.getLineAndCharacterOfPosition(start);
        const { parent = {} } = getObject(node);
        const { kind: parentKind = 0 } = getObject(parent);

        return {
            file,
            line: line + 1,
            range: [start, getObject(node).end],
            text: node.getText(tree),
            context: typescript.SyntaxKind[parentKind]
        };
    }));
const checkEmitterCatalog = (trees = [], {
    syntheticCommentCalls = [], directiveStrings = []
} = readJson(emitterCatalogFile)) => {
    const calls = collectSyntheticCommentCalls(trees);
    const catalogByCallKey = syntheticCommentCalls.reduce((entries = new Map(), entry = {}) => {
        const key = getDirectiveKey(entry);

        if (entries.has(key)) throw new Error(`Duplicate emitter catalog entry: ${key}`);

        return new Map([...entries, [key, entry]]);
    }, new Map());
    const callByKey = new Map(calls.map(call => [getDirectiveKey(call), call]));

    syntheticCommentCalls.forEach(({ file = '', range: [start = 0, end = 0] = [], text = '', textExpression = '', method = '', relatedProof = '' } = {}) => {
        const key = getDirectiveKey({ file, range: [start, end] });
        const call = callByKey.get(key);

        if (!call) throw new Error(`Stale emitter catalog entry: ${key}`);

        const { method: callMethod = '', textExpression: callTextExpression = '' } = call;

        if (callMethod !== method) throw new Error(`Changed emitter method: ${key}`);

        if (callTextExpression !== (textExpression || text)) throw new Error(`Changed emitter text: ${key}`);

        if (relatedProof && !existsSync(path.join(root, relatedProof))) throw new Error(`Missing emitter proof: ${relatedProof}`);
    });
    calls.forEach((call = {}) => {
        const key = getDirectiveKey(call);

        if (!catalogByCallKey.has(key)) throw new Error(`Missing emitter catalog entry: ${key}`);
    });

    const candidates = collectDirectiveCandidates(trees);
    const catalogByKey = directiveStrings.reduce((entries = new Map(), entry = {}) => {
        const key = getDirectiveKey(entry);

        if (entries.has(key)) throw new Error(`Duplicate directive catalog entry: ${key}`);

        return new Map([...entries, [key, entry]]);
    }, new Map());
    const candidateByKey = new Map(candidates.map(candidate => [getDirectiveKey(candidate), candidate]));

    directiveStrings.forEach(({ file = '', range = [], text = '' } = {}) => {
        const key = getDirectiveKey({ file, range });
        const candidate = candidateByKey.get(key);

        if (!candidate) throw new Error(`Stale directive catalog entry: ${key}`);

        const { text: candidateText = '' } = candidate;

        if (candidateText !== text) throw new Error(`Changed directive catalog entry: ${key}`);
    });
    candidates.forEach((candidate = {}) => {
        const key = getDirectiveKey(candidate);

        if (!catalogByKey.has(key)) throw new Error(`Missing directive catalog entry: ${key}`);
    });

    return { calls: syntheticCommentCalls.length, strings: directiveStrings.length };
};
const checkProofCatalogs = ({ write = false } = {}) => {
    const file = path.join(root, 'docs/engineering/project-decision-domains.json');
    const trees = getTrees();
    const catalog = buildDecisionCatalog(trees);

    if (write) writeJsonReport(file, catalog);

    if (JSON.stringify(readJson(file)) !== JSON.stringify(catalog)) throw new Error('Stale decision catalog; run npm run proof:catalogs -- --write.');

    const emitters = checkEmitterCatalog(trees);

    return { routes: catalog.semanticRoutes.length, emitters };
};

export { buildDecisionCatalog, checkEmitterCatalog, checkProofCatalogs, collectDirectiveCandidates, collectSyntheticCommentCalls };
