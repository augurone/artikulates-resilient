import { deepStrictEqual, ok, strictEqual, throws } from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

import { createAnalysis } from 'eslint-plugin-resilient/analyzer';

import { queriesFor, queryAnalysis } from './support/analysis-queries.js';
import { counter } from './support/work.js';

const specimens = [
    ['const produce=()=>42;external(produce);const read=()=>produce.call({});read().trim();', 'checkMemberAccess', 'memberAccesses'],
    ['const read=([name=""]=[])=>name;read(flag?undefined:[42]);', 'checkCall', 'calls'],
    ['const seed=()=>42;const read=(first=seed(),second=first)=>second;read();', 'checkCallResult', 'calls'],
    ['const produce=()=>42;const wrap=()=>produce.apply(null,[]);wrap().trim();', 'checkMemberAccess', 'memberAccesses'],
    ['const run=({cb}={})=>{const read=()=>cb;if(typeof cb!=="function")return;read()();};', 'checkDeclaration', 'declarations']
];

specimens.forEach(([source = '', method = '', collection = ''] = []) => test(`closure repair retries interrupted work: ${method}`, () => {
    const baseline = createAnalysis({ source });
    const entries = Reflect.get(baseline, collection);
    const { index = -1 } = method === 'checkDeclaration' ? entries.find(({ name = '' } = {}) => name === 'cb') : entries.at(-1);
    const query = { method, index, required: 'number' };
    const visits = new Map();
    const steps = counter();
    const expected = queryAnalysis(baseline, { ...query, onWork: ({ kind = '' } = {}) => {
        steps.increment('steps');

        // eslint-disable-next-line resilient/prefer-safe-transformations -- This private test schedule retains the last observed position of each work stage.
        visits.set(kind, steps.get('steps'));
    } });

    ok(visits.size > 0);
    [...visits].forEach(([kind = '', stop = 0] = []) => {
        const analysis = createAnalysis({ source });
        const steps = counter();
        const failure = new Error(`interrupted ${kind}`);

        throws(() => queryAnalysis(analysis, { ...query, onWork: () => {
            steps.increment('steps');

            if (steps.get('steps') === stop) throw failure;
        } }), error => error === failure);
        queriesFor(analysis).toReversed().forEach(query => queryAnalysis(analysis, query));
        deepStrictEqual(queryAnalysis(analysis, query), expected);
    });
    const warm = counter();
    const { onWork } = warm;

    const { counts: before = {} } = baseline;

    deepStrictEqual(queryAnalysis(baseline, { ...query, onWork }), expected);
    ['function-context', 'flow-step', 'establishment'].forEach(kind => strictEqual(warm.get(kind), 0));
    const { counts: after = {} } = baseline;

    deepStrictEqual(after, before);
}));

const sourceFor = (size, kind) => {
    if (kind === 'defaults') {
        const parameters = Array.from({ length: size - 1 }, (unused, index) => `value${index + 1}=value${index}`).join(',');

        return `const seed=()=>42;const read=(value0=seed(),${parameters})=>value${size - 1};read().trim();`;
    }

    const readers = Array.from({ length: size }, (unused, index) => `const read${index}=()=>cb;`).join('');
    const calls = Array.from({ length: size }, (unused, index) => `read${index}()();`).join('');

    return `const run=({cb}={})=>{${readers}if(typeof cb!=="function")return;${calls}};`;
};

['defaults', 'captures'].forEach(kind => test(`entry and capture composition shares work: ${kind}`, (context) => {
    const samples = [16, 32, 64].map((size) => {
        const source = sourceFor(size, kind);
        const analysis = createAnalysis({ source });
        const work = counter();
        const { onWork } = work;

        if (kind === 'captures') {
            const selected = analysis.declarations.find(({ name = '' } = {}) => name === 'cb');

            strictEqual(analysis.checkDeclaration({ ...selected, onWork }).required, false);
        }

        if (kind === 'defaults') {
            const selected = analysis.memberAccesses.find(({ name = '' } = {}) => name === 'trim');

            deepStrictEqual(analysis.checkMemberAccess({ ...selected, onWork }).conflicts, ['number']);
        }

        const { counts = {} } = analysis;
        const total = Object.values(work.read()).reduce((sum, count) => sum + count, 0);

        return { size, total, counts };
    });

    samples.slice(1).forEach(({ total = 0, counts = {} } = {}, index) => {
        const { total: previous = 0, counts: earlier = {} } = samples.at(index);

        ok(total <= previous * 3, JSON.stringify(samples));
        ['expressions', 'values', 'contexts'].forEach((key) => {
            const { [key]: retained = 0 } = counts;
            const { [key]: before = 0 } = earlier;

            ok(before > 0 && retained <= before * 3, JSON.stringify({ key, samples }));
        });
    });
    context.diagnostic(JSON.stringify({ kind, samples }));
}));

test('entry and capture indexes release host syntax while queried snapshots stay usable', () => {
    const { execPath = '' } = process;
    const script = `
        import {parse} from 'espree';
        import {setImmediate} from 'node:timers/promises';
        import {createProgramAnalysis} from 'eslint-plugin-resilient/analyzer';
        const acquire=()=>{
            const program=parse('const seed=()=>42;const read=(first=seed(),second=first)=>second;const wrap=()=>read.call(null);wrap().trim();',
                {ecmaVersion:'latest',sourceType:'module',range:true,loc:true});
            const metadata={host:new Array(1000)};
            Object.defineProperty(program,'hostMetadata',{value:metadata});
            const refs=[program,metadata,program.body[1].declarations[0].init.params[0]].map(value=>new WeakRef(value));
            return {analysis:createProgramAnalysis({program}),refs};
        };
        const {analysis,refs}=acquire();
        for(let turn=0;turn<5;turn++){await setImmediate();globalThis.gc();}
        const before=refs.map(ref=>Boolean(ref.deref()));
        const selected=analysis.memberAccesses.find(({name})=>name==='trim');
        const conflicts=analysis.checkMemberAccess(selected).conflicts;
        for(let turn=0;turn<5;turn++){await setImmediate();globalThis.gc();}
        console.log(JSON.stringify({before,after:refs.map(ref=>Boolean(ref.deref())),conflicts}));
    `;
    const { before = [], after = [], conflicts = [] } = JSON.parse(execFileSync(execPath, ['--expose-gc', '--input-type=module', '-e', script], {
        encoding: 'utf8', timeout: 30000
    }));

    deepStrictEqual(before, [false, false, false]);
    deepStrictEqual(after, [false, false, false]);
    deepStrictEqual(conflicts, ['number']);
});
