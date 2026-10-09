import { strictEqual, ok } from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

test('live promise ownership queries release every host node before and after demand', () => {
    const { execPath = '' } = process;
    const source = `
        import {parse,VisitorKeys} from 'espree';
        import {setImmediate} from 'node:timers/promises';
        import {createProgramAnalysis} from 'eslint-plugin-resilient/analyzer';
        const acquire=()=>{
            const program=parse('async function load(){throw new Error("rejection");}load();'+
                'const forward=()=>flag?load():unknown;forward();'+
                'Promise.resolve(1);request().then(next).finally(cleanup);',
                {ecmaVersion:'latest',sourceType:'module',range:true,loc:true});
            const payload={host:program};
            program.hostPayload=payload;
            const pending=[program], references=[new WeakRef(payload)];
            while(pending.length){const node=pending.pop();references.push(new WeakRef(node));
                node.host={source:program};references.push(new WeakRef(node.host));
                for(const key of VisitorKeys[node.type]||[]){const value=node[key];
                    if(Array.isArray(value))pending.push(...value.filter(Boolean));else if(value)pending.push(value);}}
            return {analysis:createProgramAnalysis({program}),references};
        };
        const {analysis,references}=acquire();
        const collect=async()=>{for(let turn=0;turn<5;turn++){await setImmediate();globalThis.gc();}};
        await collect();const before=references.filter(ref=>ref.deref()).length;
        const results=analysis.promiseUses.map(({index})=>analysis.checkPromiseUse({index}));
        await collect();console.log(JSON.stringify({before,after:references.filter(ref=>ref.deref()).length,
            sampled:references.length,unhandled:results.filter(x=>x.unhandled).length}));
    `;
    const result = JSON.parse(execFileSync(execPath, ['--expose-gc', '--input-type=module', '-e', source], { encoding: 'utf8' }));
    const { before = -1, after = -1, sampled = 0, unhandled = 0 } = result;

    strictEqual(before, 0);
    strictEqual(after, 0);
    ok(sampled > 50);
    strictEqual(unhandled, 4);
});
