import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ESLint, Linter } from 'eslint';

import { getTraversalEntries } from '../rules/support/ast-traversal.js';
import { getObject } from '../rules/support/object.js';

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const excludedDirectories = new Set(['.git', 'docs', 'node_modules']);
const ruleNamePattern = '(?:@?[a-z0-9][a-z0-9_./-]*)(?:\\s*,\\s*@?[a-z0-9][a-z0-9_./-]*)*';
const nextLinePattern = new RegExp(`^eslint-disable-next-line\\s+(${ruleNamePattern})\\s+--\\s+(.+)$`, 'iu');
const disablePattern = new RegExp(`^eslint-disable\\s+(${ruleNamePattern})\\s+--\\s+(.+)$`, 'iu');
const enablePattern = new RegExp(`^eslint-enable(?:\\s+(${ruleNamePattern}))?$`, 'iu');

const getSourceCode = (source = '') => {
    let sourceCode;
    const captureRule = {
        create({ sourceCode: parserSourceCode = undefined } = {}) {
            sourceCode = parserSourceCode;

            return {};
        }
    };
    const linter = new Linter({ configType: 'flat' });
    const messages = linter.verify(source, [{
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module'
        },
        plugins: { audit: { rules: { 'capture-source-code': captureRule } } },
        rules: { 'audit/capture-source-code': 'error' }
    }]);
    const parsingError = messages.find(({ fatal = false } = {}) => fatal);

    return { parsingError, sourceCode };
};
const getSourceNodes = (node = {}, nodes = []) => {
    const { type = '', range = [] } = node;

    if (type && range.length === 2) {
        // eslint-disable-next-line resilient/prefer-safe-transformations -- Private traversal storage preserves node identity and preorder without copying the growing index at every visit.
        nodes.push(node);
    }

    getTraversalEntries(node).forEach(([, value = undefined] = []) => {
        const children = Array.isArray(value) ? value : [value];

        children.forEach((child) => {
            const { type: childType = false } = getObject(child);

            if (typeof childType !== 'string') return;

            getSourceNodes(child, nodes);
        });
    });

    return nodes;
};

const getOuterStatementsInRange = ({ ast = {}, nodes = getSourceNodes(ast), start = 0, end = 0 } = {}) => {
    const statements = nodes.filter(({
        type = '', range: [nodeStart = 0, nodeEnd = 0] = []
    } = {}) => (type.endsWith('Statement') || type.endsWith('Declaration')) && nodeStart >= start && nodeEnd <= end);

    return statements.filter((statement) => {
        const { range: [statementStart = 0, statementEnd = 0] = [] } = statement;

        return !statements.some((candidate) => {
            const { range: [candidateStart = 0, candidateEnd = 0] = [] } = candidate;

            return candidate !== statement && candidateStart <= statementStart && candidateEnd >= statementEnd;
        });
    });
};

const formatProblem = ({ line = 0, message = '' } = {}) => `line ${line}: ${message}`;
const genericLoopReason = 'Source loop has unproven callback safety or sequential effects.';

/* eslint-disable resilient/signature-contract-return-consistency -- A parsed directive is a record; false explicitly means no directive and must not become a truthy empty record. */
const getDirective = (text = '') => {
    const nextLineMatch = text.match(nextLinePattern);
    const disableMatch = text.match(disablePattern);
    const enableMatch = text.match(enablePattern);

    const match = nextLineMatch || disableMatch;

    if (match) {
        const [, ruleNames = '', reason = ''] = match;

        return { form: nextLineMatch ? 'next-line' : 'scoped-disable', rules: ruleNames.split(/\s*,\s*/u), reason };
    }

    if (enableMatch) {
        const [, ruleNames = ''] = enableMatch;

        return { form: 'scoped-enable', rules: ruleNames ? ruleNames.split(/\s*,\s*/u) : [], reason: '' };
    }

    return false;
};
/* eslint-enable */

