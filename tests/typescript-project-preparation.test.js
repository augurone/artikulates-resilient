import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { planDestinations, prepareProject } from '../integrations/typescript-project.js';
import { runLowering } from '../scripts/lower-typescript-project.js';

const project = await mkdtemp(path.join(tmpdir(), 'resilient-project-preparation-'));
const source = path.join(project, 'src');
const config = path.join(project, 'tsconfig.json');
const output = path.join(project, 'generated');
let messages = [];
const write = (text) => { messages = [...messages, text]; };

try {
    await writeFile(path.join(project, 'package.json'), '{"type":"module"}\n');
    await mkdir(path.join(source, 'left'), { recursive: true });
    await mkdir(path.join(source, 'right'), { recursive: true });
    await writeFile(path.join(source, 'left', 'value.ts'), 'export const left = 1;\n');
    await writeFile(path.join(source, 'right', 'value.ts'), 'export const right = 2;\n');
    await writeFile(path.join(source, 'provider.ts'), 'export type Provider = number;\n');
    await writeFile(path.join(project, 'helper.js'), 'export const helper = true;\n');
    await writeFile(config, JSON.stringify({
        compilerOptions: { rootDir: './src', target: 'ESNext', module: 'NodeNext', moduleResolution: 'NodeNext' },
        include: ['src/**/*.ts'],
        resilient: { emit: ['src/left/value.ts', 'src/right/value.ts'], standard: { object: './helper.js' } }
    }));
    const prepared = prepareProject({ project: config, outDir: output, cwd: project });

    assert.deepEqual(prepared.destinations.map(({ relative = '' } = {}) => relative), ['left/value.js', 'right/value.js']);
    assert.equal(prepared.standard.object, path.join(project, 'helper.js'));
    assert.equal(prepared.checkerInputs.some(({ fileName = '' } = {}) => fileName.endsWith('provider.ts')), true);
    assert.equal((await runLowering({ project: config, outDir: output, cwd: project, write })).ok, true, messages.join(''));
    await access(path.join(output, 'left', 'value.js'));
    await access(path.join(output, 'right', 'value.js'));
    await assert.rejects(access(path.join(output, 'provider.js')));
    const retainedLeft = await readFile(path.join(output, 'left', 'value.js'), 'utf8');

    await writeFile(path.join(project, 'unowned.ts'), 'export const unowned = true;\n');
    await writeFile(config, JSON.stringify({
        compilerOptions: { rootDir: './src', target: 'ESNext', module: 'NodeNext', moduleResolution: 'NodeNext' },
        include: ['src/**/*.ts'], resilient: { emit: ['unowned.ts'] }
    }));
    assert.equal((await runLowering({ project: config, outDir: output, cwd: project, write })).ok, false);
    assert.match(messages.at(-1), /absent from the TypeScript program/u);
    assert.equal(await readFile(path.join(output, 'left', 'value.js'), 'utf8'), retainedLeft);
    assert.throws(() => planDestinations({
        files: [path.join(source, 'left', 'value.ts'), path.join(source, 'left', 'value.tsx')],
        root: source, outDir: output
    }), /destination collision/u);
    assert.throws(() => planDestinations({ files: [path.join(project, 'escape.ts')], root: source, outDir: output }),
        /Generated JavaScript must remain inside/u);
    assert.equal(await readFile(path.join(output, 'left', 'value.js'), 'utf8'), retainedLeft);

    await writeFile(config, JSON.stringify({
        compilerOptions: { rootDir: './src', target: 'ESNext', module: 'NodeNext', moduleResolution: 'NodeNext', emitDeclarationOnly: true }, include: ['src/**/*.ts']
    }));
    const unsupportedEmit = await runLowering({ project: config, outDir: output, cwd: project, write });
    assert.equal(unsupportedEmit.ok, false);
    assert.deepEqual(unsupportedEmit.diagnostics, []);
    assert.equal(await readFile(path.join(output, 'left', 'value.js'), 'utf8'), retainedLeft);

    await writeFile(path.join(source, 'broken.d.ts'), 'declare const broken: ;\n');
    await writeFile(config, JSON.stringify({ compilerOptions: { rootDir: './src', target: 'ESNext', module: 'NodeNext', moduleResolution: 'NodeNext' }, include: ['src/**/*.ts'] }));
    const declarationFailure = await runLowering({ project: config, outDir: output, cwd: project, write });
    assert.equal(declarationFailure.ok, false);
    assert.equal(Boolean(declarationFailure.diagnostics.length), true);
    assert.equal(await readFile(path.join(output, 'left', 'value.js'), 'utf8'), retainedLeft);
} finally {
    await rm(project, { recursive: true, force: true });
}
