import assert, { deepStrictEqual, ok, strictEqual } from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';

import { Linter } from 'eslint';
import typescript from 'typescript';

import plugin from 'eslint-plugin-resilient';
import { auditSource } from 'eslint-plugin-resilient/audit';
import { createTypeScriptTransformer } from 'eslint-plugin-resilient/typescript';

import { formatResilientOutput, placeEmissionBoundaries, placeInlineEmissionBoundaries } from '../transforms/typescript/grammar/emission-layout.js';
import { annotateFinalExceptions } from '../transforms/typescript/grammar/final.js';
import { lowerGuardedConditionalReturns } from '../transforms/typescript/lowering/guarded-returns.js';
import { lowerNamespaceSnapshots } from '../transforms/typescript/members/namespace.js';
import { collectNamespaceReferences } from '../transforms/typescript/understand/imports.js';
import { createSourceCensus } from '../transforms/typescript/understand/source-census.js';
import { copyBindingAnnotations } from '../transforms/utils/ast-boundary.js';

// Source-owned emission, options, import order, resources and syntax/comment boundaries are checked through actual output/native failure, snapshots, retry and bounded traversal.

{
    ['blocks', 'functions'].forEach(kind => [0, 8].forEach(width => test(`guarded-return traversal keeps ${kind} with bounded work: width ${width}`, () => {
        [4, 8, 12, 24].forEach((depth) => {
            const prefix = Array.from({ length: depth }, (_, index) => `${kind === 'functions' ? `function f${index}()` : ''}{const value=${index};${'0;'.repeat(width)}`).join('');
            const sourceText = kind === 'blocks' ? `const run=()=>{${prefix}return value;${'}'.repeat(depth)}};run();`
                : prefix + 'return value;' + Array.from({ length: depth - 1 }, (_, index) => `}return f${depth - index - 1}();`).join('') + '}f0();';
            const sourceFile = typescript.createSourceFile('scopes.ts', sourceText, typescript.ScriptTarget.ESNext, true);
            let nodes = 0;
            let visits = 0;
            const count = (node) => {
                nodes += 1;
                typescript.forEachChild(node, count);
            };

            count(sourceFile);
            const compiler = { ...typescript, visitEachChild: (...argumentsList) => {
                visits += 1;

                return typescript.visitEachChild(...argumentsList);
            } };
            const result = typescript.transform(sourceFile, [context => root => lowerGuardedConditionalReturns({
                typescript: compiler, sourceFile: root, context
            })]);
            const { transformed = [] } = result;
            const output = typescript.createPrinter().printFile(transformed.at(0));
            const expected = runInNewContext(sourceText);

            strictEqual(expected, depth - 1);
            deepStrictEqual(runInNewContext(output), expected);
            ok(visits <= nodes * 3, `${visits} visits for ${nodes} source nodes at depth ${depth}; completed scopes must not be revisited`);
            strictEqual(sourceFile.getFullText(), sourceText);
            result.dispose();
        });
    })));
}

{
    const directory = await mkdtemp(path.join(tmpdir(), 'resilient-emission-import-order-'));
    await writeFile(path.join(directory, 'package.json'), '{"type":"module"}\n');
    const code = [
        "import './z-authored.js';",
        "import './a-authored.js';",
        "import { events } from './events.js';",
        'type Box = { value: string };',
        'export const BoxValue = (box: Box) => Box(box);',
        'type CallablePair = [(value: string) => string, string];',
        'type Mapper = { map: <B>(value: unknown, callback: (pair: CallablePair) => B) => B };',
        'export const invokePair = (F: Mapper, value: unknown) => F.map(value, ([apply, input]) => [apply(input), input]);',
        "events.push('body');",
        'export { events };',
        ''
    ].join('\n');
    try {
        // eslint-disable-next-line resilient/prefer-prototype-methods -- Sequential module cases isolate each temporary graph and its ESM execution.
        for (const kind of ['normal', 'failure']) {
            const root = path.join(directory, kind);
            await mkdir(root);
            await writeFile(path.join(root, 'input.ts'), code);
            await writeFile(path.join(root, 'events.js'), 'export const events = [];\nexport const failure = {};\n');
            await writeFile(path.join(root, 'dependency.js'), "import { events } from './events.js';\nevents.push('dependency');\n");
            const modules = [
                ['z-object.js', 'object', true],
                ['a-array.js', 'array', false],
                ['m-function.js', 'function', true]
            ];
            // eslint-disable-next-line resilient/prefer-prototype-methods -- Each helper file is written before the module graph is evaluated.
            for (const [name = '', helper = '', dependency = false] of modules) {
                const { href: support = '' } = pathToFileURL(path.resolve(`analysis/host/${helper}.js`));
                await writeFile(path.join(root, name), [
                    dependency ? "import './dependency.js';" : '',
                    "import { events, failure } from './events.js';",
                    `events.push('${helper}');`,
                    kind === 'failure' && helper === 'object' ? 'throw failure;' : '',
                    `export * from '${support}';`,
                    ''
                ].join('\n'));
            }
            // eslint-disable-next-line resilient/prefer-prototype-methods -- Authored effect modules must exist before the isolated runtime is loaded.
            for (const name of ['z-authored', 'a-authored']) {
                await writeFile(path.join(root, `${name}.js`), `import { events } from './events.js';\nevents.push('${name}');\n`);
            }
            const fileName = path.join(root, 'input.ts');
            const program = typescript.createProgram([fileName], {
                strict: true, target: typescript.ScriptTarget.ESNext, module: typescript.ModuleKind.ESNext
            });
            const transformer = createTypeScriptTransformer({ typescript, program, standard: {
                object: './z-object.js', array: './a-array.js', function: './m-function.js'
            } });
            const result = transformer.transform({ code, fileName });
            assert.deepEqual(result.diagnostics, []);
            const tree = typescript.createSourceFile('output.js', result.code, typescript.ScriptTarget.Latest, true);
            const imports = tree.statements.filter(typescript.isImportDeclaration).map(({ moduleSpecifier: { text = '' } = {} }) => text);
            assert.deepEqual(imports, ['./z-object.js', './z-authored.js', './a-authored.js', './events.js']);
            await writeFile(path.join(root, 'output.js'), result.code);
            // Separate processes prevent the ESM cache from concealing reordered effects.
            const observed = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', [
                `import { events, failure } from ${JSON.stringify(pathToFileURL(path.join(root, 'events.js')).href)};`,
                'let exactFailure = false;',
                `try { await import(${JSON.stringify(pathToFileURL(path.join(root, 'output.js')).href)}); } catch (error) { exactFailure = error === failure; }`,
                'process.stdout.write(JSON.stringify({ events, exactFailure }));'
            ].join('\n')], { encoding: 'utf8' }));
            assert.deepEqual(observed, kind === 'failure'
                ? { events: ['dependency', 'object'], exactFailure: true }
                : { events: ['dependency', 'object', 'z-authored', 'a-authored', 'body'], exactFailure: false });
        }
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
}

