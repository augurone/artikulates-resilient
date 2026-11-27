import { deepStrictEqual, strictEqual, throws } from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

import { parse } from 'espree';

import { createAnalysis } from '../analysis/analyzer/analysis.js';
import { indexBindings } from '../analysis/analyzer/bindings.js';
import { acquireMemberBoundaries } from '../analysis/analyzer/member-boundaries.js';
import { propertyName, sourcePropertyName } from '../analysis/estree-properties.js';

// Owned field/slot selection, presence, writer order and completion share the shape boundary. Preserve explicit unknown selections, native controls, revisions and resource/retention laws.

{
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

    test('inert computed key spellings share record and slot evidence', () => {
        [
            'const {name=""}={[`name`]:42};name.trim();',
            'const items=[{name:42}];items[-0].name.trim();',
            'const items=[{name:42}];items[0n].name.trim();',
            'const items=[{name:42}];items[-0n].name.trim();',
            'const {name=""}={[-1n]:{name:42}}[-1n];name.trim();'
        ].forEach((source) => {
            const analysis = createAnalysis({ source });
            const { index = -1 } = analysis.memberAccesses.find(({ name = '' } = {}) => name === 'trim');

            deepStrictEqual(analysis.checkMemberAccess({ index }).conflicts, ['number']);
        });
    });

    test('signed BigInt property keys normalize independently of numeric arithmetic and spelling policy', () => {
        ['0n', '-0n', '1n', '-1n'].forEach((source) => {
            const { body: [{ expression: key = {} } = {}] = [] } = parse(source, { ecmaVersion: 'latest' });
            const name = String(runInNewContext(source));

            deepStrictEqual(sourcePropertyName({ computed: true, key }), { known: true, name });
            deepStrictEqual(propertyName({ computed: true, key }), { known: false });
            ['42', '"ok"'].forEach((payload, position) => {
                const code = `const items={${JSON.stringify(name)}:{name:${payload}}};items[${source}].name.trim();`;
                const analysis = createAnalysis({ source: code });
                const { index = -1 } = analysis.memberAccesses.find(({ name = '' } = {}) => name === 'trim');

                deepStrictEqual(analysis.checkMemberAccess({ index }).conflicts, position ? [] : ['number']);

                if (position) strictEqual(runInNewContext(code), 'ok');

                if (!position) throws(() => runInNewContext(code), ({ name = '' } = {}) => name === 'TypeError');
            });
        });
        ['+0n', '+1n', '-external', '-read()'].forEach((source) => {
            const { body: [{ expression: key = {} } = {}] = [] } = parse(source, { ecmaVersion: 'latest' });

            deepStrictEqual(sourcePropertyName({ computed: true, key }), { known: false });
        });
        ['+0n', '+1n'].forEach(source => throws(() => runInNewContext(source), ({ name = '' } = {}) => name === 'TypeError'));
    });

    test('literal and computed BigInt keys select the same payload and last writer', () => {
        ['0n', '1n', '0x1n'].forEach((key) => {
            const name = String(runInNewContext(key));
            const { body: [{ expression: literal = {} } = {}] = [] } = parse(key, { ecmaVersion: 'latest' });

            deepStrictEqual(sourcePropertyName({ key: literal }), { known: true, name });
            deepStrictEqual(propertyName({ key: literal }), { known: false });
            ['42', '"ok"'].forEach((payload, position) => {
                [
                    `const items={${key}:{name:${payload}}};items[${key}].name.trim();`,
                    `const items={${key}:{name:${payload}}};const {${key}:item={}}=items;item.name.trim();`,
                    `const items={${key}:{name:0},[${JSON.stringify(name)}]:{name:${payload}}};items[${key}].name.trim();`,
                    `const items={[${key}]:{name:0},${key}:{name:${payload}}};items[${key}].name.trim();`
                ].forEach((source) => {
                    const analysis = createAnalysis({ source });
                    const { index = -1 } = analysis.memberAccesses.find(({ name = '' } = {}) => name === 'trim');

                    deepStrictEqual(analysis.checkMemberAccess({ index }).conflicts, position ? [] : ['number'], source);

                    if (position) strictEqual(runInNewContext(source), 'ok');

                    if (!position) throws(() => runInNewContext(source), ({ name = '' } = {}) => name === 'TypeError');
                });
            });
        });
    });

    test('computed invocation keys preserve shared selections beside unknown across joins and source revisions', () => {
        const sourceFor = (payload, width) => [
            "const field='title';",
            "const read=(field='',data={})=>{const {[field]:selected=''}=data;return selected;};",
            `const first=read(field,{title:${payload},saved:'keep'});`,
            "const second=read('title',{title:first});",
            "const {[field]:omitted='',...remaining}={title:first,saved:'keep'};remaining.saved.trim();",
            ...Array.from({ length: width }, (_, index) => (
                `const selected${index}=flag${index}?second:external${index};selected${index}.trim();`
            ))
        ].join('\n');
        const verify = (payload, width) => {
            const source = sourceFor(payload, width);
            const analysis = createAnalysis({ source });
            const members = analysis.memberAccesses.filter(({ name = '' } = {}) => name === 'trim');
            const forward = members.map(({ index = -1 } = {}) => analysis.checkMemberAccess({ index }));
            const expected = new Map(members.map(({ index = -1 } = {}, position) => [index, forward.at(position)]));
            const reversed = createAnalysis({ source });

            deepStrictEqual(forward.map(({ conflicts = [] } = {}) => conflicts), [
                [], ...Array.from({ length: width }, () => payload === '42' ? ['number'] : [])
            ]);
            members.toReversed().forEach(({ index = -1 } = {}) => {
                deepStrictEqual(reversed.checkMemberAccess({ index }), expected.get(index));
                deepStrictEqual(analysis.checkMemberAccess({ index }), reversed.checkMemberAccess({ index }));
            });

            return analysis;
        };
        const original = verify('42', 16);

        verify("'ready'", 32);
        const { index = -1 } = original.memberAccesses.findLast(({ name = '' } = {}) => name === 'trim');

        deepStrictEqual(original.checkMemberAccess({ index }).conflicts, ['number']);
        strictEqual(runInNewContext(`${sourceFor("'ready'", 1)}remaining.saved;`, { flag0: true }), 'keep');
        throws(() => runInNewContext(sourceFor('42', 1), { flag0: true }), ({ name = '' } = {}) => name === 'TypeError');
        const alternatives = createAnalysis({ source: "const method=flag?'trim':'map';const value=42;value[method]();" });
        const { index: computed = -1 } = alternatives.memberAccesses.find(({ call = false } = {}) => call);
        const { violations = [] } = alternatives.checkMemberAccess({ index: computed });

        deepStrictEqual(violations.toSorted(({ name: left = '' } = {}, { name: right = '' } = {}) => left.localeCompare(right)), [
            { name: 'map', expected: 'array', conflicts: ['number'] },
            { name: 'trim', expected: 'string', conflicts: ['number'] }
        ]);
    });

    test('computed pattern acquisition preserves key effects and abrupt completion before unused bindings', () => {
        const source = [
            'const data={total:42};',
            "const choose=()=>{data.total='ready';return 'total';};",
            "const {[choose()]:selected=''}=data;",
            'selected.trim();'
        ].join('\n');
        const acquired = createAnalysis({ source });
        const { index = -1 } = acquired.memberAccesses.find(({ name = '' } = {}) => name === 'trim');

        deepStrictEqual(acquired.checkMemberAccess({ index }).conflicts, []);
        strictEqual(runInNewContext(source), 'ready');
        const interrupted = 'const fail=()=>{throw 7;};const {[fail()]:unused=""}={};const value=42;value.trim();';
        const stopped = createAnalysis({ source: interrupted });
        const { index: operation = -1 } = stopped.memberAccesses.find(({ name = '' } = {}) => name === 'trim');

        deepStrictEqual(stopped.checkMemberAccess({ index: operation }).conflicts, []);
        throws(() => runInNewContext(interrupted), value => value === 7);
    });
}
