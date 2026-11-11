import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import typescript from 'typescript';

import { createTypeScriptTransformer } from 'eslint-plugin-resilient/typescript';

import { put } from './support/collections.js';

const directoryFor = (context) => {
    mkdirSync(new URL('../.artifacts/', import.meta.url), { recursive: true });
    const directory = mkdtempSync(new URL('../.artifacts/project-requests-', import.meta.url));

    context.after(() => rmSync(directory, { recursive: true, force: true }));
    mkdirSync(join(directory, 'node_modules'));
    symlinkSync(fileURLToPath(new URL('.', import.meta.resolve('eslint-plugin-resilient'))), join(directory, 'node_modules/eslint-plugin-resilient'), 'dir');

    writeFileSync(join(directory, 'eslint.config.js'), `import production from 'eslint-plugin-resilient/production';export default production({cwd:${JSON.stringify(directory)}});`);

    return directory;
};
const binary = fileURLToPath(new URL('./scripts/lower-typescript-project.js', import.meta.resolve('eslint-plugin-resilient')));
const observe = directory => JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e',
    `const {events}=await import(${JSON.stringify(pathToFileURL(join(directory, 'state.js')).href)});`
    + `const {answer}=await import(${JSON.stringify(pathToFileURL(join(directory, 'main.js')).href)});`
    + 'process.stdout.write(JSON.stringify({answer,events}));'
], { encoding: 'utf8', timeout: 30000 }));
const run = (directory, flags = []) => {
    const { status = -1, stdout = '', stderr = '' } = spawnSync(process.execPath, [binary,
        '--project', directory, '--outDir', join(directory, 'output'), '--emit', 'src/main.ts', '--eslint-config', join(directory, 'eslint.config.js'), ...flags
    ], { cwd: directory, encoding: 'utf8', timeout: 60000 });

    strictEqual(status, 0, stdout + stderr);

    return stdout;
};
const requests = (code) => {
    const source = typescript.createSourceFile('main.js', code, typescript.ScriptTarget.Latest, true);

    return source.statements.filter(node => typescript.isImportDeclaration(node) || typescript.isExportDeclaration(node))
        .flatMap(({ moduleSpecifier: { text = '' } = {} } = {}) => text ? [text] : []);
};
const forms = [
    ['empty-import', 'import {} from "@/empty-import";'],
    ['inline-import', 'import {type Marker} from "@/inline-import";'],
    ['inline-export', 'export {type Marker} from "@/inline-export";'],
    ['empty-export', 'export {} from "@/empty-export";'],
    ['whole-import', 'import type {Marker as Erased} from "@/whole-import";'],
    ['whole-export', 'export type {Marker} from "@/whole-export";'],
    ['value', 'import {value,type Marker as ValueMarker} from "@/value";']
];
[
    ['ESNext', 'Bundler'], ['ES2022', 'Bundler'], ['NodeNext', 'NodeNext']
].forEach(([module = '', moduleResolution = ''] = []) => ['ES2016', 'ESNext'].forEach(target => [false, true].forEach(verbatimModuleSyntax => (
    test(`project runtime closure matches emitted requests: ${module}/${target}/${verbatimModuleSyntax}`, (context) => {
        const directory = directoryFor(context);
        ['src', 'native', 'direct'].forEach(name => mkdirSync(join(directory, name)));
        writeFileSync(join(directory, 'package.json'), '{"type":"module"}');
        writeFileSync(join(directory, 'tsconfig.json'), JSON.stringify({ compilerOptions: {
            module, moduleResolution, target, verbatimModuleSyntax, rootDir: 'src', paths: { '@/*': ['./src/*.ts'] }
        }, include: ['src/**/*.ts'] }));
        const source = forms.map(([, statement = ''] = []) => statement).join('\n') + '\nexport const answer=value;';
        const entries = [['state', 'export const events:string[]=[];'], ['main', source], ...forms.map(([name = ''] = []) => [name,
            `import {events} from "./state.js";events.push("${name}");export const value=42;export interface Marker{value:number;}`
        ])];
        entries.forEach(([name = '', code = ''] = []) => writeFileSync(join(directory, 'src', name + '.ts'), code));
        const options = { target: typescript.ScriptTarget[target], module: typescript.ModuleKind[module],
            moduleResolution: typescript.ModuleResolutionKind[moduleResolution], verbatimModuleSyntax, paths: { '@/*': [join(directory, 'src/*.ts')] } };
        const program = typescript.createProgram(entries.map(([name = ''] = []) => join(directory, 'src', name + '.ts')), options);
        const transformer = createTypeScriptTransformer({ typescript, program });
        const nativeFiles = new Map();

        program.emit(undefined, (fileName, text) => put(nativeFiles, basename(fileName), text));
        const nativeMain = nativeFiles.get('main.js');
        const expectedRequests = requests(nativeMain);
        const expectedFiles = ['main', 'state', ...expectedRequests.map(name => name.slice(2))].map(name => name + '.ts').toSorted();
        const { selectedSources = [], runtimeRoutes = [] } = JSON.parse(run(directory, ['--inspect']));

        deepStrictEqual(selectedSources.map(file => basename(file)).toSorted(), expectedFiles);
        deepStrictEqual(runtimeRoutes.filter(({ importer = '' } = {}) => basename(importer) === 'main.ts').map(({ specifier = '' } = {}) => specifier), expectedRequests);
        strictEqual(existsSync(join(directory, 'output')), false);
        entries.forEach(([name = '', code = ''] = []) => {
            const native = nativeFiles.get(name + '.js');
            const { code: direct = '', diagnostics = [] } = transformer.transform({ code, fileName: join(directory, 'src', name + '.ts') });

            deepStrictEqual(diagnostics, []);
            [['native', native], ['direct', direct]].forEach(([variant = '', text = ''] = []) => (
                writeFileSync(join(directory, variant, name + '.js'), text.replaceAll(/@\/([a-z-]+)/gu, './$1.js'))
            ));
        });
        const expected = { answer: 42, events: verbatimModuleSyntax ? ['empty-import', 'inline-import', 'inline-export', 'empty-export', 'value'] : ['value'] };

        deepStrictEqual(observe(join(directory, 'native')), expected);
        deepStrictEqual(observe(join(directory, 'direct')), expected);
        [[], ['--fix']].forEach((flags) => {
            run(directory, flags);
            deepStrictEqual(readdirSync(join(directory, 'output')).toSorted(), expectedFiles.map(name => name.replace('.ts', '.js')));
            deepStrictEqual(observe(join(directory, 'output')), expected);
            deepStrictEqual(requests(readFileSync(join(directory, 'output/main.js'), 'utf8')).filter(name => name.startsWith('.')), expectedRequests.map(name => name.replace('@/', './') + '.js'));
        });
    })
))));

