#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';

import {
    createContractGraph,
    getModuleSources
} from 'eslint-plugin-resilient/contracts';

import { createProgramCapture } from '../rules/support/eslint-program.js';
import { getFileCandidates } from '../rules/support/file-candidates.js';

const getArgument = ({ options = [], name = '', fallback = '' } = {}) => {
    const index = options.indexOf(name);
    const { [index + 1]: next = fallback } = options;

    return index >= 0 ? next || fallback : fallback;
};

const getDisplayName = (fileName = '') => path.relative(process.cwd(), fileName) || path.basename(fileName);

const getExistingFile = async (fileName = '') => {
    try {
        const stats = await fs.stat(fileName);

        return stats.isFile() ? fileName : '';
    } catch {
        return '';
    }
};

const getLocalImportFile = async ({ fileName = '', source = '' } = {}) => {
    if (!source.startsWith('.')) return '';

    const base = path.resolve(path.dirname(fileName), source);
    const candidates = getFileCandidates({ base });
    // eslint-disable-next-line resilient/prefer-prototype-methods -- Extension probing preserves Node resolution order.
    for (const candidate of candidates) {
        const existingFile = await getExistingFile(candidate);

        if (existingFile) return existingFile;
    }

    return '';
};

const loadWorkspace = async ({ fileName = '' } = {}) => {
    const captureProgram = createProgramCapture();
    const rootFile = path.resolve(fileName);
    const rootDisplayName = getDisplayName(rootFile);
    const pending = [{ fileName: rootFile, displayName: rootDisplayName }];
    let pendingIndex = 0;
    const visited = new Set();
    let programs = {};
    let rootCode = '';

    // eslint-disable-next-line resilient/prefer-prototype-methods -- Breadth-first workspace discovery preserves import traversal order.
    while (pendingIndex < pending.length) {
        const { [pendingIndex]: current = {} } = pending;
        const { fileName: currentFile = '', displayName = '' } = current;
        pendingIndex += 1;

        if (visited.has(currentFile)) continue;

        // eslint-disable-next-line resilient/prefer-safe-transformations -- The private per-workspace visited index avoids copying prior filenames at every discovery and is never published.
        visited.add(currentFile);
        const code = await fs.readFile(currentFile, 'utf8');

        if (currentFile === rootFile) rootCode = code;

        const program = await captureProgram(code, { fileName: displayName });
        programs = {
            ...programs,
            [displayName]: program
        };
        const sources = getModuleSources(program);
        // eslint-disable-next-line resilient/prefer-prototype-methods -- Import resolution appends discovered modules in source order.
        for (const source of sources) {
            const importedFile = await getLocalImportFile({ fileName: currentFile, source });

            if (!importedFile) continue;

            // eslint-disable-next-line resilient/prefer-safe-transformations -- The private live BFS queue appends discoveries without copying the growing frontier or publishing traversal state.
            pending.push({
                fileName: importedFile,
                displayName: getDisplayName(importedFile)
            });
        }
    }

    return { programs, rootCode, rootDisplayName };
};

const getOffset = ({ code = '', options = [] } = {}) => {
    const explicitOffset = getArgument({ options, name: '--offset', fallback: '' });

    if (explicitOffset) return Number(explicitOffset);

    const needle = getArgument({ options, name: '--find', fallback: '' });

    return needle ? code.indexOf(needle) : -1;
};

const simplifyFrame = ({
    kind = '',
    fileName = '',
    name = '',
    range = [],
    loc = {},
    signature: { contract: { kind: parameterKind = 'unknown' } = {} } = {},
    returnContract: { kind: returnKind = 'unknown' } = {},
    contract: { kind: expressionKind = 'unknown' } = {},
    evidenceIds = []
} = {}) => {
    return {
        kind,
        ...(fileName && { fileName }),
        ...(name && { name }),
        range,
        loc,
        ...(kind === 'function' && {
            parameterContract: parameterKind,
            returnContract: returnKind
        }),
        ...(kind === 'expression' && { contract: expressionKind }),
        ...(Array.isArray(evidenceIds) && { evidenceIds: [...evidenceIds] })
    };
};

const simplifyDiagnostic = ({
    ruleId = '',
    message = '',
    range = [],
    loc = {},
    evidenceIds = [],
    stack: { frames = [] } = {}
} = {}) => ({
    ruleId,
    message,
    range,
    loc,
    evidenceIds,
    stack: frames.map(simplifyFrame)
});

const run = async () => {
    const commandLine = process.argv.slice(2);
    const [fileName = '', ...options] = commandLine;

    if (!fileName) {
        process.stderr.write('Usage: node scripts/inspect-stack.js <file> [--find text | --offset number] [--diagnostics] [--evidence]\n');
        process.exit(1);

        return;
    }

    const workspace = await loadWorkspace({ fileName });
    const {
        programs = {},
        rootCode: code = '',
        rootDisplayName = ''
    } = workspace;
    const offset = getOffset({ code, options });

    if (offset < 0) {
        process.stderr.write('Provide --find text or --offset number for a source position.\n');
        process.exit(1);

        return;
    }

    const graph = createContractGraph({ programs });
    const document = graph.getDocument(rootDisplayName);
    const stack = document.getStackAtOffset(offset);
    const { frames = [] } = stack;
    const {
        getDiagnosticsAtOffset = false,
        getEvidenceAtOffset = false
    } = document;
    const includeDiagnostics = options.includes('--diagnostics');
    const includeEvidence = options.includes('--evidence');
    const result = {
        offset,
        stack: frames.map(simplifyFrame),
        ...(includeDiagnostics && {
            diagnostics: getDiagnosticsAtOffset.call(document, offset).map(simplifyDiagnostic)
        }),
        ...(includeEvidence && {
            evidence: getEvidenceAtOffset.call(document, offset)
        })
    };
    process.stdout.write(`${JSON.stringify(result, null, 4)}\n`);
};

run().catch((error) => {
    process.stderr.write(`${String(error)}\n`);
    process.exit(1);
});
