import { execFileSync } from 'node:child_process';

// Data URLs execute actual ES modules without creating a package scope or wrappers.
let sequence = 0;
export const loadModule = (code = '') => import(`data:text/javascript,${encodeURIComponent(code)}#${sequence += 1}`);

// Intrinsic mutation probes need the module and its observer in one fresh realm.
export const observeModule = ({ code = '', probe = '' } = {}) => execFileSync(process.execPath, [
    '--input-type=module', '--eval',
    `const namespace = await import(${JSON.stringify(`data:text/javascript,${encodeURIComponent(code)}`)});
process.stdout.write((${probe})(namespace));`
], { encoding: 'utf8' });
