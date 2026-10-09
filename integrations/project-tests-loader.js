import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import typescript from 'typescript';

import { createProjectTestRouting, testCompilerOptions } from './project-tests-routing.js';

let routing;
let options;

const withSuffix = (file, url) => {
    const { href = '' } = pathToFileURL(file);
    const { search = '', hash = '' } = new URL(url);

    return href + search + hash;
};

export const initialize = ({ compilerOptions = {}, ...configuration } = {}) => {
    routing = createProjectTestRouting({ ...configuration, compilerOptions });
    options = compilerOptions;
};
export const resolve = async (specifier, context, next) => {
    const { parentURL = '' } = context;
    const fileParent = parentURL.startsWith('file:');
    const fileRequest = fileParent && ['file:', './', '../', '/'].some(prefix => specifier.startsWith(prefix));
    const requested = fileRequest ? new URL(specifier, parentURL).href : '';
    const physicalRequest = requested ? specifier.replace(/[?#].*$/su, '') : specifier;
    const destination = fileParent ? routing.route(physicalRequest, parentURL) : '';

    if (destination) return { url: requested ? withSuffix(destination, requested) : pathToFileURL(destination).href, shortCircuit: true };

    const parent = fileParent ? routing.original(parentURL) : '';
    const result = await next(specifier, parent ? { ...context, parentURL: withSuffix(parent, parentURL) } : context);

    const { url = '' } = result;

    if (url.startsWith('file:')) routing.guard(url);

    return result;
};
export const load = async (url, context, next) => {
    if (!url.startsWith('file:')) return next(url, context);

    const file = routing.loaded(url);

    if (!/\.tsx?$/u.test(file)) return next(url, context);

    const { outputText = '', diagnostics = [] } = typescript.transpileModule(readFileSync(file, 'utf8'), {
        fileName: file, compilerOptions: testCompilerOptions({ options }), reportDiagnostics: true
    });

    if (diagnostics.length) throw new Error(`Cannot prepare test module: ${file}: ${diagnostics
        .map(({ messageText = '' } = {}) => typescript.flattenDiagnosticMessageText(messageText, '\n')).join('; ')}`);

    return { format: 'module', source: outputText, shortCircuit: true };
};
