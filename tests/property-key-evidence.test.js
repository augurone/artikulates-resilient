import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import test from 'node:test';

import { parse } from 'espree';

import { createAnalysis } from '../analysis/analyzer/analysis.js';
import { indexBindings } from '../analysis/analyzer/bindings.js';
import { acquireMemberBoundaries } from '../analysis/analyzer/member-boundaries.js';
import { propertyName } from '../analysis/estree-properties.js';

const membersFor = (source) => {
    const program = parse(source, { ecmaVersion: 'latest', sourceType: 'module', range: true, loc: true });
    const index = indexBindings({ program });
    const { memberAccesses = [], contextFor } = index;

    return { members: memberAccesses.map(({ node = {} } = {}) => node), boundaries: acquireMemberBoundaries(index, contextFor) };
};

test('property evidence distinguishes unknown names from known empty and zero names', () => {
    deepStrictEqual(propertyName({ computed: true, key: { type: 'Identifier', name: 'key' } }), { known: false });
    deepStrictEqual(propertyName({ computed: true, key: { type: 'Literal', value: '' } }), { known: true, name: '' });
    deepStrictEqual(propertyName({ computed: true, key: { type: 'Literal', value: 0 } }), { known: true, name: '0' });
});

test('owned method lookup requires a known key, independently of syntax policy', () => {
    ["''", '0', 'key'].forEach((key) => {
        const { members = [], boundaries = {} } = membersFor(`const sink = { '': value => !value, 0: value => !value }; sink[${key}];`);
        const [member = {}] = members;

        strictEqual(Boolean(boundaries.ownedMethodFor(member)), key !== 'key');
    });
});

test('unknown method invocation retires the receiver while known empty method invocation remains exact evidence', () => {
    ["''", 'key'].forEach((key) => {
        const { members = [], boundaries = {} } = membersFor(`const sink = { '': value => !value, read: value => !value }; sink[${key}](); sink.read;`);
        const member = members.at(-1);

        strictEqual(Boolean(boundaries.ownedMethodFor(member)), key !== 'key');
    });
});

test('a known empty array property is not an unknown native callback selection', () => {
    ["''", 'key'].forEach((key) => {
        const analysis = createAnalysis({ source: `const run = ({ cb } = {}) => { if (cb) [][${key}](cb); };` });
        const declaration = analysis.declarations.find(({ name = '' } = {}) => name === 'cb');

        strictEqual(analysis.checkDeclaration(declaration).required, key === 'key');
    });
});
