import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

import { createAnalysis } from 'eslint-plugin-resilient/analyzer';

const { positions = [], forwards = [], carries = [] } = JSON.parse(readFileSync(new URL('./fixtures/async-identity-compositions.json', import.meta.url), 'utf8'));
const lateThenable = 'const make=()=>{const reads=[false,false,true,true].values();const choices=[false,true].values();'
    + 'const value={get then(){return reads.next().value?((resolve,reject)=>(choices.next().value?reject:resolve)(0)):void 0;}};return Promise.resolve(value);};'
    + 'const first=make();const second=make();';
const inputs = ['resolve', 'reject'].flatMap(first => ['resolve', 'reject'].map(second => (
    `const first=Promise.${first}(0);const second=Promise.${second}(0);`
))).concat(lateThenable);

positions.forEach(([slots = '', guard = ''] = []) => forwards.forEach(([forward = '', body = ''] = []) => {
    test(`settlement identity compositions: ${slots}, ${guard}, ${forward}`, async () => {
        await Promise.all(carries.map(async ([carrier = '', carry = ''] = []) => {
            const mapped = slots.replaceAll(/\bp\b/gu, 'forward(p)').replaceAll(/\bq\b/gu, 'forward(q)');
            const source = 'const read=async(first,second,flag=false)=>{const p=Promise.race([first]);const q=Promise.race([second]);'
                + `const forward=${body};const [x={},y={}]=await Promise.allSettled(${mapped});${carry}`
                + `return ${guard}&&a.status==="fulfilled"&&b.status==="rejected"?42:"ok";};`;
            const actual = await Promise.all(inputs.flatMap(input => [false, true].map(async (flag) => {
                // Observe unused input rejections too; a generated slot may use
                // the same native promise twice and omit the second input.
                const observed = source.replace('const forward=', 'Promise.allSettled([p,q]);const forward=');
                const [{ status = '', value = false } = {}] = await runInNewContext(observed + input
                    + `Promise.allSettled([read(first,second,${flag}),first,second]);`);

                strictEqual(status, 'fulfilled', source);

                return typeof value;
            })));
            const expected = [...new Set(actual)].toSorted();
            const analysis = createAnalysis({ source });
            const summary = analysis.checkFunction({ index: 0 });
            const { fact: { families = [], incomplete = true } = {} } = summary;
            const message = JSON.stringify({ carrier, source });

            deepStrictEqual(families.toSorted(), expected, message);
            strictEqual(incomplete, false, message);
            analysis.calls.toReversed().forEach(({ index = -1 } = {}) => analysis.checkCall({ index }));
            deepStrictEqual(analysis.checkFunction({ index: 0 }), summary, message);
        }));
    });
}));
