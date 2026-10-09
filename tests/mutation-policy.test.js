import { deepStrictEqual, strictEqual, throws } from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

import { Linter } from 'eslint';

import plugin from 'eslint-plugin-resilient/eslint';

const mutation = 'resilient/prefer-safe-transformations';
const loops = 'resilient/prefer-prototype-methods';
const lint = (source, options = {}, rules = {}) => new Linter().verify(source, {
    plugins: { resilient: plugin }, rules: { [mutation]: ['error', options], ...rules }
});
const spans = (source, messages) => messages.map(({ column = 0, endColumn = 0 } = {}) => source.slice(column - 1, endColumn - 1));
const cases = JSON.parse(readFileSync(new URL('./fixtures/mutation-policy.json', import.meta.url), 'utf8'));

cases.forEach(({ source = '', options = [], findings = [] } = {}) => test(`mutation policy: ${source} ${JSON.stringify(options)}`, () => {
    deepStrictEqual(new Linter().verify(source, { plugins: { resilient: plugin }, rules: { [mutation]: ['error', ...options] } }), findings);
}));

const mutators = ['add', 'clear', 'copyWithin', 'delete', 'fill', 'pop', 'push', 'reverse', 'set', 'shift', 'sort', 'splice', 'unshift'];

mutators.forEach(method => test(`mutation method: ${method}`, () => {
    [`items.${method}(value);`, `items.${method}\`value\`;`].forEach((source) => {
        const findings = lint(source);

        deepStrictEqual(spans(source, findings), [source.slice(0, -1)]);
        strictEqual(findings.at(0).messageId, 'mutation');
        deepStrictEqual(lint(source, { ignoredProperties: [method] }), []);
    });
}));

[
    'items["push"](value)', 'items?.["push"](value)', '(items?.push)(value)',
    'items.push?.(value)', '(getItems()?.["push"])(value)',
    'items["push"]`value`', '(items?.push)`value`', 'getItems().push`value`'
].forEach(invocation => test(`mutation invocation: ${invocation}`, () => {
    const source = `${invocation};`;
    const findings = lint(source);
    const unnamed = invocation.includes('getItems');

    deepStrictEqual(spans(source, findings), [invocation]);
    strictEqual(findings.at(0).messageId, unnamed ? 'unnamedMutation' : 'mutation');
    deepStrictEqual(lint(source, { ignoredProperties: ['push'] }), []);
    strictEqual(lint(source, { ignoredBindings: ['items'] }).length, Number(unnamed));
    strictEqual(lint(source, { ignoredParameters: ['items'] }).length, Number(unnamed));
}));

[
    ['Object["assign"](state,source);', ['Object["assign"](state,source)']],
    ['(Object?.assign)(state,source);', ['(Object?.assign)(state,source)']],
    ['Object["assign"]({},source);Object.assign([],source);Object.assign();', []],
    ['delete state?.field;', ['delete state?.field']],
    ['delete state?.["field"];', ['delete state?.["field"]']],
    ['[target.value]=items;', ['target.value']],
    ['({value:target.value}=record);', ['target.value']],
    ['[target.value=defaults.value,...other.rest]=items;', ['target.value', 'other.rest']],
    ['({[reader.key]:target.value=defaults.value,...other.rest}=record);', ['target.value', 'other.rest']],
    ['[,{x:[target.value]}]=items;', ['target.value']],
    ['for(target.value of items){}', ['target.value']],
    ['for(target.value in record){}', ['target.value']],
    ['for({x:target.value} of items){}', ['target.value']],
    ['const run=async()=>{for await([target.value] of items){}};', ['target.value']],
    ['[getTarget().value,other[slot]]=items;', ['getTarget().value', 'other[slot]']],
    ['[target.value=(other.value=1)]=items;', ['target.value', 'other.value=1']],
    ['[target[keys.pop()]]=items;', ['target[keys.pop()]', 'keys.pop()']],
    ['const {value}=record;let [item]=items;for(const item of items){}', []],
    ['[value=reader.current]=items;({[reader.key]:value}=record);', []],
    ['items[method](value);items["pu"+"sh"](value);items[`push`](value);', []],
    ['const push=items.push;push(value);items.push.call(items,value);', []],
    ['Object.defineProperty(state,"value",descriptor);Reflect.defineProperty(state,"value",descriptor);', []]
].forEach(([source = '', expected = []] = []) => test(`mutation target ownership: ${source}`, () => {
    deepStrictEqual(spans(source, lint(source)), expected);
}));

[
    ['getRef()["current"]=true;', { ignoredProperties: ['current'] }, []],
    ['target[0]++;', { ignoredProperties: ['0'] }, []],
    ['target[""]++;', { ignoredProperties: [''] }, []],
    ['target[key]++;', { ignoredProperties: ['key', ''] }, ['target[key]++']],
    ['[draft.value,other.value]=items;', { ignoredParameters: ['draft'] }, ['other.value']],
    ['[cache.value,other.value]=items;', { ignoredBindings: ['cache'] }, ['other.value']],
    ['[getTarget().value,other["current"]]=items;', { ignoredProperties: ['current'] }, ['getTarget().value']],
    ['[getTarget().value]=items;', { ignoredBindings: ['getTarget', ''], ignoredParameters: ['getTarget', ''] }, ['getTarget().value']],
    ['for(cache.value of items)other.value=cache.value;', { ignoredBindings: ['cache'] }, ['other.value=cache.value']],
    ['delete target?.["current"];', { ignoredProperties: ['current'] }, []]
].forEach(([source = '', options = {}, expected = []] = []) => test(`configured mutation boundaries: ${source}`, () => {
    deepStrictEqual(spans(source, lint(source, options)), expected);
}));

