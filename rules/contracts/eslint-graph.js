import fs from 'node:fs';
import path from 'node:path';

import { Linter } from 'eslint';

import {
    createContractGraph,
    getModuleSources
} from './module-graph.js';

const getExistingFile = (fileName = '') => {
    try {
        return fs.statSync(fileName).isFile() ? fileName : '';
    } catch {
        return '';
    }
};

const getLocalImportFile = ({ fileName = '', source = '' } = {}) => {
    if (!fileName || fileName.startsWith('<') || !source.startsWith('.')) return '';
    const base = path.resolve(path.dirname(fileName), source);
    const candidates = [base, `${base}.js`, `${base}.jsx`, path.join(base, 'index.js')];
    return candidates.map(getExistingFile).find(Boolean) || '';
};

const getLanguageOptions = ({ context = {} } = {}) => {
    const {
        languageOptions = {},
        parserOptions = {}
    } = context;
    const {
        ecmaVersion = 'latest',
        sourceType = 'module',
        parser = {}
    } = languageOptions;
    const options = {
        ecmaVersion,
        sourceType,
        parserOptions: {
            ...parserOptions,
            ...(languageOptions.parserOptions || {})
        }
    };
    if (parser && typeof parser.parse === 'function') options.parser = parser;
    return options;
};

const parseProgram = ({ code = '', context = {} } = {}) => {
    let program = {};
    const capture = {
        rules: {
            program: {
                create: () => ({
                    Program: (node) => {
                        program = node;
                    }
                })
            }
        }
    };
    const linter = new Linter({ configType: 'flat' });
    const messages = linter.verify(code, {
        languageOptions: getLanguageOptions({ context }),
        plugins: { capture },
        rules: { 'capture/program': 'error' }
    });
    return messages.some(({ severity = 0 } = {}) => severity === 2) ? {} : program;
};

const getFileName = ({ context = {} } = {}) => {
    const fileName = typeof context.getFilename === 'function'
        ? context.getFilename()
        : '';
    if (!fileName) return '<text>';
    return fileName.startsWith('<') ? fileName : path.resolve(fileName);
};

const getImportedProgram = ({ importedFile = '', context = {} } = {}) => {
    try {
        const code = fs.readFileSync(importedFile, 'utf8');
        return parseProgram({ code, context });
    } catch {
        return {};
    }
};

const getPendingPrograms = ({
    context = {},
    currentFile = '',
    currentProgram = {},
    pending = [],
    programs = {}
} = {}) => getModuleSources(currentProgram).reduce((queue = [], source = '') => {
    const importedFile = getLocalImportFile({ fileName: currentFile, source });
    if (!importedFile || programs[importedFile]) return queue;
    const importedProgram = getImportedProgram({ importedFile, context });
    return importedProgram.type
        ? [...queue, { fileName: importedFile, program: importedProgram }]
        : queue;
}, pending);

const loadPrograms = ({ context = {}, program = {}, fileName = '' } = {}) => {
    const programs = {};
    const process = (pending = []) => {
        if (!pending.length) return programs;
        const [current = {}, ...remaining] = pending;
        const {
            fileName: currentFile = '',
            program: currentProgram = {}
        } = current;
        if (!currentFile || programs[currentFile]) return process(remaining);
        programs[currentFile] = currentProgram;
        return process(getPendingPrograms({
            context,
            currentFile,
            currentProgram,
            pending: remaining,
            programs
        }));
    };

    return process([{ fileName, program }]);
};

const getEslintContractDiagnostics = ({
    context = {},
    program = {},
    ruleId = ''
} = {}) => {
    const fileName = getFileName({ context });
    if (!fileName) return [];
    const graph = createContractGraph({
        programs: loadPrograms({ context, program, fileName })
    });
    const document = graph.getDocument(fileName);
    return document.getDiagnostics()
        .filter(({ ruleId: diagnosticRuleId = '' } = {}) => diagnosticRuleId === ruleId);
};

export {
    getEslintContractDiagnostics,
    loadPrograms
};
