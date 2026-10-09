import assert from 'node:assert/strict';

import typescript from 'typescript';

import {
    getSourceRange,
    markGuardedNode,
    updateBindingInitializer,
    updateCallArguments,
    updateFunction,
    updateIfBranches,
    updateVariableDeclarationFields,
    updateVariableInitializer,
    wrapExpressionArrowBody
} from '../transforms/utils/ast-boundary.js';

const { factory = {}, ScriptTarget: { Latest = 99 } = {} } = typescript;

const { statements: [sourceRangeNode = {}] = [] } = typescript.createSourceFile('range.ts', 'const value = input;', Latest);
const rangeClone = factory.createIdentifier('clone');
typescript.setOriginalNode(rangeClone, sourceRangeNode);
const sourceRange = `${sourceRangeNode.pos}:${sourceRangeNode.end}`;

assert.equal(getSourceRange({ typescript, node: sourceRangeNode }), sourceRange);
assert.equal(getSourceRange({ typescript, node: rangeClone }), sourceRange);
assert.equal(getSourceRange({ typescript: { getOriginalNode: () => ({ pos: -1, end: 3 }) }, node: rangeClone }), '');
assert.equal(getSourceRange({ typescript: { getOriginalNode: () => ({ pos: 4, end: 3 }) }, node: rangeClone }), '');
const rangeFailure = new Error('source range metadata');
assert.throws(() => getSourceRange({ typescript: { getOriginalNode: () => { throw rangeFailure; } }, node: rangeClone }),
    error => error === rangeFailure);

const guardedNode = {};
assert.equal(markGuardedNode(guardedNode), guardedNode);
assert.deepEqual(Object.getOwnPropertyDescriptor(guardedNode, '__resilientGuarded'), {
    configurable: true, enumerable: false, writable: false, value: true
});
assert.throws(() => markGuardedNode(Object.preventExtensions({})), TypeError);

['if (ready) run();', 'if (ready) run(); else stop();'].forEach((code) => {
    const file = typescript.createSourceFile('branches.ts', code, Latest, true);
    const { statements: [statement = {}] = [] } = file;
    const unchanged = updateIfBranches({ factory, statement, transform: branch => branch });
    assert.equal(unchanged, statement);
    const replacement = factory.createExpressionStatement(factory.createCallExpression(
        factory.createIdentifier('changed'), undefined, []
    ));
    let visited = [];
    const updated = updateIfBranches({ factory, statement, transform: (branch) => {
        visited = [...visited, branch];

        return branch ? replacement : branch;
    } });
    assert.deepEqual(visited, [Reflect.get(statement, 'thenStatement'), Reflect.get(statement, 'elseStatement')]);
    assert.equal(Reflect.get(updated, 'expression'), Reflect.get(statement, 'expression'));
    assert.equal(Reflect.get(updated, 'thenStatement'), replacement);
    assert.equal(Reflect.get(updated, 'elseStatement'), code.includes('else') ? replacement : undefined);
    assert.equal(typescript.getOriginalNode(updated), statement);
    assert.equal(typescript.createPrinter().printNode(typescript.EmitHint.Unspecified, updated, file),
        code.includes('else') ? 'if (ready)\n    changed();\nelse\n    changed();' : 'if (ready)\n    changed();');
});
assert.throws(() => updateIfBranches({ factory, statement: {}, transform: branch => branch }), {
    name: 'TypeError', message: 'A variable declaration name is required.'
});
const branchFailure = new Error('branch transformation');
const { statements: [failureStatement = {}] = [] } = typescript.createSourceFile('failure.ts', 'if (ready) run();', Latest);
let branchCalls = [];
assert.throws(() => updateIfBranches({ factory, statement: failureStatement, transform: (branch) => {
    branchCalls = [...branchCalls, branch];
    throw branchFailure;
} }), error => error === branchFailure);
assert.deepEqual(branchCalls, [Reflect.get(failureStatement, 'thenStatement')]);