[
    'for(;;)break;', 'for(const key in record)consume(key);', 'for(const item of items)consume(item);',
    'while(flag)consume();', 'do{consume();}while(flag);', 'const run=async()=>{for await(const item of items)await consume(item);};',
    'const run=()=>{for(const item of items){if(item)return item;throw item;}};'
].forEach(source => test(`loop constraints remain findings: ${source}`, () => {
    const messages = lint(source, {}, { [loops]: 'error' });

    strictEqual(messages.length, 1);
    strictEqual(messages.at(0).ruleId, loops);
    const { output = '', fixed = true } = new Linter().verifyAndFix(source, { plugins: { resilient: plugin }, rules: { [loops]: 'error' } });

    strictEqual(output, source);
    strictEqual(fixed, false);
}));

test('a retained loop does not exempt nested mutations, and mutation options do not exempt the loop', () => {
    const body = 'for(target.value of items)output["push"](target.value);';
    const source = `// eslint-disable-next-line ${loops} -- Preserve live iterator order.\n${body}`;

    deepStrictEqual(lint(source, {}, { [loops]: 'error' }).map(({ ruleId = '' } = {}) => ruleId), [mutation, mutation]);
    deepStrictEqual(lint(body, { ignoredBindings: ['target', 'output'] }, { [loops]: 'error' }).map(({ ruleId = '' } = {}) => ruleId), [loops]);
});

test('presets, severity, options and reused host syntax keep their contracts', () => {
    strictEqual(plugin.configs.recommended.rules[loops], 'error');
    strictEqual(plugin.configs.safety.rules[mutation], 'error');
    const engine = new Linter();
    const source = 'items["push"](value);';
    const config = { plugins: { resilient: plugin }, rules: { [mutation]: 'warn' } };
    const original = engine.verify(source, config);
    const host = engine.getSourceCode();

    strictEqual(original.at(0).severity, 1);
    deepStrictEqual(engine.verify(host, { ...config, rules: { [mutation]: ['error', { ignoredBindings: ['items'] }] } }), []);
    deepStrictEqual(engine.verify(host, config), original);
    throws(() => engine.verify(source, { ...config, rules: { [mutation]: ['error', { ignoredBindings: true }] } }));
});

[
    ['items[method]`value`;', 0],
    ['items[`push`]`value`;', 0],
    ['const push=items.push;push`value`;', 0],
    ['Object.assign`value`;', 0],
    ['getItems().push`value`;', 1],
    ['items.push`${other.pop()}`;', 2],
    ['items.push`${other.value=1}`;', 2],
    ['items.push`${other.clear`value`}`;', 2],
    ['(items?.push)`value`;', 1]
].forEach(([source = '', expected = 0] = []) => test(`tag boundary and nested effects: ${source}`, () => {
    strictEqual(lint(source).length, expected);
}));

test('tagged mutation has a runtime witness with preserved receiver and argument order', () => {
    const source = 'const items=[];const seen=[];items.push`value${seen.push("effect")}`;JSON.stringify([items.length,items[0][0],items[1],seen]);';

    strictEqual(runInNewContext(source), '[2,"value",1,["effect"]]');
    strictEqual(lint(source).length, 2);
});

test('tagged receiver calls do not borrow their callee names for exceptions', () => {
    const source = 'getItems().push`value`;';

    strictEqual(lint(source, { ignoredBindings: ['getItems', ''], ignoredParameters: ['getItems', ''] }).length, 1);
});

test('tagged findings retain multiline spans and independent loop exceptions', () => {
    const source = '// eslint-disable-next-line resilient/prefer-prototype-methods -- Preserve live iteration.\nfor(const item of items) bucket.push`\n${item}\n`;';
    const messages = new Linter().verify(source, { plugins: { resilient: plugin }, rules: { [mutation]: 'error', 'resilient/prefer-prototype-methods': 'error' } });

    strictEqual(messages.length, 1);
    const [{ ruleId = '', line = 0, column = 0, endLine = 0, endColumn = 0 } = {}] = messages;

    strictEqual(ruleId, mutation);
    deepStrictEqual([line, column, endLine, endColumn], [2, 26, 4, 2]);
});

test('native effects and syntactic mutation are independent consumers', () => {
    const source = 'const state={items:[]};state.items="";state.items.map(value=>value);';
    const findings = lint(source, {}, { 'resilient/signature-contract-operation': 'error' });

    deepStrictEqual(findings.map(({ ruleId = '' } = {}) => ruleId), [mutation, 'resilient/signature-contract-operation']);
});

test('mutation policy reports every target without an automatic rewrite', () => {
    const source = 'state.value=1;items.push(value);items.push`value`;delete state.value;';
    const expected = lint(source);
    const { output = '', fixed = true, messages = [] } = new Linter().verifyAndFix(source, {
        plugins: { resilient: plugin }, rules: { [mutation]: 'error' }
    });

    strictEqual(output, source);
    strictEqual(fixed, false);
    deepStrictEqual(messages, expected);
    messages.forEach(({ fix = false, suggestions = [] } = {}) => {
        strictEqual(fix, false);
        deepStrictEqual(suggestions, []);
    });
});

test('mutation reporting failures remain operational through the lint host', () => {
    const failure = new Error('mutation report failed');
    const implementation = Reflect.get(plugin.rules, 'prefer-safe-transformations');
    const broken = { ...implementation, create() {
        return implementation.create({ report() { throw failure; } });
    } };

    throws(() => new Linter().verify('items.push`value`;', {
        plugins: { probe: { rules: { mutation: broken } } }, rules: { 'probe/mutation': 'error' }
    }), error => error === failure);
});
