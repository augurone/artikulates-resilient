import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';

import { ESLint } from 'eslint';
import typescript from 'typescript';

import resilient from 'eslint-plugin-resilient';

// eslint-disable-next-line import/no-useless-path-segments -- Node ESM requires the member grammar entry filename.
import { lowerDiscriminatedSwitchAccess } from '../transforms/typescript/members/index.js';
import { compileDestructuringDecisions } from '../transforms/typescript/policy/decision-store.js';
import { collectDestructuringAgreements } from '../transforms/typescript/policy/source-agreements.js';
import { collectPlacementEvidence } from '../transforms/typescript/understand/placement-evidence.js';
import { collectSelectedModelContracts } from '../transforms/typescript/understand/type-evidence.js';

const variant = 'type E = { _tag: "Left"; left: unknown } | { _tag: "Right"; right: unknown };';
const selection = 'switch(v._tag) { case "Left": if(accept(v.left)) return true; break; case "Right": if(accept(v.right)) return true; break; }';
const cases = [
    { name: 'local', source: `export function probe(items: Set<E>, accept: (value: unknown) => boolean) { for (const v of items) { ${selection} } return false; }`, boundaries: 0 },
    { name: 'method', source: `export function probe(accept: (value: unknown) => boolean) { return { run(v: E) { ${selection} return false; } }; }`, boundaries: 2 },
    { name: 'unknown', source: `export function probe(v: E, accept: (value: unknown) => boolean) { ${selection} return false; }`, boundaries: 2 },
    { name: 'parameter', source: `export function probe(v: E, accept: (value: unknown) => boolean) { ${selection} return false; }`, boundaries: 2 },
    { name: 'shadowed', source: `export function probe(v: E, items: Set<E>, accept: (value: unknown) => boolean) { void v; for (const v of items) { ${selection} } return false; }`, boundaries: 0 },
    { name: 'captured', source: `export function probe(v: E, accept: (value: unknown) => boolean) { return () => { ${selection} return false; }; }`, boundaries: 0 },
    // Whole-reference applicability is deliberately conservative for parameters;
    // this ownership change must not invent a new return/reference classifier.
    { name: 'whole', source: `export function probe(v: E, accept: (value: unknown) => boolean) { ${selection} return accept(v); }`, boundaries: 2 }
];
const compilerOptions = { strict: true, target: typescript.ScriptTarget.ESNext, module: typescript.ModuleKind.ESNext };
const files = new Map(cases.map(({ name = '', source = '' } = {}) => {
    const fileName = `${name}-switch-ownership.ts`;

    return [fileName, typescript.createSourceFile(fileName, `${variant}\n${source}`, typescript.ScriptTarget.ESNext, true)];
}));
const compilerHost = typescript.createCompilerHost(compilerOptions);
const { getSourceFile: originalGetSourceFile = () => {} } = compilerHost;
const host = { ...compilerHost,
    getSourceFile: (name, languageVersion, onError) => files.get(name) || originalGetSourceFile(name, languageVersion, onError) };
const program = typescript.createProgram([...files.keys()], compilerOptions, host);
const checker = program.getTypeChecker();
const lint = new ESLint({ overrideConfigFile: true, overrideConfig: [{
    plugins: { resilient }, rules: { 'resilient/prefer-signature-destructuring': 'error' }
}] });
const transpile = (source = '') => typescript.transpileModule(source, { compilerOptions }).outputText.replace(/\bexport /gu, '');

await Promise.all(cases.map(async ({ name = '', boundaries = 0 } = {}) => {
    const sourceFile = program.getSourceFile(`${name}-switch-ownership.ts`);
    const selectedModelContracts = collectSelectedModelContracts({ typescript, sourceFile, checker });
    const evidence = collectPlacementEvidence({ typescript, sourceFile, checker });
    const { facts = new Map() } = evidence;
    const { text: sourceText = '' } = sourceFile;
    // Losing provenance cannot establish that a binding is a local.
    const placement = name === 'unknown'
        ? { ...evidence, facts: new Map([...facts].map(([node = {}, fact = {}] = []) => [node, { ...fact, symbol: false }])) }
        : evidence;
    const destructuringAgreements = compileDestructuringDecisions(collectDestructuringAgreements({ selectedModelContracts }));
    assert.equal(selectedModelContracts.size, 2);
    const { transformed: [placed = sourceFile] = [], dispose = () => {} } = typescript.transform(sourceFile, [context => (root) => {
        const visit = (node) => {
            const visited = typescript.visitEachChild(node, visit, context);

            return typescript.isFunctionDeclaration(visited) || typescript.isArrowFunction(visited)
                ? lowerDiscriminatedSwitchAccess({ typescript, node: visited, placement, destructuringAgreements, context })
                : visited;
        };

        return typescript.visitNode(root, visit);
    }]);
    const output = typescript.createPrinter().printFile(placed);
    dispose();
    assert.equal(output.split('selected payload Get remains after tag selection').length - 1, boundaries, name);
    const code = transpile(output);
    const [result = {}] = await lint.lintText(code, { filePath: `${name}-switch-ownership.js` });
    assert.deepEqual(result.messages.filter(({ ruleId = '' } = {}) => ruleId), [], name);
    assert.equal(result.suppressedMessages.length, ['parameter', 'unknown', 'method'].includes(name) ? 2 : 0, name);
    const setup = [
        'const events = [];',
        'const accept = value => { events.push(["call", value]); return false; };',
        'const make = (tag, fail) => ({ get _tag() { events.push("tag"); return tag; },',
        'get left() { events.push("left"); if(fail) throw new TypeError("payload"); return undefined; },',
        'get right() { events.push("right"); if(fail) throw new TypeError("payload"); return 4; } });'
    ].join('\n');
    ['Left', 'Right'].forEach((tag) => {
        [false, true].forEach((fail) => {
            let call = 'probe(input, accept)';

            if (name === 'local') call = 'probe(new Set([input]), accept)';

            if (name === 'shadowed') call = 'probe(make("Right", true), new Set([input]), accept)';

            if (name === 'method') call = 'probe(accept).run(input)';

            if (name === 'captured') call = 'probe(input, accept)()';

            const exercise = `const input=make(${JSON.stringify(tag)},${fail}); let result; try { result=${call}; } catch(error) { result=error.name; } JSON.stringify({result,events});`;
            assert.equal(runInNewContext(`${setup}\n${code}\n${exercise}`),
                runInNewContext(`${setup}\n${transpile(sourceText)}\n${exercise}`), `${name}/${tag}/${fail}`);
        });
    });
}));
