import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';

import { ESLint } from 'eslint';

import plugin from 'eslint-plugin-resilient/eslint';

import { put } from '../analysis/collections.js';
import { createAnalysisListener } from '../analysis/eslint/support/analysis.js';
import { createProjectAdapter } from './project.js';

const hash = value => createHash('sha256').update(value).digest('hex');
const selections = [
    { collection: 'receivers', query: 'check' },
    { collection: 'destructurings', query: 'checkDestructuring' },
    { collection: 'destructuringFields', query: 'checkDestructuringField' },
    { collection: 'calls', query: 'checkCall' },
    { collection: 'functions', query: 'checkFunction' },
    { collection: 'memberAccesses', query: 'checkMemberAccess' },
    { collection: 'invocations', query: 'checkInvocation' },
    { collection: 'promiseUses', query: 'checkPromiseUse' },
    { collection: 'declarations', query: 'checkDeclaration' },
    { collection: 'signatureExtractions', query: 'checkSignatureExtraction' }
];
const selectCursor = ({ source = '', find = '', offset = -1, bom = 0 } = {}) => {
    if (typeof find !== 'string' || !Number.isSafeInteger(offset) || offset < -1) throw new TypeError('Expected a text selector or integer offset');

    if (Boolean(find) === (offset >= 0)) throw new Error('Select exactly one of --find or --offset');

    const start = find ? source.indexOf(find) : offset;

    if (start < 0) throw new Error('The --find text does not occur in the selected source');

    if (find && source.indexOf(find, start + 1) >= 0) throw new Error('The --find text must occur exactly once');

    if (start > source.length) throw new RangeError('The --offset is outside the selected source');

    const starts = [0, ...Array.from(source.matchAll(/\r\n|[\n\r\u2028\u2029]/gu), ({ index = 0, 0: newline = '' } = {}) => index + newline.length)];
    const line = starts.findLastIndex(value => value <= start);

    return { offset: start, range: [start, start + find.length], line: line + 1, column: Math.max(1, start - starts.at(line) + 1 - (line === 0 ? bom : 0)), starts };
};
const overlaps = (range = [], selected = []) => {
    const [start = -1, end = -1] = range;
    const [left = -1, right = -1] = selected;

    if (start < 0 || end < start) return false;

    if (left === right) return start <= left && (left < end || start === end && left === start);

    return start < right && (end > left || start === end && start >= left);
};
const findingRange = ({ line = 0, column = 0, endLine = line, endColumn = column } = {}, starts = [], bom = 0) => [
    (starts.at(line - 1) ?? -1) + column - 1 + (line === 1 ? bom : 0),
    (starts.at(endLine - 1) ?? -1) + endColumn - 1 + (endLine === 1 ? bom : 0)
];
const unknownResult = ({ status = '', incomplete = false, normal = false, thrown = false, fact = {}, family = {}, evidence = [] } = {}) => {
    const incompleteFacts = [fact, family, ...evidence].some(({ incomplete: partial = false } = {}) => partial);

    return status === 'unknown' || incomplete || incompleteFacts || normal === 'unknown' || thrown === 'unknown';
};

