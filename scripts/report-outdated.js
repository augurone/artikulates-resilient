import { spawnSync } from 'node:child_process';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const result = spawnSync(npmCommand, [
    'outdated',
    '--long',
    '--fetch-timeout=5000',
    '--fetch-retries=0'
], {
    stdio: 'inherit',
    timeout: 10000
});

if (result.error) {
    process.stderr.write(`Could not run npm outdated: ${result.error.message}\n`);
}