{
    const lower = (sourceFile) => {
        const before = typescript.createPrinter().printFile(sourceFile);
        const census = createSourceCensus({ typescript, sourceFile });
        const namespaceReferences = collectNamespaceReferences({ typescript, census });
        const result = typescript.transform(sourceFile, [context => sourceFile => lowerNamespaceSnapshots({
            typescript, sourceFile, namespaceReferences, context
        })]);
        const { transformed: [transformed = {}] = [] } = result;
        const code = typescript.createPrinter().printFile(transformed);

        strictEqual(typescript.createPrinter().printFile(sourceFile), before);
        result.dispose();

        return code;
    };

    test('namespace snapshot annotation cannot mutate or accumulate on caller-owned binding patterns', () => {
        const source = typescript.createSourceFile('entry.ts', 'import *as api from "./leaf.js";export const {read}=api;', typescript.ScriptTarget.Latest, true);
        const { statements: [, { declarationList: { declarations: [{ name = {} } = {}] = [] } = {} } = {}] = [] } = source;
        const before = typescript.createPrinter().printFile(source);
        const first = lower(source);

        strictEqual(first.includes('Namespace snapshot'), true);
        strictEqual(lower(source), first);
        strictEqual(typescript.createPrinter().printFile(source), before);
        deepStrictEqual(typescript.getSyntheticLeadingComments(name), undefined);
        deepStrictEqual(typescript.getSyntheticTrailingComments(name), undefined);
    });

    [
        'const select=(api:unknown)=>{const read=api.read;return read;};',
        'const select=()=>{const {api}=input;const read=api.read;return read;};',
        'const select=()=>{class api{}const read=api.read;return read;};'
    ].forEach(shadow => test(`programless namespace evidence does not borrow a shadowed name: ${shadow}`, () => {
        const source = typescript.createSourceFile('entry.ts', 'import *as api from "./leaf.js";' + shadow, typescript.ScriptTarget.Latest, true);
        const census = createSourceCensus({ typescript, sourceFile: source });

        strictEqual(collectNamespaceReferences({ typescript, census }).size, 0);
        strictEqual(lower(source), typescript.createPrinter().printFile(source));
    }));
}

