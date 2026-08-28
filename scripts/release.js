import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packagePath = path.join(rootDirectory, 'package.json');
const packageLockPath = path.join(rootDirectory, 'package-lock.json');
const changelogPath = path.join(rootDirectory, 'CHANGELOG.md');
const indexPath = path.join(rootDirectory, 'index.js');

const read = filePath => fs.readFileSync(filePath, 'utf8');
const write = (filePath, contents) => fs.writeFileSync(filePath, contents);

const run = (command, args = []) => {
    execFileSync(command, args, {
        cwd: rootDirectory,
        stdio: 'inherit'
    });
};

const fail = (message) => {
    throw new Error(message);
};

const parseVersion = (version = '') => {
    const match = /^([0-9]+)\.([0-9]+)\.([0-9]+)(?:-([0-9A-Za-z.-]+))?$/.exec(version);
    if (!match) fail(`Invalid semantic version: ${version}`);

    return {
        major: Number(match[1]),
        minor: Number(match[2]),
        patch: Number(match[3]),
        prerelease: match[4] || ''
    };
};

const compareVersions = (left = '', right = '') => {
    const a = parseVersion(left);
    const b = parseVersion(right);

    for (const key of ['major', 'minor', 'patch']) {
        if (a[key] !== b[key]) return a[key] - b[key];
    }

    if (!a.prerelease && b.prerelease) return 1;
    if (a.prerelease && !b.prerelease) return -1;
    return a.prerelease.localeCompare(b.prerelease);
};

const incrementVersion = ({ version = '', releaseType = 'patch' } = {}) => {
    const { major = 0, minor = 0, patch = 0 } = parseVersion(version);

    if (releaseType === 'major') return `${major + 1}.0.0`;
    if (releaseType === 'minor') return `${major}.${minor + 1}.0`;
    return `${major}.${minor}.${patch + 1}`;
};

const getPackage = () => JSON.parse(read(packagePath));

const setPackageVersion = ({ version = '' } = {}) => {
    const packageJson = { ...getPackage(), version };
    write(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);

    const sourcePackageLock = JSON.parse(read(packageLockPath));
    const packageLock = {
        ...sourcePackageLock,
        version,
        ...(sourcePackageLock.packages && {
            packages: {
                ...sourcePackageLock.packages,
                ...(sourcePackageLock.packages[''] && {
                    '': {
                        ...sourcePackageLock.packages[''],
                        version
                    }
                })
            }
        })
    };
    write(packageLockPath, `${JSON.stringify(packageLock, null, 2)}\n`);
};

const getPackageLockVersion = () => {
    const packageLock = JSON.parse(read(packageLockPath));
    return packageLock.packages && packageLock.packages['']
        ? packageLock.packages[''].version
        : '';
};

const getIndexVersion = () => {
    const match = /version:\s*['"]([^'"]+)['"]/.exec(read(indexPath));
    return match ? match[1] : '';
};

const assertConsistency = () => {
    const { version: packageVersion = '' } = getPackage();
    const packageLockVersion = getPackageLockVersion();
    const indexVersion = getIndexVersion();
    const changelog = read(changelogPath);

    if (!packageLockVersion) fail('Could not find the root package version in package-lock.json.');
    if (packageVersion !== packageLockVersion) {
        fail(`package.json (${packageVersion}) and package-lock.json (${packageLockVersion}) differ.`);
    }
    if (packageVersion !== indexVersion) {
        fail(`package.json (${packageVersion}) and index.js (${indexVersion}) differ.`);
    }
    if (!changelog.includes(`## ${packageVersion}`)) {
        fail(`CHANGELOG.md has no heading for ${packageVersion}.`);
    }

};

const verify = () => {
    assertConsistency();
    run('npm', ['run', 'fixtures:check']);
    run('npm', ['test']);
    run('npm', ['run', 'lint']);

    const temporaryCache = fs.mkdtempSync(path.join(os.tmpdir(), 'resilient-release-cache-'));
    try {
        run('npm', ['pack', '--dry-run', '--ignore-scripts', '--cache', temporaryCache]);
    } finally {
        fs.rmSync(temporaryCache, { recursive: true, force: true });
    }
};

const getDate = () => new Date().toISOString().slice(0, 10);

const getPromotedChangelog = ({ version = '' } = {}) => {
    const changelog = read(changelogPath);
    const match = /^## Unreleased\s*\n\s*\n([\s\S]*?)(?=\n## |\s*$)/m.exec(changelog);

    if (!match || !match[1].trim()) {
        fail('CHANGELOG.md needs a non-empty ## Unreleased section before preparing a release.');
    }

    const release = `## ${version} — ${getDate()}\n\n${match[1].trim()}\n\n`;
    const replacement = `## Unreleased\n\n${release}`;

    return changelog.replace(match[0], replacement);
};

const prepare = ({ version = '' } = {}) => {
    const { version: currentVersion = '' } = getPackage();
    parseVersion(version);

    if (compareVersions(version, currentVersion) <= 0) {
        fail(`Release version ${version} must be greater than current version ${currentVersion}.`);
    }

    const promotedChangelog = getPromotedChangelog({ version });
    setPackageVersion({ version });

    const index = read(indexPath);
    const updatedIndex = index.replace(
        /version:\s*(['"])[^'"]+\1/,
        `version: '${version}'`
    );
    write(indexPath, updatedIndex);
    write(changelogPath, promotedChangelog);

    verify();
};

const args = process.argv.slice(2);
const main = () => {
    const { length = 0 } = args;
    const [first = ''] = args;

    if (first === '--check') {
        verify();
        return;
    }

    if (!length) {
        const { version = '' } = getPackage();
        prepare({ version: incrementVersion({ version }) });
        return;
    }

    if (['major', 'minor', 'patch'].includes(first)) {
        const { version = '' } = getPackage();
        prepare({ version: incrementVersion({ version, releaseType: first }) });
        return;
    }

    if (length === 1) {
        prepare({ version: first });
        return;
    }

    fail('Usage: npm run release -- [major | minor | patch | <new-version>]');
};

try {
    main();
} catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
    process.exit(1);
}