[false, true].forEach(verbatimModuleSyntax => test(`provider discovers retained inline-type dependency closure: ${verbatimModuleSyntax}`, (context) => {
    const directory = directoryFor(context);
    mkdirSync(join(directory, 'src'));
    writeFileSync(join(directory, 'package.json'), '{"type":"module"}');
    writeFileSync(join(directory, 'tsconfig.json'), JSON.stringify({ compilerOptions: {
        target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', verbatimModuleSyntax, rootDir: 'src'
    }, include: ['src/**/*.ts'] }));
    writeFileSync(join(directory, 'resilient.project.json'), '{"schemaVersion":2,"provider":"./provider.js"}');
    writeFileSync(join(directory, 'provider.js'), 'export default {schemaVersion:1,resolveImport:({specifier})=>'
        + 'specifier.startsWith("custom:")?{kind:"source",source:"src/"+specifier.slice(7)+".ts"}:null};');
    writeFileSync(join(directory, 'src/main.ts'), 'import {type Marker} from "custom:dependency";import {events} from "./state.js";export const answer=42;');
    writeFileSync(join(directory, 'src/dependency.ts'), 'import "custom:tail";export interface Marker{}');
    writeFileSync(join(directory, 'src/tail.ts'), 'import {events} from "./state.js";events.push("tail");');
    writeFileSync(join(directory, 'src/state.ts'), 'export const events:string[]=[];');
    const { selectedSources = [] } = JSON.parse(run(directory, ['--inspect']));
    const expectedFiles = (verbatimModuleSyntax ? ['dependency', 'main', 'state', 'tail'] : ['main', 'state']).map(name => name + '.ts');

    deepStrictEqual(selectedSources.map(file => basename(file)).toSorted(), expectedFiles);
    run(directory);
    deepStrictEqual(observe(join(directory, 'output')), { answer: 42, events: verbatimModuleSyntax ? ['tail'] : [] });
}));
