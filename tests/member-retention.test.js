import { strictEqual, ok } from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

test('live member and absence-context queries release every host node before and after demand', () => {
    const { execPath = '' } = process;
    const source = `
        import {parse,VisitorKeys} from 'espree';
        import {setImmediate} from 'node:timers/promises';
        import {createProgramAnalysis} from 'eslint-plugin-resilient/analyzer';
        const acquire=()=>{
            const program=parse('const get=()=>({name:1,child:{value:[]}});get().nmae;'+
                'const run=({items=[]}={})=>items.trim();'+
                'const isObject=value=>Object.prototype.toString.call(value)==="[object Object]";'+
                'const normalize=value=>isObject(value)?value:{};normalize({kind:1}).kind;'+
                'const read=value=>{const {kind=""}=normalize(value);return kind;};',
                {ecmaVersion:'latest',sourceType:'module',range:true,loc:true});
            // An untrusted host payload must not escape through constant evidence.
            const payload={host:program};
            program.body[0].declarations[0].init.body.properties[0].value.value=payload;
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
        const results=analysis.memberAccesses.map(({index})=>analysis.checkMemberAccess({index}));
        analysis.functions.forEach(({index})=>analysis.checkFunction({index}));
        await collect();console.log(JSON.stringify({before,after:references.filter(ref=>ref.deref()).length,
            sampled:references.length,missing:results.filter(x=>x.missing).length,conflicts:results.flatMap(x=>x.conflicts).length}));
    `;
    const result = JSON.parse(execFileSync(execPath, ['--expose-gc', '--input-type=module', '-e', source], { encoding: 'utf8' }));
    const { before = -1, after = -1, sampled = 0, missing = 0, conflicts = 0 } = result;

    strictEqual(before, 0);
    strictEqual(after, 0);
    ok(sampled > 50);
    strictEqual(missing, 1);
    strictEqual(conflicts, 1);
});
