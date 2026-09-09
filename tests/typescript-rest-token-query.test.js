import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

import { Linter } from 'eslint';
import typescript from 'typescript';

import resilient from 'eslint-plugin-resilient';

import { getObject, hasContent } from '../rules/support/object.js';
import { getBindingPropertyName } from '../transforms/typescript/grammar/resolvers.js';
import { compileDestructuringDecisions } from '../transforms/typescript/policy/decision-store.js';
import { compilePlacementDecisions } from '../transforms/typescript/policy/placement.js';
import { collectPlacementEvidence } from '../transforms/typescript/understand/placement-evidence.js';
import { getConsumerContractKey } from '../transforms/typescript/understand/type-evidence.js';

const parse = (code = '', file = 'rest-query.ts') => typescript.createSourceFile(file, code, typescript.ScriptTarget.ESNext, true);
const matching = ({ root = {}, accepts = () => false } = {}) => {
    let nodes = [];
    const visit = (node = {}) => {
        if (accepts(node)) nodes = [...nodes, node];

        typescript.forEachChild(node, visit);
    };
    visit(root);

    return nodes;
};
const files = ['generic.js', 'index.js'];
const sources = files.map(file => readFileSync(new URL(`../transforms/typescript/members/${file}`, import.meta.url), 'utf8'));
const loadVariant = async ({ file = '', source = '', original = false } = {}) => {
    const url = new URL(`../transforms/typescript/members/${file}`, import.meta.url);
    assert.equal(source.split('dotDotDotToken = {}').length, 2, 'Only the selected query changes.');
    const variant = original ? source.replace('dotDotDotToken = {}', 'dotDotDotToken') : source;
    const rebased = variant.replace(/from '([^']+)'/gu, (match, relative) => `from ${JSON.stringify(new URL(relative, url).href)}`);

    return import(`data:text/javascript;base64,${Buffer.from(rebased).toString('base64')}`);
};
const modules = await Promise.all(files.map((file = '', index = 0) => Promise.all([
    loadVariant({ file, source: sources[index], original: true }), loadVariant({ file, source: sources[index] })
])));
const [genericModules = [], indexModules = []] = modules;
const support = readFileSync(new URL('../rules/support/object.js', import.meta.url), 'utf8').replace(/export\s*\{[\s\S]*$/u, '');
const linter = new Linter();
const rule = 'resilient/prefer-safe-destructuring-defaults';
const config = { plugins: { resilient }, rules: { [rule]: 'error' } };

// Actual query declarations plus the actual shared predicate, isolated from
// host intrinsics. Empty-object alignment preserves the existing protocol;
// false can erase Object.keys Get, callability failure and tag-getter effects.
sources.forEach((source = '') => {
    const root = parse(source);
    const [declaration = {}] = matching({ root, accepts: (node = {}) => {
        const { name = {} } = node;

        return typescript.isVariableDeclaration(node) &&
            node.getText(root).includes('dotDotDotToken = {}') && !typescript.isIdentifier(name);
    } });
    const current = declaration.getText(root);
    const versions = [current.replace('dotDotDotToken = {}', 'dotDotDotToken'), current, current.replace('dotDotDotToken = {}', 'dotDotDotToken = false')];
    const probe = ({ version = '', token = 'undefined', mode = '' } = {}) => JSON.parse(JSON.stringify(runInNewContext(`
        ${support}
        let events = [];
        const failure = new Error('native boundary');
        const element = {
            [Symbol.toStringTag]: 'Object',
            get dotDotDotToken() {
                events = [...events, 'token.Get'];
                if (mode === 'token-failure') throw failure;
                return ${token};
            },
            get initializer() { events = [...events, 'initializer.Get']; return undefined; }
        };
        const nativeKeys = Object.keys;
        if (mode.startsWith('keys')) Object.defineProperty(Object, 'keys', { get() {
            events = [...events, 'keys.Get'];
            if (mode === 'keys-failure') throw failure;
            return mode === 'keys-absent' ? undefined : mode === 'keys-noncallable' ? 0 : nativeKeys;
        } });
        if (mode === 'tag') Object.defineProperty(Object.prototype, Symbol.toStringTag, { get() {
            events = [...events, this instanceof Boolean ? 'boolean.tag' : 'object.tag'];
            if (this instanceof Boolean) throw failure;
            return 'Object';
        } });
        let outcome;
        try { outcome = (() => { const ${version}; return hasContent(dotDotDotToken); })(); }
        catch (error) { outcome = error === failure ? 'exact failure' : error.name; }
        ({ outcome, events });
    `, { mode })));
    ['undefined', 'null', 'false', '{}', '{ kind: 26 }', '(() => 0)', '[]', '"rest"'].forEach((token = '') => {
        const [before = {}, after = {}, falseDefault = {}] = versions.map(version => probe({ version, token }));
        assert.deepEqual(after, before);
        assert.deepEqual(falseDefault, before);
    });
    ['keys-present', 'keys-absent', 'keys-noncallable', 'keys-failure', 'tag', 'token-failure'].forEach((mode = '') => {
        const [before = {}, after = {}, falseDefault = {}] = versions.map(version => probe({ version, mode }));
        assert.deepEqual(after, before);

        if (mode !== 'token-failure') assert.notDeepEqual(falseDefault, before);

        if (mode === 'token-failure') assert.deepEqual(falseDefault, before);
    });
    assert.deepEqual(versions.map(version => linter.verify(`const query = element => { const ${version}; return hasContent(dotDotDotToken); };`, config).length), [1, 0, 0]);
});

// The actual nested reuse owner with all its statement/shape/source checks,
// not just a copied filter or token predicate.
const [genericSource = ''] = sources;
const genericRoot = parse(genericSource);
const [reuseOwner = {}] = matching({ root: genericRoot, accepts: (node = {}) => {
    const { name = {} } = node;

    return typescript.isVariableDeclaration(node) &&
        typescript.isIdentifier(name) && name.getText(genericRoot) === 'getExistingBindings';
} });
const reuseText = reuseOwner.getText(genericRoot);
const reuse = ({ code = '', objectName = 'input', original = false } = {}) => {
    const root = parse(code);
    const { statements = [] } = root;
    const text = original ? reuseText.replace('dotDotDotToken = {}', 'dotDotDotToken') : reuseText;
    const { SyntaxKind: { Block = -1, VariableStatement = -1, ObjectBindingPattern: ObjectBindingPatternKind2 = -1, Identifier = -1 } = {} } = typescript;

    return runInNewContext(`const ${text}; getExistingBindings(objectName);`, {
        getObject, hasContent, getBindingPropertyName, typescript, Block, VariableStatement, ObjectBindingPatternKind2, Identifier,
        rewrittenBodyKind: Block, rewrittenStatements: statements, objectName
    });
};
[
    { code: 'const { value, renamed: alias = 2, ...rest } = input;', members: 2, statements: 1 },
    { code: 'const { value } = other;', members: 0, statements: 0 },
    { code: 'const [value, ...rest] = input;', members: 0, statements: 0 },
    { code: 'const { value } = make();', members: 0, statements: 0 },
    { code: 'const { value } = input, other = 1;', members: 0, statements: 0 },
    { code: 'consume(input);', members: 0, statements: 0 },
    { code: 'const { nested: { value }, ...rest } = input;', members: 0, statements: 1 }
].forEach(({ code = '', members: count = 0, statements: statementCount = 0 } = {}) => {
    const normalize = ({ members = [], statements = [] } = {}) => ({
        members: Array.from(members, ({ propertyName = '', alias = '', defaultInitializer = false } = {}) => ({
            propertyName, alias, initializer: defaultInitializer ? defaultInitializer.getText() : ''
        })), statements: Array.from(statements, statement => statement.getText())
    });
    const actual = reuse({ code });
    const { members = [], statements = [] } = actual;
    assert.equal(members.length, count);
    assert.equal(statements.length, statementCount);
    assert.deepEqual(normalize(actual), normalize(reuse({ code, original: true })));
});

const fixtureCodes = [
    'function read([value, ...tail]: number[]) { return [value, tail]; }',
    'function read([value = 7, ...tail]: number[]) { return [value, tail]; }',
    'function read([, value]: number[]) { return value; }',
    'function read([]: number[]) { return 0; }',
    'function read({ value }: { value: number }) { return value; }',
    'function read(input: { value: number; other: number }) { const { other: prior = 2 } = input; return [input.value, prior, input]; }',
    'function read(input: { value: number }) { const { value, ...rest } = input; return [input.value, value, rest]; }',
    'function read(input: { value: number }) { const { value } = other; return input.value; }'
];
const parsedSources = new Map(fixtureCodes.flatMap((code = '', index = 0) => [true, false].map((original) => {
    const file = `rest-${index}-${original}.ts`;

    return [file, parse(code, file)];
})));
const compilerOptions = { strict: true, target: typescript.ScriptTarget.ESNext };
const host = typescript.createCompilerHost(compilerOptions);
const program = typescript.createProgram([...parsedSources.keys()], compilerOptions, {
    ...host, getSourceFile: (file, version) => parsedSources.get(file) || host.getSourceFile(file, version)
});
const print = ({ node = {}, sourceFile = {} } = {}) => typescript.createPrinter().printNode(typescript.EmitHint.Unspecified, node, sourceFile);
fixtureCodes.forEach((code = '', index = 0) => {
    const outputs = [true, false].map((original = false) => {
        const file = `rest-${index}-${original}.ts`;
        const sourceFile = parsedSources.get(file);
        const placement = compilePlacementDecisions({ typescript, evidence: collectPlacementEvidence({ typescript, sourceFile, checker: program.getTypeChecker() }) });
        const [owner = {}] = matching({ root: sourceFile, accepts: node => typescript.isFunctionDeclaration(node) });
        const variant = original ? 0 : 1;
        const [indexModule = {}] = indexModules.slice(variant, variant + 1);
        const [genericModule = {}] = genericModules.slice(variant, variant + 1);
        const { updateBindingPattern = false } = indexModule;
        const { lowerGenericMemberAccess = false } = genericModule;
        const [pattern = {}] = matching({ root: owner, accepts: node => typescript.isArrayBindingPattern(node) || typescript.isObjectBindingPattern(node) });
        const { transformed: [placed = owner] = [], dispose = () => {} } = typescript.transform(owner, [context => node => (
            lowerGenericMemberAccess({ typescript, node, sourceFile, placement, context })
        )]);
        let updates = 0;
        const factory = { ...typescript.factory, updateBindingElement: (...args) => {
            const [element = {}, token = undefined] = args;
            const { dotDotDotToken: originalToken = undefined } = element;
            assert.equal(token, originalToken, 'Query defaults never become compiler factory arguments.');
            updates += 1;

            return typescript.factory.updateBindingElement(...args);
        } };
        const updated = updateBindingPattern({ typescript: { ...typescript, factory }, pattern, sourceFile, placement });
        const acceptsRest = (node = {}) => {
            const { dotDotDotToken = false } = node;

            return typescript.isBindingElement(node) && Boolean(dotDotDotToken);
        };
        const rest = matching({ root: pattern, accepts: acceptsRest });
        const updatedRest = matching({ root: updated, accepts: acceptsRest });
        assert.deepEqual(updatedRest, rest, 'A retained rest element and token keep their original identity.');
        const originalNode = typescript.getOriginalNode(updated);
        assert.equal(originalNode, pattern, 'Pattern update keeps compiler original-node provenance.');
        const result = { pattern: print({ node: updated, sourceFile }), generic: print({ node: placed, sourceFile }), updates };
        dispose();

        return result;
    });
    const [before = {}, after = {}] = outputs;
    assert.deepEqual(after, before, code);
});

const [oldIndex = {}, currentIndex = {}] = indexModules;
const { updateBindingPattern: oldUpdate = false } = oldIndex;
const { updateBindingPattern: currentUpdate = false } = currentIndex;
[oldUpdate, currentUpdate].forEach((update = false) => {
    const identifier = typescript.factory.createIdentifier('input');
    assert.equal(update({ typescript, pattern: identifier }), identifier, 'Non-binding patterns reject this owner.');
    const root = parse('const [value] = input;');
    const [pattern = {}] = matching({ root, accepts: node => typescript.isArrayBindingPattern(node) });
    const { elements: [element = {}] = [] } = pattern;
    const failure = new Error('unused token must not be read');
    Object.defineProperty(element, 'dotDotDotToken', { get() { throw failure; } });
    const result = update({ typescript, pattern, destructuringAgreements: compileDestructuringDecisions(new Map([
        [getConsumerContractKey(element), [{ kind: 'unused-binding', contract: { action: 'elide-unused-tuple-slot' } }]]
    ])) });
    const { elements: [slot = {}] = [] } = result;
    assert.equal(typescript.isOmittedExpression(slot), true, 'Unused-slot Policy precedes the token query.');
});