[
    'const result = "before";',
    'export const result: string = "before";'
].forEach((code = '') => {
    const { statements: [statement = {}] = [] } = typescript.createSourceFile('boundary.ts', code, Latest);
    const { declarationList = {} } = statement;
    const { declarations: [declaration = {}] = [] } = declarationList;
    const { initializer = {} } = declaration;
    const collection = { statement, declarationList, declaration };

    // The declaration retains identity when its initializer is unchanged,
    // including when optional token and annotation fields are absent.
    const { declarationList: { declarations: [unchanged = {}] = [] } = {} }
        = updateVariableInitializer({ factory, collection, initializer });

    assert.equal(unchanged, declaration);

    const replacement = factory.createStringLiteral('after');
    const updated = updateVariableInitializer({ factory, collection, initializer: replacement });
    const { declarationList: updatedList = {} } = updated;
    const { declarations: [updatedDeclaration = {}] = [] } = updatedList;
    const { initializer: updatedInitializer = {} } = updatedDeclaration;
    const { initializer: originalInitializer = {} } = declaration;

    assert.equal(updatedInitializer, replacement);
    assert.equal(originalInitializer, initializer);
    assert.notEqual(updated, statement);
});

const { statements: [bindingStatement = {}] = [] } = typescript.createSourceFile(
    'binding.ts', 'const { key: value = "before", ...rest } = source;', Latest
);
const { declarationList: { declarations: [bindingDeclaration = {}] = [] } = {} } = bindingStatement;
const { name: { elements: [aliasedElement = {}, restElement = {}] = [] } = {} } = bindingDeclaration;
const { initializer: aliasInitializer = {} } = aliasedElement;

assert.equal(updateBindingInitializer({ factory, element: aliasedElement, initializer: aliasInitializer }), aliasedElement);
assert.equal(updateBindingInitializer({ factory, element: restElement }), restElement);

[
    'const item = 1;',
    'let item!: number;'
].forEach((code = '') => {
    const sourceFile = typescript.createSourceFile('declaration.ts', code, Latest);
    const { statements: [statement = {}] = [] } = sourceFile;
    const { declarationList: { declarations: [declaration = {}] = [] } = {} } = statement;
    const { name = {} } = declaration;
    const initializer = factory.createNumericLiteral(2);
    const updated = updateVariableDeclarationFields({ factory, declaration, name, initializer });
    assert.equal(Reflect.get(updated, 'exclamationToken'), Reflect.get(declaration, 'exclamationToken'));
    assert.equal(Reflect.get(updated, 'type'), Reflect.get(declaration, 'type'));
    assert.equal(typescript.getOriginalNode(updated), declaration);
    assert.equal(typescript.createPrinter().printNode(typescript.EmitHint.Unspecified, updated, sourceFile),
        code.startsWith('let') ? 'item!: number = 2' : 'item = 2');

    if (code.startsWith('let')) assert.equal(updateVariableDeclarationFields({
        factory, declaration, name
    }), declaration);
});
assert.throws(() => updateVariableDeclarationFields({ factory, declaration: {} }), {
    name: 'TypeError',
    message: 'A variable declaration name is required.'
});

[
    'const call = value => provider(value);',
    'const call = async <T>(value: T): Promise<T> => provider(value);'
].forEach((code = '') => {
    const sourceFile = typescript.createSourceFile('arrow.ts', code, Latest);
    const { statements: [statement = {}] = [] } = sourceFile;
    const { declarationList: { declarations: [declaration = {}] = [] } = {} } = statement;
    const { initializer: arrow = {} } = declaration;
    const { body: expression = {} } = arrow;
    const wrapped = wrapExpressionArrowBody({ typescript, node: arrow });
    const { body: block = {} } = wrapped;
    const { statements: [returned = {}] = [] } = block;
    const { expression: returnedExpression = {} } = returned;

    assert.equal(typescript.isBlock(block), true);
    assert.equal(typescript.isReturnStatement(returned), true);
    assert.equal(returnedExpression, expression);
    assert.equal(typescript.getOriginalNode(wrapped), arrow);
    ['modifiers', 'typeParameters', 'type', 'equalsGreaterThanToken'].forEach((field = '') => {
        assert.equal(Reflect.get(wrapped, field), Reflect.get(arrow, field));
    });
    assert.equal(typescript.createPrinter().printNode(typescript.EmitHint.Unspecified, wrapped, sourceFile),
        code.includes('async')
            ? 'async <T>(value: T): Promise<T> => {\n    return provider(value);\n}'
            : 'value => {\n    return provider(value);\n}');
});

