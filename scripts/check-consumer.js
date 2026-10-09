import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packagePath = path.join(rootDirectory, 'package.json');
const read = filePath => fs.readFileSync(filePath, 'utf8');
const fail = (message) => {
    throw new Error(message);
};

const run = (command, args = [], cwd = rootDirectory) => execFileSync(command, args, {
    cwd,
    stdio: 'inherit'
});

const runCaptured = (command, args = [], cwd = rootDirectory) => execFileSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
});

const runExpectingFailure = ({ command = '', args = [], cwd = rootDirectory, marker = '' } = {}) => {
    try {
        runCaptured(command, args, cwd);
    } catch (error) {
        const {
            status = 0,
            stdout = '',
            stderr = ''
        } = error;
        const output = `${stdout}${stderr}`;

        if (!status) fail(`Consumer command failed without a process status: ${command}`);

        if (marker && !output.includes(marker)) {
            fail(`Consumer command output did not contain ${marker}: ${output}`);
        }

        return;
    }

    fail(`Consumer command unexpectedly passed: ${command}`);
};

const write = (directory, fileName, contents) => {
    fs.writeFileSync(path.join(directory, fileName), contents);
};

const getTarballPath = (directory = '') => {
    const [tarball = ''] = fs.readdirSync(directory)
        .filter(fileName => fileName.endsWith('.tgz'));

    if (!tarball) fail('npm pack did not create a consumer tarball.');

    return path.join(directory, tarball);
};

const createConsumerPackage = ({
    name = '',
    eslintRange = '',
    typescriptRange = '',
    tarballPath = ''
} = {}) => JSON.stringify({
    name: 'resilient-consumer-check',
    private: true,
    type: 'module',
    dependencies: {
        eslint: eslintRange,
        typescript: typescriptRange,
        [name]: `file:${tarballPath}`
    }
}, null, 2);

const createConfig = () => `import resilient from 'eslint-plugin-resilient';

export default [resilient.configs.recommended];
`;

const createContractProbe = () => `import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

import resilient from 'eslint-plugin-resilient';
import {
    getReturnDiagnostics,
    inferPattern
} from 'eslint-plugin-resilient/contracts';
import { createTypeScriptTransformer } from 'eslint-plugin-resilient/typescript';
import {
    getObject,
    hasContent,
    hasObjectValue,
    isObject,
    modelCheck
} from 'eslint-plugin-resilient/standard/object';
import {
    getArray,
    hasArrayContent,
    hasArrayValue,
    isArray,
    validArray
} from 'eslint-plugin-resilient/standard/array';
import {
    FUNCTION_TYPES,
    isFunction,
    isFunctionNode
} from 'eslint-plugin-resilient/standard/function';
import typescript from 'typescript';

assert.equal(resilient.meta.name, 'eslint-plugin-resilient');
assert.equal(resilient.meta.namespace, 'resilient');
assert.equal(typeof inferPattern, 'function');
assert.equal(typeof getReturnDiagnostics, 'function');
const project = resilient.imports({ aliases: { '@': 'src' } });
assert.equal(typeof project.settings.resilient.resolver, 'function');
assert.equal(typeof project.settings.resilient.roots, 'function');

const object = { value: 1 };
assert.equal(isObject(object), true);
assert.equal(isObject([]), false);
assert.equal(getObject(object), object);
assert.deepEqual(getObject([]), {});
assert.equal(hasContent(object), true);
assert.equal(hasObjectValue(object), true);
assert.equal(hasContent({}), false);
assert.equal(modelCheck('value', object), true);
assert.equal(modelCheck('missing', object), false);

const array = [1];
assert.equal(isArray(array), true);
assert.equal(isArray({}), false);
assert.equal(getArray(array), array);
assert.equal(validArray(array), array);
assert.deepEqual(getArray({}), []);
assert.equal(hasArrayContent(array), true);
assert.equal(hasArrayValue(array), true);
assert.equal(hasArrayContent([]), false);

assert.equal(FUNCTION_TYPES.has('ArrowFunctionExpression'), true);
assert.equal(isFunction(() => {}), true);
assert.equal(isFunction({}), false);
assert.equal(isFunctionNode({ type: 'ArrowFunctionExpression' }), true);
assert.equal(isFunctionNode({ type: 'CallExpression' }), false);

const { code = '', diagnostics = [] } = createTypeScriptTransformer({ typescript }).transform({
    code: 'export const increment = (value: number): number => value + 1;\\n',
    fileName: 'increment.ts'
});
assert.deepEqual(diagnostics, []);
assert.match(code, /export const increment/u);
assert.doesNotMatch(code, /:\\s*number/u);
await writeFile('transformed-output.mjs', code);
const { increment } = await import(new URL('./transformed-output.mjs', import.meta.url).href);
assert.equal(increment(41), 42);
`;

