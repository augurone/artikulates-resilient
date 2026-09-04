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

const createConsumerPackage = ({ name = '', eslintRange = '', tarballPath = '' } = {}) => JSON.stringify({
    name: 'resilient-consumer-check',
    private: true,
    type: 'module',
    dependencies: {
        eslint: eslintRange,
        [name]: `file:${tarballPath}`
    }
}, null, 2);

const createConfig = () => `import resilient from 'eslint-plugin-resilient';

export default [resilient.configs.recommended];
`;

const createContractProbe = () => `import assert from 'node:assert/strict';

import resilient from 'eslint-plugin-resilient';
import { inferPattern } from 'eslint-plugin-resilient/contracts';

assert.equal(resilient.meta.name, 'eslint-plugin-resilient');
assert.equal(resilient.meta.namespace, 'resilient');
assert.equal(typeof inferPattern, 'function');
`;

const main = () => {
    const {
        name = '',
        peerDependencies: { eslint: eslintRange = '' } = {}
    } = JSON.parse(read(packagePath));
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'resilient-consumer-'));
    const packageDirectory = path.join(temporaryDirectory, 'package');
    const tarballDirectory = path.join(temporaryDirectory, 'tarball');

    fs.mkdirSync(packageDirectory);
    fs.mkdirSync(tarballDirectory);

    try {
        run('npm', [
            'pack',
            '--ignore-scripts',
            '--pack-destination',
            tarballDirectory
        ]);

        const tarballPath = getTarballPath(tarballDirectory);
        write(packageDirectory, 'package.json', createConsumerPackage({
            name,
            eslintRange,
            tarballPath
        }));
        write(packageDirectory, 'eslint.config.js', createConfig());
        write(packageDirectory, 'valid.js', 'const getTitle = ({ title = "" } = {}) => title;\nexport default getTitle;\n');
        write(packageDirectory, 'invalid.js', 'const getTitle = (options) => { const { title = "" } = options; return title; };\nexport default getTitle;\n');
        write(packageDirectory, 'contract-probe.mjs', createContractProbe());

        run('npm', [
            'install',
            '--ignore-scripts',
            '--no-audit',
            '--no-fund',
            '--package-lock=false'
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
