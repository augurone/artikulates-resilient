import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import typescript from 'typescript';

import { createTypeScriptTransformer } from 'eslint-plugin-resilient/typescript';

const directory = await mkdtemp(path.join(tmpdir(), 'resilient-emission-import-order-'));
let importProofCases = [];
const code = [
    "import './z-authored.mjs';",
    "import './a-authored.mjs';",
    "import { events } from './events.mjs';",
    'type Box = { value: string };',
    'export const BoxValue = (box: Box) => Box(box);',
    'type CallablePair = [(value: string) => string, string];',
    'type Mapper = { map: <B>(value: unknown, callback: (pair: CallablePair) => B) => B };',
    'export const invokePair = (F: Mapper, value: unknown) => F.map(value, ([apply, input]) => [apply(input), input]);',
    "events.push('body');",
    'export { events };',
    ''
].join('\n');
try {
    // eslint-disable-next-line resilient/prefer-prototype-methods -- Sequential module cases isolate each temporary graph and its ESM execution.
    for (const kind of ['normal', 'failure']) {
        const root = path.join(directory, kind);
        await mkdir(root);
        await writeFile(path.join(root, 'input.ts'), code);
        await writeFile(path.join(root, 'events.mjs'), 'export const events = [];\nexport const failure = {};\n');
        await writeFile(path.join(root, 'dependency.mjs'), "import { events } from './events.mjs';\nevents.push('dependency');\n");
        const modules = [
            ['z-object.mjs', 'object', true],
            ['a-array.mjs', 'array', false],
            ['m-function.mjs', 'function', true]
        ];
        // eslint-disable-next-line resilient/prefer-prototype-methods -- Each helper file is written before the module graph is evaluated.
        for (const [name = '', helper = '', dependency = false] of modules) {
            const { href: support = '' } = pathToFileURL(path.resolve(`rules/support/${helper}.js`));
            await writeFile(path.join(root, name), [
                dependency ? "import './dependency.mjs';" : '',
                "import { events, failure } from './events.mjs';",
                `events.push('${helper}');`,
                kind === 'failure' && helper === 'array' ? 'throw failure;' : '',
                `export * from '${support}';`,
                ''
            ].join('\n'));
        }
        // eslint-disable-next-line resilient/prefer-prototype-methods -- Authored effect modules must exist before the isolated runtime is loaded.
        for (const name of ['z-authored', 'a-authored']) {
            await writeFile(path.join(root, `${name}.mjs`), `import { events } from './events.mjs';\nevents.push('${name}');\n`);
        }
        const fileName = path.join(root, 'input.ts');
        const program = typescript.createProgram([fileName], {
            strict: true, target: typescript.ScriptTarget.ESNext, module: typescript.ModuleKind.ESNext
        });
        const transformer = createTypeScriptTransformer({ typescript, program, standard: {
            object: './z-object.mjs', array: './a-array.mjs', function: './m-function.mjs'
        } });
        const result = transformer.transform({ code, fileName });
        assert.deepEqual(result.diagnostics, []);
        const tree = typescript.createSourceFile('output.js', result.code, typescript.ScriptTarget.Latest, true);
        const imports = tree.statements.filter(typescript.isImportDeclaration).map(({ moduleSpecifier: { text = '' } = {} }) => text);
        assert.deepEqual(imports, ['./z-object.mjs', './a-array.mjs', './m-function.mjs', './z-authored.mjs', './a-authored.mjs', './events.mjs']);
        await writeFile(path.join(root, 'output.mjs'), result.code);
        // Separate processes prevent the ESM cache from concealing reordered effects.
        const observed = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', [
            `import { events, failure } from ${JSON.stringify(pathToFileURL(path.join(root, 'events.mjs')).href)};`,
            'let exactFailure = false;',
            `try { await import(${JSON.stringify(pathToFileURL(path.join(root, 'output.mjs')).href)}); } catch (error) { exactFailure = error === failure; }`,
            'process.stdout.write(JSON.stringify({ events, exactFailure }));'
        ].join('\n')], { encoding: 'utf8' }));
        assert.deepEqual(observed, kind === 'failure'
            ? { events: ['dependency', 'object', 'array'], exactFailure: true }
            : { events: ['dependency', 'object', 'array', 'function', 'z-authored', 'a-authored', 'body'], exactFailure: false });
        importProofCases = [...importProofCases, result.code];
    }
} finally {
    await rm(directory, { recursive: true, force: true });
}

export { importProofCases };
