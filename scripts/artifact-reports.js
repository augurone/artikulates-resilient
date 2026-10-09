import { readdirSync } from 'node:fs';
import path from 'node:path';

import { readText as read } from './proof-files.js';

const getDiagnosticRule = ({ ruleId = '', message = '' } = {}) => ruleId || (
    message.startsWith('Unused eslint-disable directive')
        ? 'unused-disable-directive'
        : 'parse-error'
);

const getLintSummary = (results = []) => {
    const diagnostics = results.flatMap(({ filePath = '', messages: fileMessages = [] } = {}) => fileMessages
        .map(message => ({ filePath, message })));
    const messages = diagnostics.map(({ message = {} } = {}) => message);
    const rules = diagnostics.reduce((summary, { message: { ruleId = '', severity = 0, message: diagnosticText = '' } = {} } = {}) => {
        const rule = getDiagnosticRule({ ruleId, message: diagnosticText });
        const { [rule]: current = { violations: 0, errors: 0, warnings: 0 } } = summary;
        const { violations = 0, errors = 0, warnings = 0 } = current;

        return {
            ...summary,
            [rule]: {
                violations: violations + 1,
                errors: errors + (severity === 2 ? 1 : 0),
                warnings: warnings + (severity === 1 ? 1 : 0)
            }
        };
    }, {});
    const locations = diagnostics.reduce((summary, { filePath = '', message = {} } = {}) => {
        const { line = 0, column = 0, ruleId = '', message: diagnosticText = '' } = message;
        const location = `${filePath}:${line}:${column}`;
        const rule = getDiagnosticRule({ ruleId, message: diagnosticText });
        const { [location]: current = [] } = summary;
        const nextRules = new Set([...current, rule]);

        return {
            ...summary,
            [location]: [...nextRules]
        };
    }, {});
    const overlap = Object.entries(locations).reduce((summary, [, locationRules = []]) => {
        const sortedRules = [...locationRules].toSorted();

        return sortedRules.reduce((nextSummary, left, index) => sortedRules
            .slice(index + 1)
            .reduce((nestedSummary, right) => {
                const key = `${left} + ${right}`;
                const { [key]: current = 0 } = nestedSummary;

                return { ...nestedSummary, [key]: current + 1 };
            }, nextSummary), summary);
    }, {});

    return {
        files: results.length,
        violations: messages.length,
        errors: messages.filter(({ severity = 0 } = {}) => severity === 2).length,
        warnings: messages.filter(({ severity = 0 } = {}) => severity === 1).length,
        byRule: Object.fromEntries(Object.entries(rules).toSorted(([left = ''], [right = '']) => left.localeCompare(right))),
        overlap: Object.fromEntries(Object.entries(overlap).toSorted(([, left = 0], [, right = 0]) => right - left)),
        byFile: results
            .map(({ filePath = '', messages: fileMessages = [] } = {}) => ({
                file: filePath,
                violations: fileMessages.length,
                errors: fileMessages.filter(({ severity = 0 } = {}) => severity === 2).length,
                warnings: fileMessages.filter(({ severity = 0 } = {}) => severity === 1).length
            }))
            .filter(({ violations = 0 } = {}) => violations > 0)
            .toSorted(({ violations: left = 0 } = {}, { violations: right = 0 } = {}) => right - left)
    };
};

const TRIAGE_RULES = Object.freeze({
    grammar: new Set([
        'prefer-destructuring',
        'resilient/prefer-destructured-member-access',
        'resilient/prefer-safe-destructuring-defaults',
        'resilient/prefer-signature-destructuring',
        'resilient/no-else',
        'resilient/no-nested-if',
        'no-nested-ternary',
        'resilient/no-length-comparison'
    ]),
    agreement: new Set([
        'resilient/signature-contract-property',
        'resilient/signature-contract-operation',
        'resilient/signature-contract-call-site',
        'resilient/signature-contract-destructuring',
        'resilient/signature-contract-return-consistency'
    ]),
    policy: new Set([
        'resilient/prefer-falsey-returns',
        'resilient/prefer-safe-transformations',
        'no-use-before-define',
        'resilient/no-undefined-comparison',
        'resilient/prefer-async-await',
        'resilient/no-unhandled-promise-chain',
        'consistent-return',
        'eqeqeq',
        'no-console',
        'no-restricted-syntax',
        'prefer-const',
        'no-unused-vars'
    ]),
    mechanical: new Set([
        'padding-line-between-statements',
        'indent',
        'no-trailing-spaces',
        'operator-linebreak',
        'resilient/operator-linebreak',
        'object-curly-newline',
        'max-len',
        'unused-disable-directive'
    ])
});

