import { execFileSync } from 'node:child_process';
import { lstatSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'espree';

const root = fileURLToPath(new URL('../', import.meta.url));
const owners = ['package.json', 'package-lock.json', 'index.js', 'analysis/eslint/index.js', 'CHANGELOG.md'];
const usage = 'Usage: npm run release -- [major | minor | patch | <version>] [--dry-run] | --check';
const read = file => readFileSync(file, 'utf8');
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const parseVersion = (version = '') => {
    const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?$/u.exec(version);

    if (!match) throw new Error(`Invalid semantic version: ${version}`);

    const [, major = '', minor = '', patch = '', suffix = ''] = match;
    const parts = [major, minor, patch].map(Number);
    const prerelease = suffix ? suffix.split('.') : [];

    if (parts.some(part => !Number.isSafeInteger(part)) || prerelease.some(part => !part || /^0\d+$/u.test(part))) {
        throw new Error(`Invalid semantic version: ${version}`);
    }

    return { parts, prerelease };
};
const compareIdentifier = (left = '', right = '') => {
    if (left === right) return 0;

    if (!left) return -1;

    if (!right) return 1;

    const numericLeft = /^\d+$/u.test(left);
    const numericRight = /^\d+$/u.test(right);

    if (numericLeft !== numericRight) return numericLeft ? -1 : 1;

    if (numericLeft && left.length !== right.length) return left.length - right.length;

    return left < right ? -1 : 1;
};
const compareVersions = (left, right) => {
    const { parts: a = [], prerelease: before = [] } = parseVersion(left);
    const { parts: b = [], prerelease: after = [] } = parseVersion(right);
    const different = a.findIndex((part, index) => part !== b.at(index));

    if (different >= 0) return a.at(different) - b.at(different);

    if (!before.length || !after.length) return Number(!before.length) - Number(!after.length);

    const index = Array.from({ length: Math.max(before.length, after.length) }, (_, index) => index)
        .find(index => before.at(index) !== after.at(index));

    return Number.isInteger(index) ? compareIdentifier(before.at(index), after.at(index)) : 0;
};
const incrementVersion = (version, kind) => {
    const { parts: [major = 0, minor = 0, patch = 0] = [] } = parseVersion(version);
    const next = { major: `${major + 1}.0.0`, minor: `${major}.${minor + 1}.0`, patch: `${major}.${minor}.${patch + 1}` };
    const { [kind]: selected = '' } = next;

    parseVersion(selected);

    return selected;
};
const propertyValue = ({ type = '', properties = [] } = {}, selected = '') => {
    const found = properties.filter(({ type = '', key: { name = '', value = '' } = {}, computed = false } = {}) => (
        type === 'Property' && !computed && (name || value) === selected
    ));

    if (type !== 'ObjectExpression' || found.length !== 1) throw new Error(`Expected one static plugin ${selected} property`);

    const [{ value = {} } = {}] = found;

    return value;
};
const pluginVersion = ({ file = '', before = '' } = {}) => {
    const { body = [] } = parse(before, { ecmaVersion: 'latest', sourceType: 'module', range: true });
    const declarations = body.flatMap(({ type = '', declarations = [] } = {}) => type === 'VariableDeclaration' ? declarations : [])
        .filter(({ id: { type = '', name = '' } = {} } = {}) => type === 'Identifier' && name === 'plugin');

    if (declarations.length !== 1) throw new Error(`Expected one plugin metadata owner in ${file}`);

    const [{ init = {} } = {}] = declarations;
    const { type = '', arguments: args = [], callee: { object: { name = '' } = {}, property: { name: method = '' } = {} } = {} } = propertyValue(init, 'meta');

    if (type !== 'CallExpression' || name !== 'Object' || method !== 'freeze' || args.length !== 1) throw new Error(`Expected frozen plugin metadata in ${file}`);

    const { type: kind = '', value: version = '', range: [start = -1, end = -1] = [] } = propertyValue(args.at(0), 'version');

    if (kind !== 'Literal' || typeof version !== 'string' || start < 0 || end <= start) throw new Error(`Expected a literal plugin version in ${file}`);

    return { version, start, end };
};
const sectionsOf = (source) => {
    const headings = [...source.matchAll(/^## ([^\r\n]+)/gmu)].map(({ 0: heading = '', 1: title = '', index = 0 } = {}) => ({ title, start: index, end: index + heading.length }));

    return headings.map((heading, index) => {
        const { end = 0 } = heading;
        const { start = source.length } = headings.at(index + 1) ?? {};

        return { ...heading, body: source.slice(end, start) };
    });
};
const acquire = () => {
    const files = owners.map((file) => {
        const path = join(root, file);
        const status = lstatSync(path);
        const { mode = 0 } = status;

        if (!status.isFile()) throw new Error(`Expected a regular release owner file: ${file}`);

        return { file, path, before: read(path), mode };
    });
    const [manifest = {}, lock = {}, index = {}, product = {}, changelog = {}] = files;
    const { before: packageSource = '' } = manifest;
    const { before: lockSource = '' } = lock;
    const { before: history = '' } = changelog;
    const packageData = JSON.parse(packageSource);
    const lockData = JSON.parse(lockSource);
    const { version = '' } = packageData;
    // eslint-disable-next-line resilient/no-falsifiable-property-key -- npm's package-lock schema identifies the root package with the empty-string key.
    const { version: lockVersion = '', packages: { '': { version: rootVersion = '' } = {} } = {} } = lockData;
    const indexVersion = pluginVersion(index);
    const productVersion = pluginVersion(product);
    const { version: rootPluginVersion = '' } = indexVersion;
    const { version: rulePluginVersion = '' } = productVersion;

    parseVersion(version);

    if ([lockVersion, rootVersion, rootPluginVersion, rulePluginVersion].some(owner => owner !== version)) {
        throw new Error('Package, both root lock versions and both plugin metadata versions must agree');
    }

    const sections = sectionsOf(history);
    const current = sections.filter(({ title = '' } = {}) => title === version || title === `${version} — Unreleased` ||
        title.startsWith(`${version} — `) && /^\d{4}-\d{2}-\d{2}$/u.test(title.slice(version.length + 3)));

    if (current.length !== 1) throw new Error(`CHANGELOG.md needs exactly one release heading for ${version}`);

    return { files, version, packageData, lockData, metadata: [indexVersion, productVersion], sections };
};
const planFor = ({ files = [], version: currentVersion = '', packageData = {}, lockData = {}, metadata = [], sections = [] } = {}, requested = '') => {
    const explicit = requested && !['major', 'minor', 'patch'].includes(requested);
    const version = explicit ? requested : incrementVersion(currentVersion, requested || 'patch');
    const comparison = compareVersions(version, currentVersion);
    const pending = sections.filter(({ title = '' } = {}) => title === 'Unreleased' || title.endsWith(' — Unreleased'));

    if (pending.length !== 1 || pending.at(0) !== sections.at(0)) throw new Error('CHANGELOG.md needs one first Unreleased section');

    const [{ title = '', body = '', start = 0, end = 0 } = {}] = pending;

    if (!body.trim()) throw new Error('CHANGELOG.md needs non-empty Unreleased notes');

    if (title !== 'Unreleased' && title !== `${version} — Unreleased`) throw new Error(`Named Unreleased target differs from requested version ${version}`);

    if (comparison < 0 || comparison === 0 && (!explicit || title !== `${currentVersion} — Unreleased`)) {
        throw new Error(`Release version ${version} must increase, or explicitly finalize its matching versioned Unreleased section`);
    }

    if (sections.some(({ title: heading = '' } = {}) => heading !== title && (heading === version || heading.startsWith(`${version} — `)))) {
        throw new Error(`CHANGELOG.md already contains release ${version}`);
    }

    const date = new Date().toISOString().slice(0, 10);
    const heading = `## ${version} — ${date}`;
    const { packages = {} } = lockData;
    // eslint-disable-next-line resilient/no-falsifiable-property-key -- npm's package-lock schema identifies the root package with the empty-string key.
    const { '': rootPackage = {} } = packages;
    // eslint-disable-next-line resilient/no-falsifiable-property-key -- Preserve npm's required empty root-package key when updating lockfile versions.
    const replacements = [json({ ...packageData, version }), json({ ...lockData, version, packages: { ...packages, '': { ...rootPackage, version } } }),
        ...metadata.map(({ start = 0, end = 0 } = {}, position) => {
            const { before = '' } = files.at(position + 2);

            return before.slice(0, start) + before.at(start) + version + before.at(start) + before.slice(end);
        })];
    const { before: history = '' } = files.at(4);
    const newline = history.includes('\r\n') ? '\r\n' : '\n';
    const promoted = history.slice(0, start) + (title === 'Unreleased' ? `## Unreleased${newline}${newline}` : '') + heading + history.slice(end);
    const next = [...replacements, promoted];

    return { version, files: files.map((file, index) => ({ ...file, after: next.at(index) })), preview: {
        dryRun: true, currentVersion, targetVersion: version, date, changelog: { from: `## ${title}`, to: heading },
        files: files.map(({ file = '', before = '' } = {}, index) => ({ file, from: currentVersion, to: version, changed: before !== next.at(index) })),
        verification: ['npm run check', 'git diff --check']
    } };
};
const verify = () => {
    const { files = [] } = acquire();
    const { execPath = '', env = {} } = process;
    const { PATH = '' } = env;
    const environment = { ...env, PATH: dirname(execPath) + delimiter + PATH };

    [['npm', ['run', 'check']], ['git', ['diff', '--check']]].forEach(([command = '', args = []] = []) => (
        execFileSync(command, args, { cwd: root, env: environment, stdio: 'inherit' })
    ));
    files.forEach(({ file = '', path = '', before = '' } = {}) => {
        if (read(path) !== before) throw new Error(`Release owner changed during verification: ${file}`);
    });
};
// The optional callback records only completed atomic publications. A cleanup
// failure after rename must still leave that owner eligible for rollback.
const publish = ({ path = '', mode = 0 } = {}, contents = '', onPublished) => {
    const staging = mkdtempSync(join(dirname(path), '.resilient-release-'));

    try {
        const file = join(staging, 'content');

        writeFileSync(file, contents, { mode });
        renameSync(file, path);

        if (typeof onPublished === 'function') onPublished();
    } finally {
        rmSync(staging, { recursive: true, force: true });
    }
};
const prepare = ({ files = [], version = '' } = {}) => {
    const changes = files.filter(({ before = '', after = '' } = {}) => before !== after);
    const committed = [];

    try {
        files.forEach(({ file = '', path = '', before = '' } = {}) => {
            if (read(path) !== before) throw new Error(`Release input changed before publication: ${file}`);
        });
        changes.forEach((row) => {
            const { file = '', path = '', before = '', after = '' } = row;

            if (read(path) !== before) throw new Error(`Release input changed before publication: ${file}`);

            publish(row, after, () => {
                // eslint-disable-next-line resilient/prefer-safe-transformations -- Record only this transaction's atomic publications so rollback cannot claim an uncommitted owner.
                committed.push(row);
            });
        });
        verify();
        files.forEach(({ file = '', path = '', after = '' } = {}) => {
            if (read(path) !== after) throw new Error(`Release owner changed during verification: ${file}`);
        });
    } catch (error) {
        const conflicts = committed.toReversed().flatMap((row) => {
            const { file = '', path = '', before = '', after = '' } = row;

            try {
                if (read(path) !== after) return [`${file}: changed externally; left untouched`];

                // eslint-disable-next-line resilient/signature-contract-call-site -- Rollback needs no journal entry; the guarded publication observer is intentionally absent.
                publish(row, before);

                return [];
            } catch (failure) {
                return [`${file}: ${failure.message}`];
            }
        });

        throw new Error(`${error.message}${conflicts.length ? `\nRollback conflicts:\n${conflicts.join('\n')}` : '\nRelease changes rolled back.'}`, { cause: error });
    }

    process.stdout.write(`Prepared ${version}. No commit, tag, push or publish was performed.\n`);
};
export const main = (args = []) => {
    if (args.length === 1 && args.at(0) === '--check') {
        verify();
        process.stdout.write('Release metadata and checks passed.\n');

        return;
    }

    const requested = args.filter(argument => argument !== '--dry-run');

    if (requested.length > 1 || args.filter(argument => argument === '--dry-run').length > 1 || requested.some(argument => argument.startsWith('--'))) throw new Error(usage);

    const plan = planFor(acquire(), requested.at(0) || '');
    const { preview = {} } = plan;

    if (args.includes('--dry-run')) {
        process.stdout.write(json(preview));

        return;
    }

    prepare(plan);
};

if (process.argv.at(1) && realpathSync(resolve(process.argv.at(1))) === fileURLToPath(import.meta.url)) {
    try {
        main(process.argv.slice(2));
    } catch (error) {
        process.stderr.write(`${error.message}\n`);
        // eslint-disable-next-line resilient/prefer-safe-transformations -- The release CLI owns its native exit status and leaves queued diagnostics to flush normally.
        process.exitCode = 1;
    }
}
