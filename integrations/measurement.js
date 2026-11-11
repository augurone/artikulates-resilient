import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, extname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ESLint } from 'eslint';

import { getObject } from '../analysis/host/object.js';
import { getExceptionInventory } from '../scripts/audit-eslint-exceptions.js';
import { getLintSummary } from '../scripts/fluency-report.js';
import { createPackageIdentity } from './package-identity.js';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fingerprint = file => ({ file, sha256: hash(readFileSync(file)) });
const localFile = (directory, file) => {
    const name = relative(directory, file);

    if (name === '..' || name.startsWith(`..${sep}`) || resolve(directory, name) !== file) {
        throw new Error(`Measured file is outside the project: ${file}`);
    }

    return name.split(sep).join('/');
};
const packageFiles = directory => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const { name = '' } = entry;
    const file = resolve(directory, name);

    return entry.isDirectory() ? packageFiles(file) : [file];
});
const getToolIdentity = (metadata) => {
    const manifest = resolve(packageRoot, 'package.json');
    const { data: { name = '', version = '', files = [] } = {} } = metadata.manifest(manifest);
    const paths = [...new Set([manifest, ...files.flatMap((file) => {
        const location = resolve(packageRoot, file);

        return lstatSync(location).isDirectory() ? packageFiles(location) : [location];
    })])].toSorted();
    const inputs = paths.map(file => ({ file: localFile(packageRoot, file), sha256: hash(readFileSync(file)) }));
    const eslintManifest = fileURLToPath(import.meta.resolve('eslint/package.json'));
    const dependencies = metadata.dependencies(metadata.manifest(manifest));

    return {
        name, version, sha256: hash(JSON.stringify({ files: inputs, dependencies })), files: inputs, dependencies,
        scope: 'Owned package files and resolved declared runtime/peer dependency manifests; dependency implementation bytes and transitive executable configuration imports are not hashed.',
        eslintVersion: ESLint.version, eslintPackageSha256: hash(readFileSync(eslintManifest)), nodeVersion: process.version
    };
};
const getDirectives = sourceCode => sourceCode.getAllComments().filter(({ value = '' } = {}) => /^eslint(?:-|\s|$)/iu.test(value.trim()))
    .map(({ value = '', type = '', range = [], loc: { start: { line = 0, column = 0 } = {} } = {} } = {}) => ({
        text: value.trim(), type, range, location: { line, column: column + 1 }
    }));
const getMessage = ({ ruleId = '', severity = 0, message = '', line = 0, column = 0, endLine = 0, endColumn = 0,
    fatal = false, suppressions = [] } = {}) => ({ ruleId, severity, message, line, column, endLine, endColumn, fatal, suppressions });
const getRuleSites = (entries = []) => Object.fromEntries(Object.entries(Object.groupBy(entries.flatMap(({ rules = [] } = {}) => rules), rule => rule))
    .toSorted(([left = ''], [right = '']) => left.localeCompare(right)).map(([rule = '', sites = []] = []) => [rule, sites.length]));
const getException = (entry = {}, suppressed = [], unused = [], { noInlineConfig = false, reportUnusedDisableDirectives = 'off' } = {}) => {
    const { rules = [], location: { line = 0 } = {}, form = '', enclosedRange = [], range = [], closeRange = [] } = entry;
    const [start = 0, end = 0] = enclosedRange;
    const [, openEnd = 0] = range;
    const [closeStart = 0] = closeRange;
    const unusedRules = rules.filter(rule => unused.some(({ line: messageLine = 0, message = '' } = {}) => messageLine === line && message.includes(`'${rule}'`)));
    const suppressedRules = [...new Set(suppressed.filter(({ ruleId = '', offset = -1 } = {}) => rules.includes(ruleId) && (
        form === 'next-line' ? offset >= start && offset < end : offset >= openEnd && offset < closeStart
    )).map(({ ruleId = '' } = {}) => ruleId))];

    const unusedStatus = noInlineConfig ? 'ignored' : 'unavailable';
    const reporting = !noInlineConfig && reportUnusedDisableDirectives !== 'off' && reportUnusedDisableDirectives !== 0;
    const reportedStatus = unusedRules.length ? 'reported-unused' : 'not-reported-unused';

    return { ...entry, suppressedRules, unusedRules, unusedStatus: reporting ? reportedStatus : unusedStatus };
};