const rejectedSource = typescript.createSourceFile('rejected.ts',
    'const block = value => { return value; }; function named(value) { return value; }', Latest);
const { statements: [blockStatement = {}, functionStatement = {}] = [] } = rejectedSource;
const { declarationList: { declarations: [blockDeclaration = {}] = [] } = {} } = blockStatement;
const { initializer: blockArrow = {} } = blockDeclaration;

assert.equal(wrapExpressionArrowBody({ typescript, node: blockArrow }), blockArrow);
assert.equal(wrapExpressionArrowBody({ typescript, node: functionStatement }), functionStatement);

[
    'function run(value) { return value; }',
    'export async function run<T>(value: T): Promise<T> { return value; }',
    'const run = function* named<T>(value: T): Generator<T> { yield value; };',
    'const run = function(value) { return value; };',
    'const run = value => value;',
    'const run = async <T>(value: T): Promise<T> => value;'
].forEach((code = '') => {
    const sourceFile = typescript.createSourceFile('function-boundary.ts', code, Latest);
    const { statements: [statement = {}] = [] } = sourceFile;
    const { declarationList: { declarations: [{ initializer = {} } = {}] = [] } = {} } = statement;
    const node = typescript.isFunctionDeclaration(statement) ? statement : initializer;
    const { parameters = [], body = {} } = node;

    assert.equal(updateFunction({ typescript, node, parameters, body }), node);

    const replacement = factory.createBlock([factory.createReturnStatement(factory.createStringLiteral('changed'))], true);
    const updated = updateFunction({ typescript, node, parameters, body: replacement });
    const { body: updatedBody = {}, parameters: updatedParameters = [] } = updated;

    assert.equal(updatedBody, replacement);
    assert.equal(updatedParameters, parameters);
    assert.equal(typescript.getOriginalNode(updated), node);
    ['modifiers', 'asteriskToken', 'name', 'typeParameters', 'type', 'equalsGreaterThanToken'].forEach((field = '') => {
        assert.equal(Reflect.get(updated, field), Reflect.get(node, field));
    });
    assert.match(typescript.createPrinter().printNode(typescript.EmitHint.Unspecified, updated, sourceFile), /return "changed";/u);
});

const { statements: [overload = {}] = [] } = typescript.createSourceFile(
    'overload.ts', 'declare function run(value: string): string;', Latest
);
assert.equal(updateFunction({ typescript, node: overload, body: factory.createBlock([]) }), overload);

['const result = invoke(value);', 'const result = invoke<string>(value);'].forEach((code = '') => {
    const sourceFile = typescript.createSourceFile('call.ts', code, Latest);
    const { statements: [statement = {}] = [] } = sourceFile;
    const { declarationList: { declarations: [{ initializer: call = {} } = {}] = [] } = {} } = statement;
    const { arguments: args = [], expression = {} } = call;

    assert.equal(updateCallArguments({ factory, call, args }), call);

    const replacement = factory.createStringLiteral('changed');
    const updated = updateCallArguments({ factory, call, args: [replacement] });
    const { expression: updatedExpression = {}, arguments: [argument = {}] = [] } = updated;

    assert.equal(updatedExpression, expression);
    assert.equal(argument, replacement);
    assert.equal(Reflect.get(updated, 'typeArguments'), Reflect.get(call, 'typeArguments'));
    assert.equal(typescript.getOriginalNode(updated), call);
});

const replacementBinding = updateBindingInitializer({
    factory, element: aliasedElement, initializer: factory.createStringLiteral('changed')
});
['dotDotDotToken', 'propertyName', 'name'].forEach((field = '') => {
    assert.equal(Reflect.get(replacementBinding, field), Reflect.get(aliasedElement, field));
});
assert.equal(typescript.getOriginalNode(replacementBinding), aliasedElement);