const TRIAGE_GUIDANCE = Object.freeze({
    grammar: 'Lower to the Resilient grammar. Use a narrow exception only when the source construct carries intent that the canonical form would erase.',
    agreement: 'Resolve or expose the contract at the boundary. Do not invent defaults; an opaque callee may own its agreement check when the reason is explicit.',
    policy: 'Lower toward immutable flow, falsifiable primitives, and explicit declaration order. Exceptions are limited to async or demonstrably necessary complexity cases.',
    mechanical: 'Run the artifact fix pass. Remaining findings are output-shape defects only if the fixer cannot safely rewrite them.',
    review: 'Inspect the rule and source construct before choosing a lowering or exception.'
});

const getTriageCategory = (rule = '') => {
    const matches = Object.entries(TRIAGE_RULES).filter(([, rules = new Set()] = []) => rules.has(rule));
    const [entry = []] = matches;
    const [category = 'review'] = entry;

    return category;
};

const getLintTriage = (results = []) => {
    const records = results.flatMap(({ filePath = '', messages: fileMessages = [] } = {}) => fileMessages.map((message = {}) => ({
        category: getTriageCategory(getDiagnosticRule(message)),
        filePath,
        message,
        rule: getDiagnosticRule(message)
    })));
    const categories = Object.fromEntries([...new Set([...Object.keys(TRIAGE_RULES), 'review'])].map((category) => {
        const categoryRecords = records.filter(({ category: recordCategory = '' } = {}) => recordCategory === category);
        const byRule = Object.fromEntries([...new Set(categoryRecords.map(({ rule = '' } = {}) => rule))].toSorted().map((rule) => {
            const ruleRecords = categoryRecords.filter(({ rule: recordRule = '' } = {}) => recordRule === rule);

            return [rule, {
                violations: ruleRecords.length,
                errors: ruleRecords.filter(({ message: { severity = 0 } = {} } = {}) => severity === 2).length,
                warnings: ruleRecords.filter(({ message: { severity = 0 } = {} } = {}) => severity === 1).length,
                examples: ruleRecords.slice(0, 3).map(({ filePath = '', message: { line = 0, column = 0, message = '' } = {} } = {}) => ({
                    file: filePath,
                    line,
                    column,
                    message
                }))
            }];
        }));

        return [category, {
            violations: categoryRecords.length,
            errors: categoryRecords.filter(({ message: { severity = 0 } = {} } = {}) => severity === 2).length,
            warnings: categoryRecords.filter(({ message: { severity = 0 } = {} } = {}) => severity === 1).length,
            guidance: TRIAGE_GUIDANCE[category],
            byRule
        }];
    }));

    return {
        violations: records.length,
        errors: records.filter(({ message: { severity = 0 } = {} } = {}) => severity === 2).length,
        warnings: records.filter(({ message: { severity = 0 } = {} } = {}) => severity === 1).length,
        categories
    };
};

const getDynamicKeyExpressions = (line = '') => [...line.matchAll(/\[([^\]\n]+)\]/g)]
    .map(([, expression = ''] = []) => expression.trim())
    .filter(Boolean);