const getNextLineUnit = ({ nodes = [], comment = {}, sourceCode = {} } = {}) => {
    const { loc: { end: { line = 0 } = {} } = {} } = comment;
    const token = sourceCode.getTokenAfter(comment);
    const { loc: { start: { line: tokenLine = 0 } = {} } = {}, range: [tokenStart = 0] = [] } = getObject(token);

    if (tokenLine !== line + 1) return {};

    const lineCandidates = nodes.filter(({
        type = '',
        loc: { start: { line: statementLine = 0 } = {} } = {}
    } = {}) => type !== 'Program' && statementLine === tokenLine);
    // Parser preorder owns equal ranges: a shorthand Property precedes its Identifier.
    // Scoped statement containment has a distinct-identity law, not this tie break.
    const lineUnits = lineCandidates.filter(({ range: [start = 0, end = 0] = [] } = {}, index) => (
        !lineCandidates.some(({
            range: [ancestorStart = 0, ancestorEnd = 0] = []
        } = {}, ancestorIndex) => ancestorIndex < index && ancestorStart <= start && ancestorEnd >= end)
    ));
    const unit = lineUnits.find(({ range: [start = 0, end = 0] = [] } = {}) => start <= tokenStart && end > tokenStart);
    const initialOwner = unit || nodes.findLast(({
        type = '', range: [start = 0, end = 0] = []
    } = {}) => type !== 'Program' && start <= tokenStart && end > tokenStart);
    const { type: ownerType = '', range: [initialStart = 0, initialEnd = 0] = [] } = getObject(initialOwner);
    const containsLineUnits = ({ range: [start = 0, end = 0] = [] } = {}) => lineUnits.every(({
        range: [unitStart = 0, unitEnd = 0] = []
    } = {}) => unitStart >= start && unitEnd <= end);
    // A continued condition and its return share the nearest statement; do not
    // widen to a farther ancestor just because it also contains unrelated siblings.
    const continuation = !ownerType.endsWith('Statement') && !ownerType.endsWith('Declaration') &&
        ownerType !== 'ArrowFunctionExpression' && ownerType !== 'Property' && !containsLineUnits(getObject(initialOwner))
        ? nodes.findLast(({
            type = '', range: [start = 0, end = 0] = []
        } = {}) => type !== 'BlockStatement' && (type.endsWith('Statement') || type.endsWith('Declaration')) &&
            start <= initialStart && end >= initialEnd)
        : undefined;
    const owner = getObject(continuation || initialOwner);
    const { type: finalOwnerType = '' } = owner;

    if (!finalOwnerType || !containsLineUnits(owner)) return {};

    return owner;
};

