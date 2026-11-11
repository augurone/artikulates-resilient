import { deepStrictEqual, strictEqual, ok } from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

// Actual collection of host syntax and discarded caller graphs is independently observed; the queried facets share the retention owner.

{
    test('live declaration queries release host syntax and metadata before and after demand', () => {
        const { execPath = '' } = process;
        const source = `
        import { parse } from 'espree';
        import { setImmediate } from 'node:timers/promises';
        import { createProgramAnalysis } from 'eslint-plugin-resilient/analyzer';

        const acquire = () => {
            const program = parse('import { consume } from "consumer"; const run = ({ done }) => consume(done);' +
                'const fold = (state, tuple) => { if (!isArray(tuple) || tuple.length < 2) return state; const [a, b] = tuple; return state; };' +
                'const init = (value = void undefined) => value;' +
                'const inspect = input => { const { value = 0 } = input; return value; };' +
                'const render = Input => { const { value = 0 } = Input; return <Input/>; };' +
                'const receiver = input => { const { value = 0 } = input; return (input?.method)(); };' +
                'const defaulted = (callback = () => []) => callback();' +
                'const revise = ({ done } = {}) => { done = external; if (typeof done === "function") done(); };',
                { ecmaVersion: 'latest', sourceType: 'module', range: true, loc: true, ecmaFeatures: { jsx: true } });
            const declaration = program.body[1];
            const callable = declaration.declarations[0].init;
            const formal = callable.params[0];
            const metadata = { host: new Array(1000).fill('host-owned') };
            Object.defineProperty(declaration, 'parent', { value: program });
            Object.defineProperty(formal, 'hostMetadata', { value: metadata });
            const fold = program.body[2].declarations[0].init;
            const init = program.body[3].declarations[0].init;
            const initializer = init.params[0].right;
            const inspect = program.body[4].declarations[0].init;
            const extraction = inspect.body.body[0].declarations[0];
            const render = program.body[5].declarations[0].init;
            const tag = render.body.body[1].argument;
            const receiver = program.body[6].declarations[0].init;
            const chain = receiver.body.body[1].argument.callee;
            const defaulted = program.body[7].declarations[0].init;
            const callback = defaulted.params[0].right;
            const revise = program.body[8].declarations[0].init;
            const assignment = revise.body.body[0].expression;
            Object.defineProperty(fold.params[0], 'hostMetadata', { value: metadata });
            Object.defineProperty(initializer.argument, 'hostMetadata', { value: metadata });
            const references = [program, declaration, callable, formal, metadata, program.body[2], program.body[3],
                fold.params[0], fold.body.body[0].consequent.argument, fold.body.body[1].declarations[0].id,
                init.params[0], initializer, initializer.argument, inspect.params[0], extraction, extraction.id, extraction.init,
                render.params[0], tag, tag.openingElement.name, receiver.params[0], chain, chain.expression,
                defaulted, defaulted.params[0], callback, callback.body, revise, revise.params[0], assignment, assignment.left].map(node => new WeakRef(node));
            const analysis = createProgramAnalysis({ program, filename: 'main', resolveModule: () => ({
                filename: 'consumer', source: 'export const consume = action => { if (typeof action === "function") action(); };'
            }) });
            return { analysis, references };
        };
        const retained = references => references.map(reference => Boolean(reference.deref()));
        const collect = async () => {
            for (let turn = 0; turn < 5; turn += 1) { await setImmediate(); globalThis.gc(); }
        };
        const { analysis, references } = acquire();
        await collect();
        const before = retained(references);
        const { index } = analysis.declarations.find(({ name }) => name === 'done');
        const first = analysis.checkDeclaration({ index });
        const tuple = analysis.declarations.filter(({ name }) => name === "a" || name === "b").map(({ index }) => analysis.checkDeclaration({ index }).required);
        const placements = [0,1,2].map(index => analysis.checkSignatureExtraction({ index }).placement);
        analysis.functions.forEach(({ index }) => analysis.checkFunction({ index }));
        analysis.invocations.forEach(({ index }) => analysis.checkInvocation({ index }));
        await collect();
        console.log(JSON.stringify({ before, after: retained(references), required: first.required,
            tuple, placements, reused: first === analysis.checkDeclaration({ index }) }));
    `;
        const result = JSON.parse(execFileSync(execPath, ['--expose-gc', '--input-type=module', '-e', source], { encoding: 'utf8', timeout: 30000 }));

        deepStrictEqual(result, {
            before: Array.from({ length: 31 }, () => false), after: Array.from({ length: 31 }, () => false), required: false,
            tuple: [false, false], placements: ['signature', 'unknown', 'body'], reused: true
        });
    });

    test('retained public reports do not retain their caller sessions or query collections', () => {
        const { execPath = '' } = process;
        const source = `
        import { setImmediate } from 'node:timers/promises';
        import { createAnalysis } from 'eslint-plugin-resilient/analyzer';
        const acquire = () => {
            const analysis = createAnalysis({source:'const read=()=>{const f=()=>42;f.call(null);return f.apply(null,[]);};' +
                'const copy=value=>value?{...value}:{};const {name=""}=copy({name:42});name.trim();read().trim();'});
            const functionReport = analysis.checkFunction({index:0});
            const calls = analysis.calls.map(({index})=>analysis.checkCallResult({index,required:'string'}));
            const members = analysis.memberAccesses.map(({index})=>analysis.checkMemberAccess({index}));
            const refs = [analysis,analysis.functions,analysis.calls,analysis.memberAccesses,analysis.declarations].map(value=>new WeakRef(value));
            return {functionReport,calls,members,refs};
        };
        const held = acquire();
        for(let turn=0;turn<5;turn+=1){await setImmediate();globalThis.gc();}
        console.log(JSON.stringify({retained:held.refs.map(ref=>Boolean(ref.deref())),family:held.functionReport.fact.families,
            complete:!held.functionReport.fact.incomplete,conflicts:held.members.flatMap(value=>value.conflicts),calls:held.calls.length>0}));
    `;
        const result = JSON.parse(execFileSync(execPath, ['--expose-gc', '--input-type=module', '-e', source], { encoding: 'utf8', timeout: 30000 }));

        deepStrictEqual(result, { retained: [false, false, false, false, false], family: ['number'], complete: true, conflicts: ['number', 'number'], calls: true });
    });
}

{
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
}
