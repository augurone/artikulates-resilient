import { strictEqual, deepStrictEqual, ok } from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { parse } from 'espree';

import * as publicAPI from 'eslint-plugin-resilient/agreement';
import * as analyzerAPI from 'eslint-plugin-resilient/analyzer';

import { sourceFiles } from './support/files.js';

const modules = sourceFiles().map(({ name = '', url = '' } = {}) => {
    const { body = [] } = parse(readFileSync(new URL(url), 'utf8'), { ecmaVersion: 'latest', sourceType: 'module' });
    const dependencies = body.filter(({ type = '', source = false } = {}) => source && ['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(type))
        .map(({ source: { value = '' } = {} } = {}) => value)
        .filter(value => value.startsWith('.'))
        .map(value => new URL(value, url).href);

    return { name, url, body, dependencies };
});
const byURL = new Map(modules.map((module) => {
    const { url = '' } = module;

    return [url, module];
}));

test('the public facade preserves the supported API and owns no internal state', () => {
    deepStrictEqual(Object.keys(publicAPI), [
        'absent', 'all', 'content', 'createContext', 'createOwner', 'family', 'familyEvidence', 'field',
        'fromESTree', 'inspect', 'isCurrent', 'producer', 'readFamily', 'readField', 'receiver', 'record', 'reference',
        'replaceAll', 'replaceEvidence', 'request', 'unresolved'
    ]);

    const { body = [] } = modules.find(({ name = '' } = {}) => name === 'agreement/index.js');

    body.forEach(({ type = '', source = false } = {}) => {
        strictEqual(type, 'ExportNamedDeclaration');
        ok(source, 'The public facade must re-export explicit names without defining state or algorithms');
    });
});

test('implementation modules form an acyclic graph contained in analysis', () => {
    const visit = ({ url = '', path = [] } = {}) => {
        ok(!path.includes(url), `Circular dependency: ${[...path, url].join(' -> ')}`);
        ok(byURL.has(url), `Dependency escapes the source module graph: ${url}`);

        const { dependencies = [] } = byURL.get(url);

        dependencies.forEach(dependency => visit({ url: dependency, path: [...path, url] }));
    };

    modules.forEach(({ url = '' } = {}) => visit({ url }));
});

test('utilities and source ownership do not depend on consumer evaluation', () => {
    const utilities = ['collections.js', 'traversal.js', 'agreement/causes.js', 'agreement/collections.js',
        'agreement/families.js', 'agreement/observation.js', 'agreement/estree.js', 'agreement/source-owners.js', 'agreement/validity.js'];

    modules.filter(({ name = '' } = {}) => utilities.includes(name))
        .forEach(({ name = '', dependencies = [] } = {}) => dependencies.forEach((url) => {
            const { name: dependency = '' } = byURL.get(url);

            const allowed = ['collections.js', 'traversal.js', 'agreement/causes.js', 'agreement/collections.js', 'agreement/families.js',
                'agreement/observation.js', 'agreement/estree.js', 'agreement/validity.js'];

            ok(allowed.includes(dependency), `${name} must not depend on domain evaluation through ${dependency}`);
        }));
});

test('the analyzer consumes the public agreement boundary and only the declared parser dependency', () => {
    deepStrictEqual(Object.keys(analyzerAPI), ['createAnalysis', 'createProgramAnalysis']);

    modules.filter(({ name = '' } = {}) => name.startsWith('analyzer/')).forEach(({ body = [], dependencies = [] } = {}) => {
        dependencies.forEach((url) => {
            const { name = '' } = byURL.get(url);

            ok(name.startsWith('analyzer/') || ['collections.js', 'traversal.js', 'estree-properties.js', 'estree-patterns.js', 'promise-chains.js'].includes(name),
                'Analyzer modules cannot import agreement internals');
        });
        body.filter(({ type = '' } = {}) => type === 'ImportDeclaration').forEach(({ source: { value = '' } = {} } = {}) => {
            ok(value.startsWith('.') || ['espree', 'eslint-plugin-resilient/agreement'].includes(value), `Unexpected analyzer dependency: ${value}`);
        });
    });
});

test('product ESLint rules consume the public analyzer without a legacy checker dependency', () => {
    modules.filter(({ name = '' } = {}) => name.startsWith('eslint/')).forEach(({ name: moduleName = '', body = [], dependencies = [] } = {}) => {
        dependencies.forEach((url) => {
            const { name = '' } = byURL.get(url);

            ok(name.startsWith('eslint/') || ['collections.js', 'traversal.js', 'estree-properties.js', 'estree-patterns.js', 'promise-chains.js'].includes(name),
                'Rules cannot reach into analyzer or agreement internals');
        });
        body.filter(({ type = '' } = {}) => type === 'ImportDeclaration').forEach(({ source: { value = '' } = {} } = {}) => {
            ok(value.startsWith('.') || ['eslint-plugin-resilient/analyzer', 'eslint/use-at-your-own-risk'].includes(value) ||
                (moduleName === 'eslint/support/modules.js' && ['node:fs', 'node:path'].includes(value)), `Unexpected rule dependency: ${value}`);
        });
    });
});
