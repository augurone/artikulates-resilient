import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { Linter } from 'eslint';
import typescript from 'typescript';

import resilient from 'eslint-plugin-resilient';

import * as current from '../transforms/utils/ast-boundary.js';

const url = new URL('../transforms/utils/ast-boundary.js', import.meta.url);
const source = readFileSync(url, 'utf8');
// Execute the former omission form of these exact factory boundaries. This
// differential protects Get order, native null failure and receiver identity;
// the ordinary AST suite separately proves printing and original-node links.
assert.equal([...source.matchAll(/ = undefined/gu)].length, 15);
const previousSource = source.replace(/ = undefined/gu, '').replace(/from '([^']+)'/gu,
    (match, relative) => `from ${JSON.stringify(new URL(relative, url).href)}`);
const previous = await import(`data:text/javascript;base64,${Buffer.from(previousSource).toString('base64')}`);
const parse = (code = '') => typescript.createSourceFile('omission.ts', code, typescript.ScriptTarget.ESNext, true);
const { statements: [variable = {}, callStatement = {}, conditional = {}, fn = {}, arrowStatement = {}] = [] } = parse([
    'const { key: value, ...rest } = input;',
    'invoke(value);',
    'if (ready) run();',
    'export function* named<T>(value: T): Iterable<T> { yield value; }',
    'const arrow = value => value;'
].join('\n'));
const { declarationList = {} } = variable;
const { declarations: [declaration = {}] = [] } = declarationList;
const { name: pattern = {} } = declaration;
const { elements: [element = {}] = [] } = pattern;
const { expression: call = {} } = callStatement;
const { declarationList: { declarations: [{ initializer: arrow = {} } = {}] = [] } = {} } = arrowStatement;
const cases = [
    { owner: 'updateVariableDeclarationFields', node: declaration, fields: ['exclamationToken', 'type'],
        options: node => ({ declaration: node, name: Reflect.get(node, 'name') }) },
    { owner: 'updateVariableInitializer', node: variable, fields: ['modifiers'],
        options: node => ({ collection: { statement: node, declarationList, declaration } }) },
    { owner: 'updateVariableInitializer', node: declaration, fields: ['exclamationToken', 'type'],
        options: node => ({ collection: { statement: variable, declarationList, declaration: node } }) },
    { owner: 'updateBindingInitializer', node: element, fields: ['dotDotDotToken', 'propertyName'],
        options: node => ({ element: node }) },
    { owner: 'updateCallArguments', node: call, fields: ['typeArguments'], options: node => ({ call: node }) },
    { owner: 'updateIfBranches', node: conditional, fields: ['elseStatement'],
        options: node => ({ statement: node, transform: branch => branch }) },
    ...[fn, arrow].map(node => ({ owner: 'updateFunction', node,
        fields: ['body', 'modifiers', 'asteriskToken', 'name', 'typeParameters', 'type', 'equalsGreaterThanToken'],
        options: value => ({ node: value, parameters: Reflect.get(value, 'parameters'), body: Reflect.get(value, 'body') }) }))
];
const missing = () => { throw new Error('Missing omission proof operation.'); };
cases.forEach(({ owner = '', node = {}, fields = [], options = missing } = {}) => {
    const failure = new Error(`${owner}: abrupt completion`);
    const observe = ({ module = {}, field = '', mode = '', factoryMode = '' } = {}) => {
        let events = [];
        const input = mode === 'null-node' ? JSON.parse('null') : new Proxy(node, { get(target = {}, key = '') {
            events = [...events, `node.${String(key)}`];

            if (key === field && mode === 'throw') throw failure;

            if (key === field && mode === 'null') return JSON.parse('null');

            if (key === field && mode === 'undefined') return Reflect.get({}, 'omitted');

            return Reflect.get(target, key);
        } });
        const factory = new Proxy(typescript.factory, { get(target = {}, key = '') {
            const method = Reflect.get(target, key);
            events = [...events, `factory.${String(key)}`];

            if (factoryMode === 'get') throw failure;

            if (factoryMode === 'noncallable') return Reflect.get({ method: 0 }, 'method');

            if (typeof method !== 'function') return method;

            return function(...args) {
                assert.equal(this, factory);
                events = [...events, `call.${String(key)}`];

                if (factoryMode === 'call') throw failure;

                return Reflect.apply(method, typescript.factory, args);
            };
        } });
        const operation = Reflect.get(module, owner);
        try {
            const result = operation({ ...options(input), factory, typescript: { ...typescript, factory } });

            return { events, same: result === input, kind: Reflect.get(result, 'kind') };
        } catch (error) {
            const { name = '', message = '' } = error;

            return { events, name, message, exact: error === failure };
        }
    };
    const probes = [
        {}, { mode: 'null-node' },
        ...fields.flatMap(field => ['undefined', 'null', 'throw'].map(mode => ({ field, mode }))),
        ...['get', 'call', 'noncallable'].map(factoryMode => ({ factoryMode }))
    ];
    probes.forEach(probe => assert.deepEqual(observe({ ...probe, module: current }),
        observe({ ...probe, module: previous }), `${owner}: ${JSON.stringify(probe)}`));
});
const linter = new Linter();
assert.deepEqual(linter.verify(source, {
    plugins: { resilient }, rules: {
        'resilient/prefer-safe-destructuring-defaults': 'error',
        'resilient/no-undefined-assignment': 'error'
    }
}), []);
