import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readlinkSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import typescript from 'typescript';

import { createTypeScriptTransformer } from 'eslint-plugin-resilient/typescript';

import { writeJsonReport as writeJson } from './json-report.js';
import { readText as read, digest } from './proof-files.js';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const getExportedFunctions = (code = '') => {
    const {
        ScriptTarget: { ESNext = 0 } = {},
        SyntaxKind: {
            ArrowFunction = 0,
            ExportKeyword = 0,
            FunctionExpression = 0
        } = {}
    } = typescript;
    const { statements = [] } = typescript.createSourceFile('runtime.js', code, ESNext, true);

    const isModelConstructor = (body = []) => body.some(({
        declarationList: { declarations = [] } = {}
    } = {}) => declarations.some(({
        name = {}, initializer = {}
    } = {}) => {
        const { elements = [] } = name;
        const {
            condition = {}, whenTrue = {}, whenFalse = {}
        } = initializer;
        const {
            expression = {}, arguments: args = []
        } = condition;
        const [input = {}] = args;
        const { escapedText: calleeName = '' } = expression;
        const { escapedText: inputName = '' } = input;
        const { escapedText: trueName = '' } = whenTrue;
        const directStage = typescript.isObjectBindingPattern(name) &&
            typescript.isConditionalExpression(initializer) &&
            typescript.isCallExpression(condition) && calleeName === 'isObject' &&
            inputName === 'input' && trueName === 'input' && typescript.isObjectLiteralExpression(whenFalse);
        const hasAttrs = elements.some(({
            dotDotDotToken = false,
            name: { text = '' } = {}
        } = {}) => dotDotDotToken && text === 'attrs');

        return directStage || hasAttrs;
    }));

    return statements.flatMap(({
        kind = 0,
        modifiers = [],
        name: { text: functionName = '' } = {},
        body: { statements: functionBody = [] } = {},
        declarationList: { declarations = [] } = {}
    } = {}) => {
        if (!modifiers.some(({ kind = 0 } = {}) => kind === ExportKeyword)) return [];

        if (kind === typescript.SyntaxKind.FunctionDeclaration) {
            const model = isModelConstructor(functionBody);
            const falsifies = model && functionBody.some(statement => typescript.isIfStatement(statement));

            return [{
                name: functionName,
                resolver: !model && functionBody.some(statement => typescript.isIfStatement(statement)),
                falsifies
            }];
        }

        return declarations.flatMap(({
            name = {},
            initializer = {}
        } = {}) => {
            // A destructured re-export is executable grammar, but it is not a
            // generated helper declaration. Its binding pattern has no single
            // export name, so treating it as one produces an invalid `api['']`
            // proof lookup.
            const {
                kind: initializerKind = 0,
                body: { statements: body = [] } = {}
            } = initializer;

            if (!typescript.isIdentifier(name) ||
                ![ArrowFunction, FunctionExpression].includes(initializerKind)) return [];

            const { text = '' } = name;

            const model = isModelConstructor(body);
            const falsifies = model && body.some(statement => typescript.isIfStatement(statement));

            return [{
                name: text,
                resolver: !model && body.some(statement => typescript.isIfStatement(statement)),
                falsifies
            }];
        });
    });
};

const createSourceGenerator = ({ checkout = '', sources = [], tests = [], standardRoot = repository,
    createTransformer = createTypeScriptTransformer } = {}) => {
    const rootNames = [
        ...sources.map(name => path.join(checkout, 'src', name)),
        ...tests.map(name => path.join(checkout, 'test', name))
    ];
    const {
        ModuleKind: { NodeNext: module = 0 } = {},
        ModuleResolutionKind: { NodeNext: moduleResolution = 0 } = {},
        ScriptTarget: { ESNext: target = 0 } = {}
    } = typescript;
    const program = typescript.createProgram(rootNames, {
        module,
        moduleResolution,
        target,
        skipLibCheck: true
    });
    const transformer = createTransformer({
        typescript,
        program,
        standard: {
            object: path.join(standardRoot, 'rules/support/object.js'),
            array: path.join(standardRoot, 'rules/support/array.js'),
            function: path.join(standardRoot, 'rules/support/function.js')
        }
    });

    return (name = '', { destination = '', baselineDestination = '' } = {}) => {
        const javascript = path.join(destination, 'js');
        const baselineJavascript = path.join(baselineDestination, 'js');
        mkdirSync(javascript, { recursive: true });
        mkdirSync(baselineJavascript, { recursive: true });
        const fileName = path.join(checkout, 'src', name);
        const { code = '', diagnostics = [], agreements = [] } = transformer.transform({ code: read(fileName), fileName });

        if (diagnostics.length) throw new Error(`${name}: ${JSON.stringify(diagnostics)}`);

        const output = path.join(destination, 'src', name);
        mkdirSync(path.dirname(output), { recursive: true });
        writeFileSync(output, code);
        const javascriptOutput = path.join(javascript, name.replace(/\.ts$/, '.js'));
        writeFileSync(javascriptOutput, code);
        const { ModuleKind: { ESNext = 0 } = {} } = typescript;
        const { outputText = '' } = typescript.transpileModule(read(fileName), { compilerOptions: { module: ESNext, target } });
        const baselineOutput = path.join(baselineJavascript, name.replace(/\.ts$/, '.js'));
        writeFileSync(baselineOutput, outputText);
        const originalNames = new Set(getExportedFunctions(outputText).map(({ name: exportName = '' } = {}) => exportName));
        const helpers = getExportedFunctions(code).filter(({ name: exportName = '' } = {}) => !originalNames.has(exportName));

        return {
            file: name,
            source: digest(fileName),
            generated: digest(output),
            agreements,
            baselineJavascript: digest(baselineOutput),
            javascript: digest(javascriptOutput),
            helpers
        };
    };
};
const generateSources = ({ checkout = '', destination = '', baselineDestination = '', sources = [], tests = [] } = {}) => {
    const generate = createSourceGenerator({ checkout, sources, tests });

    return sources.map(name => generate(name, { destination, baselineDestination }));
};