const getExceptionInventory = ({ file = '', source = '' } = {}) => {
    const { parsingError = {}, sourceCode = undefined } = getSourceCode(source);
    const { message: parsingMessage = '', line: parsingLine = 0 } = parsingError;

    if (parsingMessage) return { entries: [], problems: [formatProblem({ line: parsingLine, message: parsingMessage })] };

    const { ast = {} } = sourceCode;
    const comments = sourceCode.getAllComments();
    const nodes = getSourceNodes(ast);
    const { entries = [], problems = [], regions = [] } = comments.reduce(({
        entries: priorEntries = [], problems: priorProblems = [], regions: priorRegions = []
    } = {}, comment) => {
        const {
            value = '', type: commentType = '', range: commentRange = [],
            loc: { start: { line = 0, column = 0 } = {} } = {}
        } = comment;
        const [, end = 0] = commentRange;
        const text = value.trim();
        const commentProblems = [
            {
                failed: text.includes(genericLoopReason),
                message: 'Generic loop exceptions are forbidden; name the preserved observable behavior.'
            },
            {
                failed: /\bresilient-allow(?:-|\b)/iu.test(text),
                message: 'Legacy resilient-allow markers are forbidden; use a documented ESLint exception.'
            }
        ].filter(({ failed = false } = {}) => failed).map(({ message = '' } = {}) => formatProblem({ line, message }));
        const currentProblems = [...priorProblems, ...commentProblems];
        const state = { entries: priorEntries, problems: currentProblems, regions: priorRegions };

        if (!/^eslint(?:-|\b)/iu.test(text)) return state;

        const directive = getDirective(text);

        if (!directive) {
            return {
                ...state,
                problems: [...currentProblems, formatProblem({
                    line,
                    message: 'Only // eslint-disable-next-line <rules> -- <reason> or a limited '
                        + '/* eslint-disable <rules> -- <reason> */ … /* eslint-enable [rules] */ region is allowed.'
                })]
            };
        }

        const { form = '', rules = [], reason = '' } = directive;
        const location = { line, column: column + 1 };
        const subsystem = file.split(path.sep).filter(Boolean)[0] || 'root';

        if (form === 'scoped-enable' && (commentType !== 'Block' || !priorRegions.length)) return {
            ...state,
            problems: [...currentProblems, formatProblem({ line, message: 'eslint-enable has no preceding scoped eslint-disable.' })]
        };

        if (form === 'scoped-enable') {
            const region = priorRegions.at(-1);
            const { entry = {}, openEnd = 0 } = region;
            const { rules: openRules = [] } = entry;
            const { location: { line: openLine = 0 } = {} } = entry;
            const [closeStart = 0] = commentRange;
            const statements = getOuterStatementsInRange({
                nodes,
                start: openEnd,
                end: closeStart
            });
            const [{ type: enclosedAst = '', range: enclosedRange = [] } = {}] = statements;
            const exactRules = JSON.stringify(rules) === JSON.stringify(openRules);
            const regionProblems = [
                {
                    failed: statements.length !== 1,
                    line: openLine,
                    message: 'A scoped eslint-disable region must enclose exactly one syntactic statement or declaration.'
                },
                {
                    failed: Boolean(rules.length) && !exactRules,
                    line,
                    message: 'Rule-specific eslint-enable must exactly match its scoped eslint-disable.'
                },
                {
                    failed: !rules.length && priorRegions.length > 1,
                    line,
                    message: 'Scoped eslint-disable regions must not nest with a bare eslint-enable.'
                }
            ].filter(({ failed = false } = {}) => failed)
                .map(({ line: problemLine = 0, message = '' } = {}) => formatProblem({ line: problemLine, message }));

            return {
                entries: [...priorEntries, {
                    ...entry, closeRange: commentRange, enclosedAst, enclosedRange,
                    operation: enclosedRange.length ? source.slice(...enclosedRange) : ''
                }],
                problems: [...currentProblems, ...regionProblems],
                regions: priorRegions.slice(0, -1)
            };
        }

        const enclosed = form === 'next-line' ? getNextLineUnit({ nodes, comment, sourceCode }) : {};
        const { type: enclosedAst = '', range: enclosedRange = [] } = enclosed;
        const directiveProblems = [
            {
                failed: form === 'next-line' && commentType !== 'Line',
                message: 'eslint-disable-next-line must use a // comment.'
            },
            {
                failed: form === 'scoped-disable' && commentType !== 'Block',
                message: 'A scoped eslint-disable must use a /* */ comment.'
            },
            {
                failed: form === 'next-line' && !enclosedAst,
                message: 'eslint-disable-next-line must precede one AST unit on the next line.'
            },
            {
                failed: form === 'scoped-disable' && priorRegions.some(({ entry: { rules: openRules = [] } = {} } = {}) => (
                    rules.some(rule => openRules.includes(rule))
                )),
                message: 'Nested scoped eslint-disable regions must not overlap the same rule.'
            }
        ].filter(({ failed = false } = {}) => failed).map(({ message = '' } = {}) => formatProblem({ line, message }));
        const entry = {
            file,
            subsystem,
            form,
            rules,
            reason,
            location,
            range: commentRange,
            enclosedAst,
            enclosedRange,
            operation: enclosedRange.length ? source.slice(...enclosedRange) : ''
        };

        return {
            entries: form === 'scoped-disable' ? priorEntries : [...priorEntries, entry],
            problems: [...currentProblems, ...directiveProblems],
            regions: form === 'scoped-disable' ? [...priorRegions, { entry, openEnd: end }] : priorRegions
        };
    }, { entries: [], problems: [], regions: [] });
    const unclosedProblems = regions.map(({ entry: { location: { line = 0 } = {} } = {} } = {}) => formatProblem({
        line,
        message: 'Scoped eslint-disable must close with /* eslint-enable [rules] */.'
    }));

    return { entries, problems: [...problems, ...unclosedProblems] };
};

const auditSource = (source = '') => getExceptionInventory({ source }).problems;

const getJavaScriptFiles = (directory = rootDirectory) => fs.readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
        const { name = '', isDirectory = undefined, isFile = undefined } = entry;
        const entryPath = path.join(directory, name);
        const directoryEntry = Reflect.apply(isDirectory, entry, []);

        if (directoryEntry && (excludedDirectories.has(name) ||
            entryPath.endsWith(path.join('tests', 'fixtures')) ||
            entryPath.endsWith(path.join('tests', 'proofs', 'fp-ts', 'checkout')))) return [];

        if (directoryEntry) return getJavaScriptFiles(entryPath);

        return Reflect.apply(isFile, entry, []) && name.endsWith('.js') ? [entryPath] : [];
    });

const getDirectoryExceptionReport = (directory = rootDirectory) => getJavaScriptFiles(directory)
    .reduce(({ entries = [], problems = [] } = {}, filePath) => {
        const file = path.relative(directory, filePath);
        const { entries: fileEntries = [], problems: fileProblems = [] } = getExceptionInventory({
            file,
            source: fs.readFileSync(filePath, 'utf8')
        });

        return {
            entries: [...entries, ...fileEntries],
            problems: [...problems, ...fileProblems.map(problem => `${file} ${problem}`)]
        };
    }, { entries: [], problems: [] });

