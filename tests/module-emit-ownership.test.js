import { deepStrictEqual, strictEqual, throws } from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';

import typescript from 'typescript';

import { createTypeScriptEmitTransformer } from 'eslint-plugin-resilient/typescript';

import { put } from './support/collections.js';

const createFixture = (context, target, keyword = 'using') => {
    const directory = mkdtempSync(join(tmpdir(), 'resilient-emit-ownership-'));
    const entries = [
        ['valid', 'export const read=(value:number)=>value+1;'],
        ['resource', 'export const events:string[]=[];const resource={[Symbol.dispose](){events.push("disposed");}};'
            + `${keyword} retained=resource;export const value=42;`]
    ];

    context.after(() => rmSync(directory, { recursive: true, force: true }));
    entries.forEach(([name = '', code = ''] = []) => writeFileSync(join(directory, `${name}.ts`), code));
    const fileNames = entries.map(([name = ''] = []) => join(directory, `${name}.ts`));
    const program = typescript.createProgram(fileNames, {
        target, module: typescript.ModuleKind.ESNext, lib: ['lib.esnext.d.ts'], strict: true
    });

    deepStrictEqual(program.getSyntacticDiagnostics(), []);

    return { directory, fileNames, program };
};
const editReports = reports => runInNewContext(`
    for (const result of reports.results) {
        result.diagnostics.splice(0, result.diagnostics.length,
            ...(result.diagnostics.length ? [] : [{kind:'CallerDiagnostic',text:'caller note'}]));
        result.code='caller replacement';
        result.fileName='another-file.ts';
        result.agreements.splice(0);
    }
    reports.diagnostics.splice(0);
`, { reports });

[typescript.ScriptTarget.ES2016, typescript.ScriptTarget.ESNext].forEach(target => [false, true].forEach(reverse => [false, true].forEach(warm => (
    test(`prepared emission owns its decision after caller report edits: ${target}/${reverse}/${warm}`, (context) => {
        const { fileNames = [], program = {} } = createFixture(context, target);
        const emit = createTypeScriptEmitTransformer({ typescript, program });
        const order = reverse ? fileNames.toReversed() : fileNames;
        const reports = emit.prepare({ fileNames: order });
        const expected = new Map(reports.results.map(({ fileName = '', code = '', diagnostics = [] } = {}) => (
            [fileName, { code, rejected: Boolean(diagnostics.length) }]
        )));
        const check = files => files.forEach((fileName) => {
            const source = program.getSourceFile(fileName);
            const { code = '', rejected = false } = expected.get(fileName);
            const result = emit.before()(source);

            if (rejected) {
                strictEqual(result === source, true);

                return;
            }

            strictEqual(result.getFullText(), code);
        });

        strictEqual(reports.diagnostics.length, 1);

        if (warm) check(order);

        editReports(reports);
        check(order.toReversed());
        const repeated = emit.prepare({ fileNames: order.toReversed() });

        strictEqual(repeated.diagnostics.length, 1);
        repeated.results.forEach(({ fileName = '', code = '', diagnostics = [] } = {}) => {
            deepStrictEqual({ code, rejected: Boolean(diagnostics.length) }, expected.get(fileName));
        });
        editReports(repeated);
        check(order);
    })
))));

['using', 'await using'].forEach(keyword => test(`edited rejected reports preserve native ${keyword} emission and cleanup`, (context) => {
    const { directory = '', fileNames = [], program = {} } = createFixture(context, typescript.ScriptTarget.ES2016, keyword);
    const fileName = fileNames.at(1);
    const source = program.getSourceFile(fileName);
    const emit = createTypeScriptEmitTransformer({ typescript, program });
    const reports = emit.prepare({ fileNames });

    editReports(reports);
    const render = (customTransformers = {}) => {
        const output = new Map();
        const { emitSkipped = true, diagnostics = [] } = program.emit(source, (name, text) => put(output, name, text), {
            isCancellationRequested: () => false, throwIfCancellationRequested: () => false
        }, false, customTransformers);

        strictEqual(emitSkipped, false);
        deepStrictEqual(diagnostics, []);
        strictEqual(output.size, 1);

        return [...output.values()].at(0);
    };
    const native = render();
    const { before = false } = emit;
    const prepared = render({ before: [before] });

    strictEqual(prepared, native);
    writeFileSync(join(directory, 'emitted.mjs'), prepared);
    const { href = '' } = pathToFileURL(join(directory, 'emitted.mjs'));
    const observed = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e',
        `const {value,events}=await import(${JSON.stringify(href)});process.stdout.write(JSON.stringify({value,events}));`
    ], { encoding: 'utf8', timeout: 30000 }));

    deepStrictEqual(observed, { value: 42, events: ['disposed'] });
}));

test('interrupted re-preparation retains its completed decision and retries independently of edited reports', (context) => {
    const { fileNames = [], program = {} } = createFixture(context, typescript.ScriptTarget.ES2016);
    const mode = new Map();
    const failure = new Error('interrupted compiler emission');
    const compiler = { ...typescript, transpileModule: (input, options) => {
        if (mode.get('fail')) throw failure;

        return typescript.transpileModule(input, options);
    } };
    const emit = createTypeScriptEmitTransformer({ typescript: compiler, program });
    const fileName = fileNames.at(0);
    const source = program.getSourceFile(fileName);
    const reports = emit.prepare({ fileNames: [fileName] });
    const { results: [{ code = '' } = {}] = [] } = reports;

    editReports(reports);
    put(mode, 'fail', true);
    throws(() => emit.prepare({ fileNames: [fileName] }), error => error === failure);
    strictEqual(emit.before()(source).getFullText(), code);
    put(mode, 'fail', false);
    const { results: [{ code: repeated = '', diagnostics = [] } = {}] = [] } = emit.prepare({ fileNames: [fileName] });

    strictEqual(repeated, code);
    deepStrictEqual(diagnostics, []);
    strictEqual(emit.before()(source).getFullText(), code);
});
