import { execFileSync } from 'node:child_process';

const getRuntime = () => ({ node: process.version, platform: process.platform, arch: process.arch });
const assertSupportedRuntime = ({ node = process.version } = {}) => {
    const match = /^v?(\d+)\.(\d+)\.(\d+)$/u.exec(node) || [];
    const [, major = '', minor = ''] = match;

    if (!(Number(major) >= 24 || Number(major) === 22 && Number(minor) >= 13)) {
        throw new Error(`Unsupported Node ${node}; use ^22.13.0 or >=24 with matching native dependencies.`);
    }
};
const assertMatchingRuntime = ({ expected = {}, actual = getRuntime() } = {}) => {
    if (['node', 'platform', 'arch'].some((key) => {
        const { [key]: before = '' } = expected;
        const { [key]: after = '' } = actual;

        return before !== after;
    })) {
        throw new Error(`Proof runtime mismatch: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}.`);
    }
};
const checkNativeRuntime = (checkout = '') => {
    assertSupportedRuntime();
    try {
        return JSON.parse(execFileSync(process.execPath, ['--input-type=commonjs', '-e', [
            'const { createRequire } = require("node:module");',
            'const path = require("node:path");',
            'const load = createRequire(path.join(process.cwd(), "package.json"));',
            'load("rollup/dist/native.js");',
            'const esbuild = load("esbuild");',
            'esbuild.transformSync("const value = 1", { loader: "js" });',
            'process.stdout.write(JSON.stringify({ rollup: load.resolve("rollup/dist/native.js"), esbuild: esbuild.version }));'
        ].join('\n')], { cwd: checkout, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
    } catch (error) {
        throw new Error(`Native dependency check failed for ${process.platform}/${process.arch} in ${checkout}. `
            + 'Use matching Rollup/esbuild dependencies or an isolated overlay; completed proof stages remain reusable.', { cause: error });
    }
};

export { getRuntime, assertSupportedRuntime, assertMatchingRuntime, checkNativeRuntime };