// One configured lint owns parsing, analysis and comment capture. Inventory reuses
// that SourceCode; it retains the auditor's existing AST containment algorithm.
export const measureProject = async ({ directory = process.cwd(), patterns = ['.'], configFile = '', unused = false } = {}) => {
    const project = realpathSync(resolve(directory));
    const captured = new Map();
    const capture = {
        meta: { schema: [] },
        create({ filename = '', physicalFilename = '', sourceCode = {} } = {}) {
            const physical = realpathSync(physicalFilename);
            const file = localFile(project, physical);
            const source = readFileSync(physical, 'utf8');
            const { text = '' } = sourceCode;
            const problems = [
                ...(filename !== physicalFilename ? ['Processed virtual sources are not a complete physical-source inventory.'] : []),
                ...(source.replace(/^\uFEFF/u, '') !== text ? ['Parsed source differs from the physical input.'] : []),
                ...(captured.has(physicalFilename) ? ['Source was captured more than once.'] : [])
            ];
            const inventory = getExceptionInventory({ file, source: text, sourceCode });

            // eslint-disable-next-line resilient/prefer-safe-transformations -- This per-run join retains ESLint's own parsed inventory and input hash until its lint results are returned.
            captured.set(physicalFilename, { sha256: hash(source), directives: getDirectives(sourceCode), inventory, problems });

            return {};
        }
    };
    const eslint = new ESLint({
        cwd: project, fix: false, cache: false, concurrency: 'off',
        ...(configFile && { overrideConfigFile: resolve(project, configFile) }),
        overrideConfig: {
            plugins: { 'resilient-measure': { rules: { capture } } },
            rules: { 'resilient-measure/capture': 'error' },
            ...(unused && { linterOptions: { reportUnusedDisableDirectives: 'error' } })
        }
    });
    const configurationsByFile = new Map();
    const metadata = createPackageIdentity();
    const tool = getToolIdentity(metadata);
    const projectInputs = metadata.project(project);
    const { sha256: toolHash = '', nodeVersion = '' } = tool;
    const { sha256: projectHash = '' } = projectInputs;
    const environmentSha256 = hash(JSON.stringify({ tool: toolHash, node: nodeVersion, project: projectHash }));
    const results = (await eslint.lintFiles(patterns)).toSorted(({ filePath: left = '' } = {}, { filePath: right = '' } = {}) => left.localeCompare(right));
    const files = await Promise.all(results.map(async ({ filePath = '', messages = [], suppressedMessages = [], fatalErrorCount = 0 } = {}) => {
        const physical = realpathSync(filePath);
        const file = localFile(project, physical);
        const { sha256 = '', directives = [], inventory: { entries = [], problems: auditProblems = [] } = {},
            problems: captureProblems = [] } = getObject(captured.get(filePath));
        const source = readFileSync(physical, 'utf8');
        const currentHash = hash(source);
        const text = source.replace(/^\uFEFF/u, '');
        const lineStarts = [0, ...Array.from(text.matchAll(/\r\n|[\n\r\u2028\u2029]/gu), ({ index = 0, 0: newline = '' } = {}) => index + newline.length)];
        const problems = [
            ...captureProblems,
            ...(!captured.has(filePath) ? ['ESLint did not capture this source (ignored, unconfigured, disabled capture or parse failure).'] : []),
            ...(fatalErrorCount ? ['ESLint could not parse this source.'] : []),
            ...(sha256 && sha256 !== currentHash ? ['Source changed during measurement.'] : [])
        ];
        const active = messages.map(getMessage);
        const suppressed = suppressedMessages.map((message) => {
            const { line = 0, column = 0 } = message;

            return { ...getMessage(message), offset: (lineStarts.at(line - 1) ?? -1) + column - 1 };
        });
        const unusedMessages = active.filter(({ ruleId = '', message = '' } = {}) => !ruleId && message.startsWith('Unused eslint-disable directive'));
        const selectedConfig = configFile ? resolve(project, configFile) : await eslint.findConfigFile(filePath);

        if (!selectedConfig) throw new Error(`No ESLint configuration found for ${file}`);

        const configPath = realpathSync(selectedConfig);

        if (!configurationsByFile.has(configPath)) {
            // eslint-disable-next-line resilient/prefer-safe-transformations -- This per-run index fingerprints each selected configuration once across all measured files using it.
            configurationsByFile.set(configPath, fingerprint(configPath));
        }

        const configuration = configurationsByFile.get(configPath);
        const { linterOptions: directivePolicy = {} } = getObject(await eslint.calculateConfigForFile(filePath));
        const exceptions = entries.map(entry => getException(entry, suppressed, unusedMessages, directivePolicy));

        return {
            file, sha256: sha256 || currentHash, complete: !problems.length, problems, auditProblems,
            directives, directivePolicy, configuration, exceptions, active, suppressed
        };
    }));
    const configurations = [...configurationsByFile.values()].toSorted(({ file: left = '' } = {}, { file: right = '' } = {}) => left.localeCompare(right));
    const [configuration = {}] = configurations.length === 1 ? configurations : [];
    const problems = [
        ...metadata.problems(),
        ...(!files.length ? ['No files were measured.'] : []),
        ...configurations.filter(({ file = '', sha256 = '' } = {}) => sha256 !== hash(readFileSync(file)))
            .map(({ file = '' } = {}) => `Observed configuration changed during measurement: ${file}`)
    ];
    const exceptions = files.flatMap(({ exceptions: entries = [] } = {}) => entries);
    const directives = files.flatMap(({ file = '', directives: entries = [] } = {}) => entries.map(entry => ({ file, ...entry })));
    const active = files.flatMap(({ file = '', active: messages = [] } = {}) => messages.map(message => ({ file, ...message })));
    const suppressed = files.flatMap(({ file = '', suppressed: messages = [] } = {}) => messages.map(message => ({ file, ...message })));
    const auditProblems = files.flatMap(({ file = '', auditProblems: entries = [] } = {}) => entries.map(message => ({ file, message })));

    return {
        schemaVersion: 3, complete: !problems.length && files.every(({ complete = false } = {}) => complete), problems,
        identity: { project, patterns, configuration, configurations, tool, projectInputs, environmentSha256, profile: unused ? 'unused-directives' : 'configured',
            configurationScope: 'Selected physical configuration files observed after lint and effective directive policy; transitive executable imports are not fingerprinted.' },
        summary: {
            active: getLintSummary(files.map(({ active: messages = [] } = {}) => ({ messages }))),
            suppressed: getLintSummary(files.map(({ suppressed: messages = [] } = {}) => ({ messages }))),
            exceptions: { sites: exceptions.length, byRule: getRuleSites(exceptions), directives: directives.length, auditProblems: auditProblems.length }
        },
        files: files.map(({ file = '', sha256 = '', complete = false, problems: failures = [], auditProblems: audit = [], directivePolicy = {}, configuration: selected = {} } = {}) => ({
            file, sha256, complete, problems: failures, auditProblems: audit, directivePolicy, configuration: selected
        })),
        active, suppressed, directives, exceptions, auditProblems
    };
};