const transpileRuntimeProof = ({ file = '', destination = '' } = {}) => {
    const { ModuleKind: { ESNext = 0 } = {}, ScriptTarget: { ESNext: target = 0 } = {} } = typescript;
    const runtimeSource = read(file)
        .replaceAll('modules[`../src/${file}`]', 'modules[`../js/${file.replace(/\\.ts$/, \'.js\')}`]')
        .replaceAll('../src/*.ts', '../js/*.js')
        .replace(/(['"])\.\.\/src\/([^'"]+)\.ts/g, '$1../js/$2.js')
        .replaceAll('../src/', '../js/');
    const { outputText = '' } = typescript.transpileModule(runtimeSource, {
        compilerOptions: { module: ESNext, target }
    });
    writeFileSync(destination, outputText);
};

const prepareMirror = ({ checkout = '', destination = '', sources = [], tests = [] } = {}) => {
    ['src', 'test', 'proof'].forEach(directory => mkdirSync(path.join(destination, directory), { recursive: true }));
    const modules = path.join(destination, 'node_modules');
    const target = path.join(checkout, 'node_modules');

    if (existsSync(modules) && readlinkSync(modules) !== target) {
        throw new Error(`Runtime dependency binding changed: ${modules}`);
    }

    if (!existsSync(modules)) symlinkSync(target, modules, 'dir');

    writeJson(path.join(destination, 'package.json'), { private: true, type: 'module' });
    sources.forEach(name => copyFileSync(path.join(checkout, 'src', name), path.join(destination, 'src', name)));
    tests.forEach((name) => {
        const original = path.join(checkout, 'test', name);
        const copy = path.join(destination, 'test', name);
        copyFileSync(original, copy);

        if (digest(original) !== digest(copy)) throw new Error(`Test copy changed: ${name}`);
    });
    transpileRuntimeProof({
        file: path.join(repository, 'tests/fixtures/fp-ts/coverage.ts'),
        destination: path.join(destination, 'proof/coverage.js')
    });
    const config = {
        root: destination,
        cacheDir: path.join(destination, 'cache/vite'),
        resolve: {
            alias: {
                '../src': path.join(destination, 'js')
            }
        },
        test: {
            include: ['test/**/*.ts', 'proof/**/*.js'],
            exclude: ['test/util.ts'],
            globals: true,
            coverage: {
                enabled: true,
                provider: 'istanbul',
                all: true,
                include: ['js/**/*.js'],
                exclude: [],
                reporter: ['json', 'json-summary', 'text-summary', 'html'],
                reportsDirectory: path.join(destination, 'coverage')
            }
        }
    };
    writeFileSync(path.join(destination, 'vitest.config.mjs'), `export default ${JSON.stringify(config, null, 2)};\n`);
};

const runTests = (destination = '') => {
    execFileSync(process.execPath, [
        path.join(destination, 'node_modules/vitest/vitest.mjs'),
        'run', '--config', path.join(destination, 'vitest.config.mjs'),
        '--reporter=json', `--outputFile=${path.join(destination, 'tests.json')}`
    ], { cwd: destination, stdio: 'inherit' });
    const { success = false, numTotalTests = 0, numPassedTests = 0, numFailedTests = 0, numPendingTests = 0, testResults = [] } = JSON.parse(read(path.join(destination, 'tests.json')));

    if (!success || numFailedTests || numPendingTests) throw new Error(`Incomplete runtime proof: ${destination}`);

    const { total = {} } = JSON.parse(read(path.join(destination, 'coverage/coverage-summary.json')));

    return { tests: numTotalTests, passed: numPassedTests, failed: numFailedTests, skipped: numPendingTests, files: testResults.length, coverage: total };
};

export { createSourceGenerator, generateSources, prepareMirror, transpileRuntimeProof, runTests };
