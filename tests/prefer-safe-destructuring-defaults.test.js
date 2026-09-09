import { RuleTester } from 'eslint';

import rule from '../rules/prefer-safe-destructuring-defaults.js';

const ruleTester = new RuleTester({
    languageOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module'
    }
});

ruleTester.run('prefer-safe-destructuring-defaults', rule, {
    valid: [
        { code: 'const getConfig = ({ config: { timBurton = "" } = {} } = {}) => timBurton;' },
        { code: 'const useState = value => [value, () => {}]; const [value, setValue] = useState(false);' },
        { code: 'const run = ({ onDone } = {}) => { if (isFunction(onDone)) onDone(); };' },
        {
            code: 'const run = ({ onDone } = {}) => { if (!isFunction(onDone)) return ""; return values.map(onDone).join(", "); };'
        },
        {
            code: 'const sort = ({ compare }) => values => { const sorted = values.slice(); if (!isFunction(compare)) return; return sorted.toSorted(compare); };'
        },
        {
            code: 'function flow(first, ...args) { switch (arguments.length) { case 2: { const [second] = args; return first(second); } default: return first; } }'
        },
        {
            code: "const flow = (value, stage) => () => typeof stage === 'function' && stage(value); const lift = ({ of }) => value => flow(value, of);"
        },
        {
            code: 'const map = tuple => { if (!isArray(tuple) || tuple.length < 2) { return []; } const [a, state] = tuple; return [a, state]; };'
        },
        {
            code: 'const first = tuple => { if (!hasArrayContent(tuple)) { return ""; } const [value] = tuple; return value; };'
        },
        {
            code: 'const run = M => value => M.chain(value, tuple => { if (!isArray(tuple) || tuple.length < 2) { return M.of([]); } const [a, state] = tuple; return M.of([a, state]); });'
        },
        {
            code: 'const { values: [first = ""] } = { values: tuple };'
        },
        {
            code: [
                'const Some = (input = {}) => {',
                'const source = isObject(input) ? input : {};',
                "if ((isObject(input) && Reflect.has(input, 'value')) === false) throw new TypeError('Missing required agreement for value');",
                'const { value } = source;',
                'return { value };',
                '};'
            ].join(' ')
        },
        {
            code: [
                'const Some = input => {',
                "const { _tag = '', value } = isObject(input) ? input : {};",
                'if (!_tag) return { _tag, value };',
                'return { ...input, _tag, value };',
                '};'
            ].join(' ')
        },
        {
            code: [
                'const Show = input => {',
                'const { show } = isObject(input) ? input : {};',
                'if (!isFunction(show)) return { show };',
                'return { ...input, show };',
                '};'
            ].join(' ')
        },
        {
            code: "const read = ei => { if (isLeft(ei)) { const { left } = ei; return left; } return ''; };"
        },
        {
            code: "const read = option => { if (isNone(option)) return ''; const { value } = option; return value; };"
        },
        {
            code: "const read = ei => { if (_.isLeft(ei)) return ''; const { right } = ei; return right; };"
        },
        {
            code: "const read = ei => { if (ei._tag === 'Left') { const { left } = ei; return left; } return ''; };"
        },
        {
            code: "const read = ei => { const { _tag: eiTag = '' } = ei; if (eiTag === 'Left') { const { left } = ei; return left; } return ''; };"
        },
        {
            code: "const read = ei => { const { _tag: eiTag = '' } = ei; if (eiTag === 'Left') return ''; const { right } = ei; return right; };"
        },
        {
            code: "const read = ei => { if (!isLeft(ei)) return ''; const { left } = ei; return left; };"
        },
        {
            code: "const read = (ei, other) => { if (isRight(ei)) return ''; if (isLeft(other)) { const { left } = ei; return left; } return ''; };"
        },
        {
            code: "const read = ei => isLeft(ei) ? (({ left }) => left)(ei) : '';"
        },
        {
            code: "const read = option => isNone(option) ? '' : (({ value }) => value)(option);"
        },
        {
            code: [
                'const join = (ma, f) => {',
                'const { value, forest = [] } = f(ma);',
                'const { concat } = A.getMonoid();',
                'if (!isFunction(concat)) return { value, forest: [] };',
                'return { value, forest: concat(forest, ma.forest) };',
                '};'
            ].join(' ')
        },
        {
            code: 'const forward = FWI => { return { reduce: (({ reduce: FWIReduce }) => FWIReduce)(FWI) }; };'
        },
        {
            code: 'const project = values => values.map(value => (({ empty: valueEmpty }) => valueEmpty)(value));'
        },
        {
            code: "const foldMap = M => f => fa => { if (isLeft(fa)) { const { empty: MEmpty } = M; return MEmpty; } return f(fa.right); };"
        },
        {
            code: "const tailRec = (start, f) => { let result = f(start); while (result._tag === 'Left') { result = f(result.left); } const { right } = result; return right; };"
        },
        {
            code: "const read = ei => { if (isLeft(ei)) return ''; else { const { right } = ei; return right; } };"
        }
    ],
    invalid: [
        {
            code: 'const getConfig = ({ config: { timBurton } = {} } = {}) => timBurton;',
            errors: [{ messageId: 'safeDefault' }]
        },
        {
            code: 'const getConfig = ({ config } = {}) => config;',
            errors: [{ messageId: 'safeDefault' }]
        },
        {
            code: 'const getFirst = ([item] = []) => item;',
            errors: [{ messageId: 'safeDefault' }]
        },
        {
            code: 'const map = tuple => { if (!isArray(tuple)) return []; const [a, state] = tuple; return [a, state]; };',
            errors: [{ messageId: 'safeDefault' }, { messageId: 'safeDefault' }]
        },
        {
            code: 'const run = M => value => M.chain(value, tuple => { if (!isArray(tuple) || tuple.length < 2) return other.of([]); const [a, state] = tuple; return M.of([a, state]); });',
            errors: [{ messageId: 'safeDefault' }, { messageId: 'safeDefault' }]
        },
        {
            code: 'const run = ({ onDone }) => { const later = () => onDone(); return later; };',
            errors: [{ messageId: 'safeDefault' }]
        },
        {
            code: 'const flow = (...args) => { const [first] = args; return first; };',
            errors: [{ messageId: 'safeDefault' }]
        },
        {
            code: 'const source = {}; const { value } = source;',
            errors: [{ messageId: 'safeDefault' }]
        },
        {
            code: [
                'const Some = input => {',
                "const { _tag = '', value } = isObject(input) ? input : {};",
                'if (!_tag) return {};',
                'return { _tag, value };',
                '};'
            ].join(' '),
            errors: [{ messageId: 'safeDefault' }]
        },
        {
            code: "const read = ei => { if (isLeft(ei)) { const { right } = ei; return right; } return ''; };",
            errors: [{ messageId: 'safeDefault' }]
        },
        {
            code: "const read = ei => { const { _tag: eiTag = '' } = ei; eiTag = 'Left'; if (eiTag === 'Left') { const { left } = ei; return left; } return ''; };",
            errors: [{ messageId: 'safeDefault' }]
        },
        {
            code: "const read = ei => { const { _tag: eiTag = '' } = ei; if (eiTag === 'Left') { const { right } = ei; return right; } return ''; };",
            errors: [{ messageId: 'safeDefault' }]
        },
        {
            code: "const read = ei => isLeft(ei) ? (({ right }) => right)(ei) : '';",
            errors: [{ messageId: 'safeDefault' }]
        },
        {
            code: "const read = ei => isLeft(ei) ? (({ left }) => other)(ei) : '';",
            errors: [{ messageId: 'safeDefault' }]
        },
        {
            code: "const read = ei => { if (isWhatever(ei)) { const { left } = ei; return left; } return ''; };",
            errors: [{ messageId: 'safeDefault' }]
        },
        {
            code: "const read = option => { if (isNone(option)) { const { value } = option; return value; } return ''; };",
            errors: [{ messageId: 'safeDefault' }]
        },
        {
            code: "const read = ei => { if (!isLeft(ei)) return ''; const { right } = ei; return right; };",
            errors: [{ messageId: 'safeDefault' }]
        },
        {
            code: "const read = (ei, other) => { if (isRight(ei)) return ''; ei = other; if (isLeft(other)) { const { left } = ei; return left; } return ''; };",
            errors: [{ messageId: 'safeDefault' }]
        },
        {
            code: 'const run = ({ onDone }) => onDone();',
            errors: [{ messageId: 'safeDefault' }]
        },
        {
            code: 'const run = ({ onDone }) => values.map(onDone).join(", ");',
            errors: [{ messageId: 'safeDefault' }]
        },
        {
            code: 'const flow = (value, next) => next(value); const lift = ({ of }) => value => flow(value, of);',
            errors: [{ messageId: 'safeDefault' }]
        },
        {
            code: "import { flow } from 'external-flow'; const lift = ({ of }) => value => flow(value, of);",
            errors: [{ messageId: 'safeDefault' }]
        },
        {
            code: 'const forward = FWI => ({ reduce: (({ reduce: FWIReduce }) => FWIReduce)(FWI) });',
            errors: [{ messageId: 'safeDefault' }]
        },
        {
            code: 'const project = values => values.map(value => (({ empty: valueEmpty }) => other)(value));',
            errors: [{ messageId: 'safeDefault' }]
        },
        {
            code: 'const project = values => values.filter(value => (({ empty: valueEmpty }) => valueEmpty)(value));',
            errors: [{ messageId: 'safeDefault' }]
        },
        {
            code: 'const forward = FWI => { return { reduce: (({ reduce: FWIReduce }) => other)(FWI) }; };',
            errors: [{ messageId: 'safeDefault' }]
        },
        {
            code: 'const forward = FWI => { return { reduce: (({ reduce: FWIReduce, foldMap: FWIFoldMap }) => FWIReduce)(FWI) }; };',
            errors: [{ messageId: 'safeDefault' }, { messageId: 'safeDefault' }]
        },
        {
            code: "const notFoldMap = M => fa => { if (isLeft(fa)) { const { empty: MEmpty } = M; return MEmpty; } return fa; };",
            errors: [{ messageId: 'safeDefault' }]
        },
        {
            code: "const tailRec = (start, f) => { let result = f(start); while (result._tag === 'Left') { result = f(result.left); } const { left } = result; return left; };",
            errors: [{ messageId: 'safeDefault' }]
        },
        {
            code: 'const run = ({ onDone } = {}) => { if (isFunction(onDone)) return values[method](onDone); return ""; };',
            errors: [{ messageId: 'safeDefault' }]
        },
        {
            code: 'const sort = ({ compare }) => values => { if (!isFunction(compare)) return; return values[method](compare); };',
            errors: [{ messageId: 'safeDefault' }]
        },
        {
            code: 'const run = ({ onDone } = {}) => { const output = values.map(onDone); if (!isFunction(onDone)) return ""; return output; };',
            errors: [{ messageId: 'safeDefault' }]
        },
        {
            code: [
                'const join = (ma, f) => {',
                'const { value, forest = [] } = f(ma);',
                'const { concat } = A.getMonoid();',
                'if (!isFunction(concat)) return { value, forest: {} };',
                'return { value, forest: concat(forest, ma.forest) };',
                '};'
            ].join(' '),
            errors: [{ messageId: 'safeDefault' }]
        }
    ]
});