const auditDirectory = (directory = rootDirectory) => getDirectoryExceptionReport(directory).problems;
const getDirectoryExceptionInventory = (directory = rootDirectory) => getDirectoryExceptionReport(directory).entries;

const getUnusedDirectiveFindings = (results = [], directory = rootDirectory) => results.flatMap(({
    filePath = '', messages = []
} = {}) => messages.filter(({ message = '' } = {}) => message.startsWith('Unused eslint-disable directive'))
    .map(({ line = 0, column = 0, message = '' } = {}) => ({
        file: path.relative(directory, filePath),
        location: { line, column },
        message
    })));

const countBy = (entries = [], getKey = () => '') => Object.fromEntries(
    Object.entries(Object.groupBy(entries, getKey))
        .map(([key = '', members = []] = []) => [key, members.length])
);

const summarizeExceptionInventory = (entries = []) => ({
    boundaries: entries.length,
    ruleSites: entries.reduce((count, { rules = [] } = {}) => count + rules.length, 0),
    bySubsystem: countBy(entries, ({ subsystem = 'root' } = {}) => subsystem),
    byForm: countBy(entries, ({ form = '' } = {}) => form),
    byRule: countBy(entries.flatMap(({ rules = [] } = {}) => rules), rule => rule)
});

// Source owns the boundary. Evidence can decorate exactly one parsed operation,
// never select the first repeated reason or silently cover a newly added site.
const getExceptionEvidenceReport = ({ entries = [], evidence = [] } = {}) => {
    const getKey = ({ file = '', form = '', rules = [], reason = '', operation = '' } = {}) => (
        JSON.stringify([file, form, rules, reason, operation])
    );
    const candidates = Object.groupBy(entries, getKey);
    const matches = evidence.map((record = {}) => {
        const { id = 0, file = '', range: [start = -1] = [] } = record;
        const { [getKey(record)]: possible = [] } = candidates;
        const exact = possible.filter(({ range: [candidateStart = -2] = [] } = {}) => candidateStart === start);
        const selected = possible.length === 1 ? possible : exact;
        const [entry = {}] = selected;
        const { length: selectedCount = 0 } = selected;

        return selectedCount === 1
            ? { record, entry }
            : { record, problem: `${file} evidence ${id}: ${possible.length ? 'ambiguous' : 'stale'} source operation.` };
    });
    const getLocationKey = ({ file = '', range = [] } = {}) => JSON.stringify([file, range]);
    const byLocation = Object.groupBy(matches.filter(({ problem = '' } = {}) => !problem), ({ entry = {} } = {}) => (
        getLocationKey(entry)
    ));
    const published = entries.map((entry = {}) => {
        const { [getLocationKey(entry)]: attached = [] } = byLocation;
        const [{ record = {} } = {}] = attached;
        const { length: attachedCount = 0 } = attached;
        const { file = '', location: { line = 0 } = {} } = entry;

        return attachedCount === 1
            ? { entry: { ...record, ...entry } }
            : { entry, problem: `${file} line ${line}: ${attached.length ? 'duplicate evidence for' : 'missing evidence for'} source boundary.` };
    });

    return {
        entries: published.map(({ entry = {} } = {}) => entry),
        problems: [...matches, ...published].flatMap(({ problem = '' } = {}) => problem ? [problem] : [])
    };
};

const main = async () => {
    if (process.argv.includes('--inventory')) {
        const { entries = [], problems = [] } = getDirectoryExceptionReport();
        const unused = process.argv.includes('--unused')
            ? getUnusedDirectiveFindings(await new ESLint({ cwd: rootDirectory }).lintFiles(getJavaScriptFiles()), rootDirectory)
            : false;

        process.stdout.write(`${JSON.stringify({ summary: summarizeExceptionInventory(entries), problems, unused, entries }, null, 2)}\n`);

        return;
    }

    const problems = auditDirectory();

    if (!problems.length) return;

    process.stderr.write(`Invalid ESLint exceptions:\n${problems.join('\n')}\n`);
    // eslint-disable-next-line resilient/prefer-safe-transformations -- Node's process exit status is the external command failure boundary after all findings are emitted.
    process.exitCode = 1;
};

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();

export {
    auditDirectory,
    auditSource,
    getDirectoryExceptionInventory,
    getDirectoryExceptionReport,
    getExceptionInventory,
    getExceptionEvidenceReport,
    getOuterStatementsInRange,
    getUnusedDirectiveFindings,
    summarizeExceptionInventory
};
