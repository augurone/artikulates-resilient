#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SourceCode } from 'eslint';
import { parse } from 'espree';

import { getSourceNodes } from '../analysis/host/ast-traversal.js';
import { getObject } from '../analysis/host/object.js';

// Policy P-03 boundary checks preserved from the frozen exception auditor.
const ruleNamePattern = '(?:@?[a-z0-9][a-z0-9_./-]*)(?:\\s*,\\s*@?[a-z0-9][a-z0-9_./-]*)*';
const nextLinePattern = new RegExp(`^eslint-disable-next-line\\s+(${ruleNamePattern})\\s+--\\s+(.+)$`, 'iu');
const disablePattern = new RegExp(`^eslint-disable\\s+(${ruleNamePattern})\\s+--\\s+(.+)$`, 'iu');
const enablePattern = new RegExp(`^eslint-enable(?:\\s+(${ruleNamePattern}))?$`, 'iu');
const getSourceCode = (source = '') => {
    try {
        return { sourceCode: new SourceCode(source, parse(source, {
            ecmaVersion: 'latest', sourceType: 'module', range: true, loc: true, tokens: true, comment: true
        })) };
    } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;

        const { message = '', lineNumber: line = 0 } = error;

        return { parsingError: { message: `Parsing error: ${message}`, line } };
    }
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
        : false;
    const owner = getObject(continuation || initialOwner);
    const { type: finalOwnerType = '' } = owner;

    if (!finalOwnerType || !containsLineUnits(owner)) return {};

    return owner;
};

export const getExceptionInventory = ({ file = '', source = '', ...options } = {}) => {
    const { sourceCode: suppliedSourceCode = {} } = options;
    const { parsingError = {}, sourceCode = {} } = Object.hasOwn(options, 'sourceCode')
        ? { sourceCode: suppliedSourceCode } : getSourceCode(source);
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

export const auditSource = (source = '') => getExceptionInventory({ source }).problems;

const { argv: [, entry = '', ...args] = [] } = process;

if (entry && realpathSync(entry) === fileURLToPath(import.meta.url)) {
    const { status = 1, error = {} } = spawnSync(process.execPath, [fileURLToPath(new URL('./measure-project.js', import.meta.url)), '--audit', ...args], {
        stdio: 'inherit'
    });
    const { message = '' } = error;

    // eslint-disable-next-line resilient/prefer-safe-transformations -- The audit entry point forwards the shared measurement CLI's failure status without changing auditor exports.
    process.exitCode = status === 0 ? 0 : 1;

    process.stderr.write(message ? `${message}\n` : '');
}