const getDynamicBoundaryLedger = ({ directory = '' } = {}) => readdirSync(directory)
    .filter(name => name.endsWith('.js'))
    .toSorted()
    .flatMap((name = '') => {
        const file = path.join(directory, name);
        const lines = read(file).split('\n');

        return lines.flatMap((line = '', index) => {
            const mutation = line.includes('Dynamic indexed write/delete retains source key.');
            const readBoundary = line.includes('indexed access retained to preserve explicit key semantics');

            if (!mutation && !readBoundary) return [];

            const targetIndex = mutation ? index + 1 : index;
            const [targetLine = ''] = lines.slice(targetIndex, targetIndex + 1);
            const rules = mutation
                ? [
                    'resilient/prefer-destructured-member-access',
                    'prefer-destructuring',
                    'resilient/prefer-safe-transformations'
                ]
                : ['resilient/prefer-destructured-member-access', 'prefer-destructuring'];

            return getDynamicKeyExpressions(targetLine).map(keyExpression => ({
                file,
                line: targetIndex + 1,
                kind: mutation ? 'dynamic-write-boundary' : 'dynamic-read-boundary',
                keyExpression,
                directive: line.trim(),
                rules,
                nextOwner: mutation
                    ? 'structural-transformation-review'
                    : 'retained-dynamic-read'
            }));
        });
    });

// Agreements are emitted by independent lowering passes. Keep one artifact-level
// inventory so a lint site can be traced back to the checker-backed decision
// that produced it, rather than treated as an anonymous post-print failure.
const getAgreementLedgerAction = ({ action = '', canonical = '', site = '', name = '', evidence = [], next = '' } = {}) => {
    if (action === 'guarded-function' || action === 'guarded-tuple') return {
        action: 'guarded-consumer', next: next || 'consumer agreement is complete'
    };

    if (action === 'guarded-tree-provider-model') return {
        action: 'selected-model-binding', next: next || 'Tree model agreement is complete'
    };

    if (action === 'provider-forwarded') return {
        action: 'provider-forwarding', next: next || 'source-time identity forwarding agreement is complete'
    };

    if (action === 'slang-required-function-provider-edge') return {
        action: 'narrow-provider-slang', next: next || 'resolve callability at the actual consumer'
    };

    if (canonical) return {
        action: 'resolved-default', next: next || 'binding family agreement is complete'
    };

    const detail = Array.isArray(evidence) ? evidence.join(' ') : '';
    const tupleSite = site.includes('array') || detail.includes('tuple');
    const modelPayload = detail.includes('generic payload') || ['value', 'left', 'right'].includes(name);

    if (tupleSite) return {
        action: 'named-resolver-stage', next: next || 'tuple consumer input and callback-result agreement'
    };

    if (modelPayload) return {
        action: 'named-resolver-stage', next: next || 'selected-model or consumer agreement for exact payload identity'
    };

    return { action: 'named-resolver-stage', next: next || 'checker and resolver agreement for retained binding' };
};

const getAgreementLedger = ({ manifest = [] } = {}) => manifest
    .flatMap(({ file = '', source = '', generated = '', agreements = [] } = {}) => (
        agreements.map(({
            action = '', state = '', owner = '', site = '', name = '',
            factory = '', member = '', canonical = '', sourceRange = '', evidence = [], next = ''
        } = {}) => {
            const { action: ledgerAction = '', next: ledgerNext = '' } = getAgreementLedgerAction({
                action, canonical, site, name, evidence, next
            });

            return {
                file,
                source,
                generated,
                action: ledgerAction,
                transformAction: action,
                state,
                owner,
                site,
                sourceRange,
                name,
                factory,
                member,
                canonical,
                evidence: Array.isArray(evidence) ? evidence.filter(Boolean) : [],
                next: ledgerNext
            };
        })
    ))
    .toSorted(({ file: leftFile = '', action: leftAction = '', site: leftSite = '', name: leftName = '' } = {}, {
        file: rightFile = '', action: rightAction = '', site: rightSite = '', name: rightName = ''
    } = {}) => (
        `${leftFile}:${leftAction}:${leftSite}:${leftName}`.localeCompare(
            `${rightFile}:${rightAction}:${rightSite}:${rightName}`
        )
    ));

export { getLintSummary, getLintTriage, getDynamicBoundaryLedger, getAgreementLedger };
