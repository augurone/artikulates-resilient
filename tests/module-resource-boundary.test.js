import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import typescript from 'typescript';

import { createTypeScriptTransformer } from 'eslint-plugin-resilient/typescript';

const reason = 'using and await using require resource disposal lowering';
const leaf = 'export const events:string[]=[];export const resource={[Symbol.dispose](){events.push("disposed");}};export default resource;';
const prepare = (context, code, ownsProgram, target) => {
    const directory = mkdtempSync(join(tmpdir(), 'resilient-resource-boundary-'));
    const fileName = join(directory, 'main.ts');
    const options = { strict: true, target, module: typescript.ModuleKind.ESNext, lib: ['lib.esnext.d.ts'] };

    context.after(() => rmSync(directory, { recursive: true, force: true }));
    writeFileSync(join(directory, 'package.json'), '{"type":"module"}\n');
    writeFileSync(join(directory, 'leaf.ts'), leaf);
    writeFileSync(fileName, code);
    const program = typescript.createProgram([fileName, join(directory, 'leaf.ts')], options);

    deepStrictEqual(program.getSyntacticDiagnostics(), []);
    const transformer = createTypeScriptTransformer({ typescript, target, ...(ownsProgram ? { program } : {}) });

    return { directory, fileName, options, transformer };
};
const bodies = [
    ['module', 'using resource=api.resource;export const value=42;'],
    ['function', 'export const run=()=>{using resource=api.resource;return 42;};'],
    ['nested block', 'export const run=()=>{{using resource=api.resource;}return 42;};'],
    ['await using', 'export const run=async()=>{await using resource=api.resource;return 42;};'],
    ['loop', 'export const run=()=>{for(using resource of [api.resource]){}return 42;};'],
    ['local alias', 'const selected=api.resource;export const run=()=>{using resource=selected;return 42;};'],
    ['default export', 'export const run=()=>{using resource=api.default;return 42;};']
];
bodies.forEach(([name = '', body = ''] = []) => [false, true].forEach(ownsProgram => [
    typescript.ScriptTarget.ES2016, typescript.ScriptTarget.ESNext
].forEach(target => test(`resource admission retains its unsupported boundary: ${name}/${ownsProgram}/${target}`, (context) => {
    const code = 'import *as api from "./leaf.js";' + body;
    const { fileName = '', transformer = {} } = prepare(context, code, ownsProgram, target);
    const expected = [{ fileName, kind: 'UnsupportedDeclaration', text: reason }];
    const { diagnostics: analyzed = [] } = transformer.analyze({ code, fileName });

    deepStrictEqual(analyzed, expected);
    const first = transformer.transform({ code, fileName });
    const second = transformer.transform({ code, fileName });
    const { diagnostics: transformed = [], code: output = '' } = first;

    deepStrictEqual(transformed, expected);
    strictEqual(output, '');
    deepStrictEqual(second, first);
    deepStrictEqual(transformer.analyze({ code, fileName }).diagnostics, expected);
}))));

['using', 'await using'].forEach(keyword => test(`native ${keyword} witness performs cleanup before the result is observed`, (context) => {
    const asyncKeyword = keyword === 'await using' ? 'async' : '';
    const code = 'import *as api from "./leaf.js";export const run=' + asyncKeyword + '()=>{' + keyword + ' resource=api.resource;return 42;};';
    const { directory = '', fileName = '', options = {}, transformer = {} } = prepare(context, code, true, typescript.ScriptTarget.ES2016);
    const native = join(directory, 'native');

    mkdirSync(native);
    [['leaf', leaf], ['main', code]].forEach(([name = '', source = ''] = []) => {
        const { outputText = '' } = typescript.transpileModule(source, { compilerOptions: options });

        writeFileSync(join(native, name + '.js'), outputText);
    });
    const { href: base = '' } = pathToFileURL(native + '/');
    const observed = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e',
        `const base=${JSON.stringify(base)};const {run}=await import(new URL('main.js',base));const value=await run();`
        + "const {events}=await import(new URL('leaf.js',base));process.stdout.write(JSON.stringify({value,events}));"
    ], { encoding: 'utf8', timeout: 30000 }));

    deepStrictEqual(observed, { value: 42, events: ['disposed'] });
    deepStrictEqual(transformer.transform({ code, fileName }).diagnostics, [{ fileName, kind: 'UnsupportedDeclaration', text: reason }]);
}));

['const', 'let', 'var'].forEach(kind => test(`ordinary ${kind} declaration is not a resource boundary`, (context) => {
    const code = `export const run=()=>{${kind} using=42;return using;};`;
    const { fileName = '', transformer = {} } = prepare(context, code, true, typescript.ScriptTarget.ES2016);
    const { code: output = '', diagnostics = [] } = transformer.transform({ code, fileName });

    deepStrictEqual(diagnostics, []);
    strictEqual(output.includes('42'), true);
}));

test('resource rejection leaves previously published project output intact', (context) => {
    const { directory = '', fileName = '' } = prepare(context, 'export const value=42;', true, typescript.ScriptTarget.ES2022);
    const output = join(directory, 'output');
    const entry = fileURLToPath(new URL('./scripts/lower-typescript-project.js', import.meta.resolve('eslint-plugin-resilient')));
    const command = [entry, '--project', directory, '--outDir', output];

    writeFileSync(join(directory, 'tsconfig.json'), JSON.stringify({ compilerOptions: {
        target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', lib: ['ESNext'], strict: true
    }, include: ['main.ts', 'leaf.ts'] }));
    const { status = -1, stderr = '' } = spawnSync(process.execPath, command, { cwd: directory, encoding: 'utf8', timeout: 30000 });

    strictEqual(status, 0, stderr);
    const before = readFileSync(join(output, 'main.js'), 'utf8');

    writeFileSync(fileName, 'import *as api from "./leaf.js";export const run=()=>{using resource=api.resource;return 42;};');
    const { status: rejected = 0, stderr: failure = '', stdout = '' } = spawnSync(process.execPath, command, {
        cwd: directory, encoding: 'utf8', timeout: 30000
    });

    strictEqual(rejected, 1, failure);
    strictEqual((stdout + failure).includes(reason), true, stdout + failure);
    strictEqual(readFileSync(join(output, 'main.js'), 'utf8'), before);
});
