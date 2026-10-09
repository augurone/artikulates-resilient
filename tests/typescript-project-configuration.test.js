import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { prepareProject } from '../integrations/typescript-project.js';
import { runLowering } from '../scripts/lower-typescript-project.js';

const root = await mkdtemp(path.join(tmpdir(), 'resilient-project-config-'));
const config = path.join(root, 'tsconfig.resilient.json');
const baseline = fileURLToPath(new URL('../config/typescript-lowering.json', import.meta.url));
const source = path.join(root, 'src');
const output = path.join(root, 'cli-output');
const writeConfig = async (extra = {}) => writeFile(config, JSON.stringify({
    extends: baseline,
    include: ['src/**/*.ts'],
    ...extra
}));
const rejectConfig = async (extra, marker) => {
    await writeConfig(extra);
    assert.throws(() => prepareProject({ project: config, outDir: output, cwd: root }), marker);
};

try {
    await writeFile(path.join(root, 'package.json'), '{"type":"module"}\n');
    await mkdir(source);
    await writeFile(path.join(source, 'entry.ts'), 'export const value = 42;\n');
    await writeFile(path.join(source, 'provider.ts'), 'export type Provider = number;\n');
    await writeFile(path.join(source, 'ambient.d.ts'), 'declare const external: number;\n');
    await writeConfig({ resilient: { emit: ['src/entry.ts'] } });
    const selected = prepareProject({ project: config, cwd: root });

    assert.equal(selected.compilerOptions.target, selected.program.getCompilerOptions().target);
    assert.deepEqual(selected.destinations.map(({ relative = '' } = {}) => relative), ['src/entry.js']);
    assert.equal(selected.checkerInputs.some(({ fileName = '' } = {}) => fileName.endsWith('provider.ts')), true);
    assert.equal((await runLowering({ project: config, cwd: root, write: () => {} })).ok, true);
    await access(path.join(root, '.resilient', 'src', 'entry.js'));
    await assert.rejects(access(path.join(root, '.resilient', 'provider.js')));

    await writeConfig({ compilerOptions: { outDir: 'configured-output' } });
    assert.equal(prepareProject({ project: config, cwd: root }).resolvedOutDir, path.join(root, 'configured-output'));
    assert.equal(prepareProject({ project: config, cwd: root, outDir: output }).resolvedOutDir, output);
    assert.equal((await runLowering({ project: config, cwd: root, write: () => {} })).ok, true);
    await access(path.join(root, 'configured-output', 'src', 'entry.js'));

    await writeFile(path.join(root, 'base.json'), JSON.stringify({
        extends: baseline,
        compilerOptions: { outDir: 'inherited-output' },
        resilient: { emit: ['src/entry.ts'] }
    }));
    await writeFile(config, JSON.stringify({ extends: './base.json', include: ['src/**/*.ts'] }));
    assert.equal(prepareProject({ project: config, cwd: root }).resolvedOutDir, path.join(root, '.resilient'));
    assert.deepEqual(prepareProject({ project: config, cwd: root }).destinations.map(({ relative = '' } = {}) => relative),
        ['src/entry.js', 'src/provider.js']);
    await writeConfig({ compilerOptions: { skipLibCheck: false } });
    const { compilerOptions: overrideOptions = {} } = prepareProject({ project: config, cwd: root });

    assert.equal(Reflect.get(overrideOptions, 'skipLibCheck'), false);

    await writeConfig({ compilerOptions: { target: 'ES2020' } });
    const { compilerOptions: targetOptions = {} } = prepareProject({ project: config, outDir: output, cwd: root });
    const { target: selectedTarget = 0 } = targetOptions;

    assert.equal(selectedTarget, 7);
    await rejectConfig({ compilerOptions: { module: 'AMD', moduleResolution: 'Node10' } },
        /Unsupported lowering compiler configuration/u);
    // eslint-disable-next-line resilient/prefer-prototype-methods -- Each case rewrites the same config file, so validation must be sequential.
    for (const resilient of [null, [], 'emit', { typo: true }, { emit: 'src/*.ts' },
        { emit: [''] }, { standard: null }, { standard: { object: '' } }, { standard: { other: 'x' } }]) {
        await rejectConfig({ resilient }, /resilient|helper binding/u);
    }
    await rejectConfig({ resilient: { emit: ['src/*.d.ts'] } }, /matched no/u);
    assert.match(await readFile(path.join(root, '.resilient', 'src', 'entry.js'), 'utf8'), /export const value/u);
} finally {
    await rm(root, { recursive: true, force: true });
}