{
    const absence = 'resilient/no-undefined-assignment';
    const defaults = 'resilient/prefer-safe-destructuring-defaults';
    const config = [plugin.configs.recommended, plugin.configs.contracts, plugin.configs.safety];
    const cases = [
        ['body neighbor', 'const {exact, authored}=source;', 0, 1],
        ['signature neighbor', 'const read=({exact, authored})=>[exact,authored];', 0, 1],
        ['authored default', 'const read=({exact, authored=void 0})=>[exact,authored];', 1, 0],
        ['next parameter', 'const read=({exact}, {authored=void 0})=>[exact,authored];', 1, 0],
        ['next declaration', 'const {exact}=source, authored=undefined;', 1, 0],
        ['nested signature', 'const read=({group:{authored,exact}},{next})=>[exact,authored,next];', 0, 3],
        ['array hole', 'const read=([exact,,authored=void 0])=>[exact,authored];', 1, 0],
        ['array trailing hole', 'const read=([authored,exact,,],{next})=>[exact,authored,next];', 0, 2],
        ['generated fields around prose', 'const {exact,\n// The next extraction retains its source value.\nanother\n}=source;', 0, 0],
        ['rest neighbor', 'const {exact,...rest}=source;', 0, 0],
        ['authored container', 'const {exact}={authored:undefined};', 1, 0],
        ['deferred authored default', 'const {exact}=(authored=void 0)=>authored;', 1, 0],
        ['effectful authored default', 'const {exact,authored=void effect()}=source;', 1, 0],
        ['existing sibling directive', 'const {exact,\n// eslint-disable-next-line resilient/prefer-safe-destructuring-defaults -- Native authored field retains absence.\nauthored\n}=source;', 0, 0]
    ];

    cases.forEach(([name = '', source = '', expectedAbsence = 0, expectedDefaults = 0] = []) => {
        test(`generated absence exception owns only its binding: ${name}`, () => {
            const original = typescript.createSourceFile('scope.ts', source, typescript.ScriptTarget.ESNext, true);
            const printer = typescript.createPrinter();
            const before = printer.printFile(original);
            const result = typescript.transform(original, [context => (root) => {
                const insert = (node) => {
                    const visited = typescript.visitEachChild(node, insert, context);

                    // eslint-disable-next-line resilient/prefer-safe-destructuring-defaults -- Native compiler binding fields must retain absent tokens when the test replaces only an initializer.
                    const { name = {}, dotDotDotToken, propertyName } = visited;
                    const { text = '' } = name;

                    if (!typescript.isBindingElement(visited) || !typescript.isIdentifier(name) || !['exact', 'another'].includes(text)) return visited;

                    return typescript.factory.updateBindingElement(visited, dotDotDotToken, propertyName, name,
                        typescript.factory.createVoidExpression(typescript.factory.createNumericLiteral(0)));
                };
                const generated = typescript.visitNode(root, insert);
                const first = annotateFinalExceptions({ typescript, sourceFile: generated, context });
                const printed = printer.printFile(first);
                const second = annotateFinalExceptions({ typescript, sourceFile: first, context });

                assert.equal(printer.printFile(second), printed);
                const { outputText = '' } = typescript.transpileModule(placeEmissionBoundaries(printed, typescript, first), {
                    compilerOptions: { target: typescript.ScriptTarget.ESNext, module: typescript.ModuleKind.ESNext }
                });
                const emitted = formatResilientOutput(placeInlineEmissionBoundaries(outputText, typescript, first), typescript);
                const linter = new Linter();
                const { output: fixed = '', messages: fixedMessages = [] } = linter.verifyAndFix(emitted, config);

                [linter.verify(emitted, config), fixedMessages].forEach((messages) => {
                    assert.equal(messages.filter(({ ruleId = '' } = {}) => ruleId === absence).length, expectedAbsence, emitted + JSON.stringify(messages));
                    assert.equal(messages.filter(({ ruleId = '' } = {}) => ruleId === defaults).length, expectedDefaults);
                    assert.equal(messages.filter(({ ruleId = '' } = {}) => !ruleId).length, 0);
                });
                [emitted, fixed].forEach(code => assert.deepEqual(auditSource(code), [], code));

                return second;
            }]);

            result.dispose();
            assert.equal(printer.printFile(original), before);
        });
    });

    test('binding annotation clones retain own data descriptors without inventing absent metadata', () => {
        const keys = ['__resilientGuarded', '__resilientAgreement', '__resilientExactTuplePosition',
            '__resilientCollectionTimingBoundary', '__resilientProviderForward', '__resilientNativeTuple'];
        const source = typescript.factory.createObjectBindingPattern([]);
        const inherited = Object.create(source);

        keys.forEach(key => Object.defineProperty(source, key, {
            configurable: true, enumerable: false, writable: false, value: key === '__resilientAgreement' ? 'Native source field.' : true
        }));
        const before = Object.getOwnPropertyDescriptors(source);
        const first = copyBindingAnnotations(source, typescript.factory.cloneNode(source));
        const second = copyBindingAnnotations(first, typescript.factory.cloneNode(first));
        const empty = copyBindingAnnotations(typescript.factory.createObjectBindingPattern([]), typescript.factory.createObjectBindingPattern([]));
        const unowned = copyBindingAnnotations(inherited, typescript.factory.createObjectBindingPattern([]));

        keys.forEach((key) => {
            [first, second].forEach(clone => assert.deepEqual(Object.getOwnPropertyDescriptor(clone, key), Object.getOwnPropertyDescriptor(source, key)));
            assert.equal(Object.hasOwn(empty, key), false);
            assert.equal(Object.hasOwn(unowned, key), false);
        });
        assert.deepEqual(Object.getOwnPropertyDescriptors(source), before);
        assert.notEqual(source, first);
        assert.notEqual(first, second);
    });
}