export const inspectJavaScript = async ({ fileName = '', cwd = process.cwd(), config = '', standalone = false, find = '', offset = -1 } = {}) => {
    if (!fileName) throw new Error('Expected one source file');

    if (standalone && config) throw new Error('Standalone inspection cannot combine --standalone with --config');

    const directory = resolve(cwd);
    const file = realpathSync(resolve(directory, fileName));

    if (standalone && !['.js', '.jsx'].includes(extname(file))) throw new Error('Standalone inspection accepts JavaScript source files only');

    const source = readFileSync(file, 'utf8');
    const bom = source.startsWith('\uFEFF') ? 1 : 0;
    const { starts = [], ...cursor } = selectCursor({ source, find, offset, bom });
    const { range: selectedRange = [] } = cursor;
    const analyzedRange = selectedRange.map(value => value - bom);
    const captured = new Map();
    const capture = {
        meta: { schema: [] },
        create: context => createAnalysisListener(context, (analysis) => {
            const { sourceCode: { text = '', hasBOM = false } = {}, filename = '' } = context;
            put(captured, filename, { analysis, text: hasBOM ? `\uFEFF${text}` : text });
        })
    };
    const profile = standalone ? [{ ...plugin.configs.contracts, files: ['**/*.{js,jsx}'],
        languageOptions: { ecmaVersion: 'latest', sourceType: 'module', parserOptions: { ecmaFeatures: { jsx: true } } },
        settings: { resilient: createProjectAdapter({ cwd: dirname(file) }) } }] : [];
    const selectedConfiguration = config ? { overrideConfigFile: resolve(directory, config) } : {};
    const engine = new ESLint({
        cwd: standalone ? dirname(file) : directory, cache: false, fix: false,
        ...(standalone ? { overrideConfigFile: true } : selectedConfiguration),
        overrideConfig: [...profile, { plugins: { 'resilient-inspection': { rules: { capture } } }, rules: { 'resilient-inspection/capture': 'error' } }]
    });

    if (await engine.isPathIgnored(file)) throw new Error('The selected source is ignored by the ESLint configuration');

    const effective = await engine.calculateConfigForFile(file);

    if (!effective) throw new Error('No ESLint configuration applies to the selected source');

    const { processor = false, rules = {}, languageOptions: { parser = {} } = {} } = effective;

    if (processor) throw new Error('Processor-backed inspection requires a physical-to-virtual source mapping and is unsupported');

    const configFile = standalone ? '' : await engine.findConfigFile(file);
    const configHash = configFile ? hash(readFileSync(configFile)) : '';
    const [result = {}] = await engine.lintFiles([file]);
    const { messages = [], suppressedMessages = [], fatalErrorCount = 0, errorCount = 0, warningCount = 0 } = result;

    if (fatalErrorCount) throw new Error(`The selected source could not be parsed: ${messages.map(({ message = '' } = {}) => message).join('; ')}`);

    const capturedSource = captured.get(file);

    if (!capturedSource) throw new Error('Inspection did not capture the selected parser source');

    const { analysis = false, text = '' } = capturedSource;

    if (!analysis || text !== source || readFileSync(file, 'utf8') !== text) throw new Error('Inspection did not capture the unchanged selected parser source');

    if (configFile && hash(readFileSync(configFile)) !== configHash) throw new Error('The selected ESLint configuration changed during inspection');

    const observations = selections.flatMap(({ collection = '', query = '' } = {}) => {
        const { [collection]: descriptors = [], [query]: evaluate = false } = analysis;

        if (typeof evaluate !== 'function') throw new TypeError(`Missing current analysis query ${query}`);

        return descriptors.filter(({ location: { range = [] } = {} } = {}) => overlaps(range, analyzedRange))
            .map((descriptor = {}) => {
                const { index = -1 } = descriptor;

                return { collection, query, descriptor, result: evaluate({ index }) };
            });
    });
    const { files = [] } = analysis;
    const { meta = parser } = parser;
    const { name = '', version = '' } = meta;
    const selected = findings => findings.filter(finding => overlaps(findingRange(finding, starts, bom), selectedRange));

    return {
        schemaVersion: 1,
        mode: standalone ? 'standalone' : 'configured',
        fileName: file,
        sourceSha256: hash(text),
        sourceHasBOM: Boolean(bom),
        cursor,
        configuration: {
            fileName: configFile || '', sha256: configHash, parser: { name, version },
            ...(standalone ? { profile: 'resilient/contracts' } : {}),
            severities: Object.fromEntries(Object.entries(rules).filter(([rule = ''] = []) => rule !== 'resilient-inspection/capture')
                .map(([rule = '', [severity = 0] = []] = []) => [rule, severity])),
            identity: standalone ? 'built-in-contract-rules-and-effective-severities' : 'selected-config-file-and-effective-severities'
        },
        activeFiles: files,
        findings: { messages: selected(messages), suppressedMessages: selected(suppressedMessages) },
        lint: { errorCount, warningCount, suppressedCount: suppressedMessages.length },
        observations,
        unknownBoundaries: observations.filter(({ result = {} } = {}) => unknownResult(result))
            .map(({ query = '', descriptor = {} } = {}) => ({ query, descriptor })),
        limits: [
            'Static current-model queries do not validate external data or prove runtime success.',
            'Source locations and producer facts are available; no shortest-path derivation graph is constructed.',
            'Call result compatibility is not queried without a consumer requirement.',
            'Configuration identity excludes transitive executable inputs and hidden closure state.',
            'Cursor ranges use physical UTF-16 offsets; evidence ranges use parser text without a leading BOM.',
            'Additional active files supply analysis evidence; only the selected file is linted by this inspection.'
        ]
    };
};
