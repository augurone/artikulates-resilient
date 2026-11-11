import { deepStrictEqual, strictEqual, throws } from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

import { Linter } from 'eslint';

import { createAnalysis } from 'eslint-plugin-resilient/analyzer';
import plugin from 'eslint-plugin-resilient/eslint';

const conflictsFor = analysis => analysis.memberAccesses.filter(({ name = '' } = {}) => name === 'trim')
    .flatMap(({ index = -1 } = {}) => analysis.checkMemberAccess({ index }).conflicts);
const candidates = [
    ['exact matching string', '"yes"', true],
    ['exact different string', '"no"', false],
    ['number family without a constant', '1+2', false],
    ['boolean family without a constant', 'flag===true', false],
    ['object family without a constant', '{}', false],
    ['string family without a constant', '"ye"+"s"', true],
    ['opaque tag', 'external', true],
    ['known family beside opaque tag', 'choice?1+2:external', true]
];

candidates.forEach(([name = '', tag = '', conflict = false] = []) => {
    ['const item=source;', 'const item={...source};', 'const {...item}=source;'].forEach(transfer => test(`literal comparison retains family evidence: ${name}, ${transfer}`, () => {
        // A known family must still be considered when no subject arm carries
        // an exact constant. The compared literal alone owns this question.
        const peers = name === 'number family without a constant' ? ['"yes"', '"ye"+"s"', 'other'] : ['"yes"'];

        peers.forEach((peer) => {
            [
                'if(item.tag==="yes")item.value.trim();',
                'if("yes"===item.tag)item.value.trim();',
                'if(item.tag!=="yes")return;item.value.trim();'
            ].forEach((consume) => {
                const source = `const run=(flag=false)=>{const source=flag?{tag:${tag},value:42}:{tag:${peer},value:"ok"};${transfer}${consume}};run(flag);`;
                const analysis = createAnalysis({ source });
                const expected = conflict ? ['number'] : [];
                const diagnostics = new Linter().verify(source, { plugins: { resilient: plugin }, rules: { 'resilient/signature-contract-operation': 'error' } });

                deepStrictEqual(conflictsFor(analysis), expected, source);
                strictEqual(diagnostics.length, expected.length, source);
                analysis.calls.toReversed().forEach(({ index = -1 } = {}) => analysis.checkCallResult({ index, required: 'number' }));
                deepStrictEqual(conflictsFor(analysis), expected, source);
                [false, true].forEach((flag) => {
                    const execute = () => runInNewContext(source, { flag, external: 'yes', other: 'yes', choice: false });

                    if (flag && conflict) throws(execute, ({ name = '' } = {}) => name === 'TypeError');

                    if (!flag || !conflict) strictEqual(execute(), undefined);
                });
            });
        });
    }));
});
