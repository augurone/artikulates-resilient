import { deepStrictEqual, ok } from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

export const assertCompilerCollection = (sourceText = '') => {
    const { execPath = '' } = process;
    const source = `
        import ts from 'typescript';
        import { createTypeScriptAnalysis } from 'eslint-plugin-resilient/analyzer/typescript';
        const acquire = () => {
            const code = ${JSON.stringify(sourceText)};
            const sourceFile = ts.createSourceFile('/retained.ts', code, 99, true);
            const options = { noLib: true, target: 99 };
            const host = ts.createCompilerHost(options);
            const program = ts.createProgram(['/retained.ts'], options, { ...host, getSourceFile: () => sourceFile });
            const checker = program.getTypeChecker();
            const refs = [program, checker];
            const visit = node => { refs.push(node); ts.forEachChild(node, visit); };
            visit(sourceFile);
            const analysis = createTypeScriptAnalysis({ typescript: ts, sourceFile, sourceText: code, filename: '/retained.ts',
                revision: '1', programRevision: '1', compilerOptionsIdentity: JSON.stringify(options), program });
            return { analysis, refs: refs.map(value => new WeakRef(value)) };
        };
        const { analysis, refs } = acquire();
        const collect = async () => { for (let count=0;count<8;count++) { await new Promise(setImmediate); globalThis.gc(); } };
        await collect();
        const before = refs.filter(ref => ref.deref()).length;
        const proof = analysis.checkTuple({ index: 0 });
        await collect();
        console.log(JSON.stringify({ count: refs.length, before, after: refs.filter(ref => ref.deref()).length,
            status: proof.calls[0].status, reused: proof === analysis.checkTuple({ index: 0 }) }));
    `;
    const { count = 0, ...result } = JSON.parse(execFileSync(execPath, ['--expose-gc', '--input-type=module', '-e', source], { encoding: 'utf8', timeout: 30000 }));

    ok(count >= 20);
    deepStrictEqual(result, { before: 0, after: 0, status: 'agreement', reused: true });
};
