import { resolve } from 'node:path';

import typescript from 'typescript';

import { createTypeScriptAnalysis } from 'eslint-plugin-resilient/analyzer/typescript';

const declaration = 'function outer([value]: [number]) { return [value]; }';
export const fixture = (sourceText = declaration, { filename = resolve('compiler-tuple.ts'), revision = 'source-1', programRevision = 'program-1' } = {}) => {
    const options = { target: typescript.ScriptTarget.ESNext, module: typescript.ModuleKind.ESNext, noLib: true };
    const { target = 99 } = options;
    const sourceFile = typescript.createSourceFile(filename, sourceText, target, true);
    const host = typescript.createCompilerHost(options);
    const program = typescript.createProgram([filename], options, { ...host,
        getSourceFile: name => name === filename ? sourceFile : host.getSourceFile(name, target) });

    return { typescript, sourceFile, sourceText, filename, revision, programRevision, compilerOptionsIdentity: JSON.stringify(options), program };
};
export const analyze = (sourceText = declaration, options = {}) => createTypeScriptAnalysis(fixture(sourceText, options));
export const tuple = (analysis, options = {}) => analysis.checkTuple({ index: 0, ...options });
export const firstCall = (analysis, options = {}) => {
    const { calls: [call = {}] = [] } = tuple(analysis, options);

    return call;
};