export const saveMeasurement = ({ directory = '', file = '', report = {} } = {}) => {
    const destination = resolve(directory, file);
    const { files = [], identity: { project = '', configurations = [],
        projectInputs: { manifest = false, lockfiles = [], dependencies: { packages: projectPackages = [] } = {} } = {},
        tool: { files: toolFiles = [], dependencies: { packages: toolPackages = [] } = {} } = {} } = {} } = report;
    const metadataFiles = [manifest, ...lockfiles, ...projectPackages, ...toolPackages].filter(Boolean).map(({ file: input = '' } = {}) => input);
    const protectedFiles = [...metadataFiles, ...configurations.map(({ file: config = '' } = {}) => config), ...files.map(({ file: source = '' } = {}) => resolve(project, source)),
        ...toolFiles.map(({ file: source = '' } = {}) => resolve(packageRoot, source))];
    const parent = realpathSync(dirname(destination));
    const canonical = resolve(parent, relative(dirname(destination), destination));

    if (extname(destination) !== '.json' || protectedFiles.includes(canonical) || existsSync(destination) && lstatSync(destination).isSymbolicLink()) {
        throw new Error('The report must be a JSON file distinct from source, configuration, package, lockfile and tool inputs.');
    }

    const pending = `${destination}.${process.pid}.pending`;

    writeFileSync(pending, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });

    try {
        renameSync(pending, destination);
    } finally {
        rmSync(pending, { force: true });
    }
};
