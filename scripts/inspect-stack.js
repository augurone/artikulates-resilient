import fs from 'node:fs/promises';
import path from 'node:path';

import { ESLint } from 'eslint';

import {
    createContractGraph,
    getModuleSources
} from 'eslint-plugin-resilient/contracts';

const getArgument = ({ options = [], name = '', fallback = '' } = {}) => {
    const index = options.indexOf(name);
    const { [index + 1]: next = fallback } = options;

    return index >= 0 ? next || fallback : fallback;
};

const getProgram = async ({ code = '', fileName = '' } = {}) => {
    let program = {};
    const capture = {
        rules: {
            capture: {
                create: () => ({
                    Program: (node) => {
                        program = node;
                    }
                })
            }
        }
    };
    const eslint = new ESLint({
        overrideConfigFile: true,
        overrideConfig: [{
            plugins: { capture },
            rules: { 'capture/capture': 'error' }
        }]
    });

    await eslint.lintText(code, { filePath: fileName });

    return program;
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
    const candidates = [base, `${base}.js`, `${base}.jsx`, path.join(base, 'index.js')];
    for (const candidate of candidates) {
        const existingFile = await getExistingFile(candidate);

        if (existingFile) return existingFile;
    }

    return '';
};

const loadWorkspace = async ({ fileName = '' } = {}) => {
    const rootFile = path.resolve(fileName);
    const rootDisplayName = getDisplayName(rootFile);
    const pending = [{ fileName: rootFile, displayName: rootDisplayName }];
    let pendingIndex = 0;
    const visited = new Set();
    let programs = {};
    let rootCode = '';

    while (pendingIndex < pending.length) {
        const { [pendingIndex]: current = {} } = pending;
        const { fileName: currentFile = '', displayName = '' } = current;
        pendingIndex += 1;

        if (visited.has(currentFile)) continue;

        // eslint-disable-next-line resilient/prefer-safe-transformations -- This private traversal set records visited files and never mutates source data.
        visited.add(currentFile);
        const code = await fs.readFile(currentFile, 'utf8');

        if (currentFile === rootFile) rootCode = code;

        const program = await getProgram({ code, fileName: displayName });
        programs = {
            ...programs,
            [displayName]: program
        };
        const sources = getModuleSources(program);
        for (const source of sources) {
            const importedFile = await getLocalImportFile({ fileName: currentFile, source });

            if (!importedFile) continue;

            // eslint-disable-next-line resilient/prefer-safe-transformations -- This private BFS queue is append-only and owns its traversal state.
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
    contract: { kind: expressionKind = 'unknown' } = {}
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
        ...(kind === 'expression' && { contract: expressionKind })
    };
};

const simplifyDiagnostic = ({
    ruleId = '',
    message = '',
    range = [],
    loc = {},
    stack: { frames = [] } = {}
} = {}) => ({
    ruleId,
    message,
    range,
    loc,
    stack: frames.map(simplifyFrame)
});

const run = async () => {
    const commandLine = process.argv.slice(2);
    const [fileName = '', ...options] = commandLine;

    if (!fileName) {
        process.stderr.write('Usage: node scripts/inspect-stack.js <file> [--find text | --offset number]\n');
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
    const { getDiagnosticsAtOffset = false } = document;
    const includeDiagnostics = options.includes('--diagnostics');
    const result = {
        offset,
        stack: frames.map(simplifyFrame),
        ...(includeDiagnostics && {
            diagnostics: getDiagnosticsAtOffset.call(document, offset).map(simplifyDiagnostic)
        })
    };
    process.stdout.write(`${JSON.stringify(result, null, 4)}\n`);
};

run().catch((error) => {
    process.stderr.write(`${String(error)}\n`);
    process.exit(1);
});
