import { deepStrictEqual } from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

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