const main = () => {
    const {
        name = '',
        peerDependencies: { eslint: eslintRange = '' } = {},
        devDependencies: { typescript: typescriptRange = '' } = {}
    } = JSON.parse(read(packagePath));
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'resilient-consumer-'));
    const packageDirectory = path.join(temporaryDirectory, 'package');
    const tarballDirectory = path.join(temporaryDirectory, 'tarball');
    const cacheDirectory = path.join(temporaryDirectory, 'cache');

    fs.mkdirSync(packageDirectory);
    fs.mkdirSync(tarballDirectory);

    try {
        run('npm', [
            'pack',
            '--ignore-scripts',
            '--cache',
            cacheDirectory,
            '--pack-destination',
            tarballDirectory
        ]);

        const tarballPath = getTarballPath(tarballDirectory);
        write(packageDirectory, 'package.json', createConsumerPackage({
            name,
            eslintRange,
            typescriptRange,
            tarballPath
        }));
        write(packageDirectory, 'eslint.config.js', createConfig());
        write(packageDirectory, 'valid.js', 'const getTitle = ({ title = "" } = {}) => title;\nexport default getTitle;\n');
        write(packageDirectory, 'invalid.js', 'const getTitle = (options) => { const { title = "" } = options; return title; };\nexport default getTitle;\n');
        const measuredSource = '// eslint-disable-next-line no-undef -- External binding.\nexternal();\nmissing();\n';

        write(packageDirectory, 'measured.js', measuredSource);
        write(packageDirectory, 'contract-probe.mjs', createContractProbe());

        run('npm', [
            'install',
            '--ignore-scripts',
            '--no-audit',
            '--no-fund',
            '--package-lock=false',
            '--cache',
            cacheDirectory,
            '--fetch-timeout=30000',
            '--fetch-retries=1'
        ], packageDirectory);
        run('node', ['contract-probe.mjs'], packageDirectory);

        const eslintEntry = path.join('node_modules', 'eslint', 'bin', 'eslint.js');
        run('node', [eslintEntry, 'valid.js'], packageDirectory);
        runExpectingFailure({
            command: 'node',
            args: [eslintEntry, 'invalid.js'],
            cwd: packageDirectory,
            marker: 'resilient/'
        });

        const inspectEntry = path.join('node_modules', name, 'scripts', 'inspect-stack.js');
        const inspectOutput = runCaptured('node', [
            inspectEntry,
            'valid.js',
            '--find',
            'getTitle'
        ], packageDirectory);

        if (!inspectOutput.includes('"stack"')) {
            fail('Packed consumer inspector did not return a stack.');
        }

        const measureEntry = path.join(packageDirectory, 'node_modules', '.bin', 'resilient-measure');
        const measurement = JSON.parse(runCaptured(measureEntry, ['--report', 'measurement.json', 'measured.js'], packageDirectory));
        const savedMeasurement = JSON.parse(read(path.join(packageDirectory, 'measurement.json')));
        const { complete = false, summary: measuredSummary = {} } = measurement;
        const { active = {}, suppressed = {}, exceptions = {} } = measuredSummary;
        const { errors: activeErrors = 0 } = active;
        const { errors: suppressedErrors = 0 } = suppressed;
        const { sites = 0 } = exceptions;
        const { summary: savedSummary = {} } = savedMeasurement;

        if (!complete || activeErrors !== 1 || suppressedErrors !== 1 || sites !== 1) {
            fail('Packed consumer measurement did not distinguish active findings, suppressed findings, and directive sites.');
        }

        if (JSON.stringify(measuredSummary) !== JSON.stringify(savedSummary) ||
            read(path.join(packageDirectory, 'measured.js')) !== measuredSource) {
            fail('Packed consumer measurement did not preserve source or its saved report.');
        }

        write(packageDirectory, 'tsconfig.json', JSON.stringify({
            compilerOptions: { strict: true, target: 'es2020' }, files: ['lowering.ts']
        }));
        write(packageDirectory, 'lowering.ts', [
            'export const greeting = "hello";',
            'type Box = { value: string };',
            'export const BoxValue = (box: Box) => Box(box);',
            'type CallablePair = [(value: string) => string, string];',
            'type Mapper = { map: <B>(value: unknown, callback: (pair: CallablePair) => B) => B };',
            'export const invokePair = (F: Mapper, value: unknown) => F.map(value, ([apply, input]) => [apply(input), input]);',
            ''
        ].join('\n'));
        write(packageDirectory, 'lowering.config.js', `import resilient from 'eslint-plugin-resilient';
export default [resilient.configs.recommended, { files: ['**/*.js'], rules: { quotes: ['error', 'single'] } }];\n`);
        const lowerEntry = path.join(packageDirectory, 'node_modules', '.bin', 'resilient-lower');
        const lowerArgs = ['--project', 'tsconfig.json', '--eslint-config', 'lowering.config.js'];

        runCaptured(lowerEntry, [...lowerArgs, '--outDir', 'raw'], packageDirectory);
        runCaptured(lowerEntry, [...lowerArgs, '--outDir', 'reported', '--report', 'raw-report.json'], packageDirectory);
        runCaptured(lowerEntry, [...lowerArgs, '--outDir', 'fixed', '--fix'], packageDirectory);
        runCaptured(lowerEntry, [...lowerArgs, '--outDir', 'fixed-reported', '--fix', '--report', 'fixed-report.json'], packageDirectory);
        const rawCode = read(path.join(packageDirectory, 'raw', 'lowering.js'));
        const fixedCode = read(path.join(packageDirectory, 'fixed', 'lowering.js'));
        const rawReport = JSON.parse(read(path.join(packageDirectory, 'raw-report.json')));
        const fixedReport = JSON.parse(read(path.join(packageDirectory, 'fixed-report.json')));
        const { fixApplied: rawFixApplied = false, complete: rawComplete = false, changedFiles: rawChanged = 0, postFix = undefined } = rawReport;
        const { fixApplied: fixedFixApplied = false, complete: fixedComplete = false, changedFiles: fixedChanged = 0 } = fixedReport;

        if (rawCode !== read(path.join(packageDirectory, 'reported', 'lowering.js')) ||
            fixedCode !== read(path.join(packageDirectory, 'fixed-reported', 'lowering.js')) || rawCode === fixedCode ||
            rawFixApplied || !fixedFixApplied || !rawComplete || !fixedComplete ||
            rawChanged !== 0 || fixedChanged !== 1 || postFix !== null) {
            fail('Packed lowerer modes did not preserve raw/report identity and explicit fixing.');
        }

        ['object', 'array', 'function'].forEach((helper) => {
            if (!rawCode.includes(`eslint-plugin-resilient/standard/${helper}`)) fail(`Missing portable ${helper} helper import.`);
        });
        write(packageDirectory, 'lowering-runtime.mjs', `import assert from 'node:assert/strict';
for (const mode of ['raw', 'reported', 'fixed', 'fixed-reported']) {
    const { greeting, invokePair } = await import(new URL('./' + mode + '/lowering.js', import.meta.url));
    assert.equal(greeting, 'hello');
    assert.deepEqual(invokePair({ map: (value, callback) => callback(value) }, [value => value.toUpperCase(), 'ok']), ['OK', 'ok']);
}
`);
        run('node', ['lowering-runtime.mjs'], packageDirectory);

        process.stdout.write('Packed consumer contract valid.\n');
    } finally {
        fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
};

try {
    main();
} catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
    process.exit(1);
}
