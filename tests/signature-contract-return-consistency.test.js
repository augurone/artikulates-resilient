import { RuleTester } from 'eslint';

import rule from '../rules/signature-contract-return-consistency.js';

const ruleTester = new RuleTester({
    languageOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module'
    }
});

ruleTester.run('signature-contract-return-consistency', rule, {
    valid: [
        { code: 'const getItems = (enabled) => { if (!enabled) return []; return []; };' },
        { code: 'const passthrough = value => value;' },
        { code: 'const getValue = (value) => { if (!value) return value; return unknownValue; };' },
        { code: 'const getValue = (value) => { if (value) return []; return unknownValue; };' },
        { code: 'const getValue = (value = {}) => { if (typeof value === "string") return value; return ""; };' },
        { code: 'const notify = func => { if (!isFunction(func)) return; func(); };' },
        { code: 'const notify = ({ onDone } = {}) => { if (typeof onDone !== "function") return; onDone(); };' },
        { code: 'const getItems = ({ items = [] } = {}) => items;' },
        { code: 'const run = flag => { if (flag) return; };' },
        { code: 'const fail = () => { throw Error("stop"); };' },
        {
            code: [
                'const getItems = async () => [];',
                'const getValue = async (enabled = false) => {',
                '    if (enabled) return [];',
                '    return getItems();',
                '};'
            ].join(' ')
        },
        { code: 'const read = () => { try { return []; } finally { return "ok"; } };' },
        { code: 'const read = () => { try { return []; } finally { const done = true; } };' },
        { code: 'const read = flag => { let value = ""; if (flag) return ""; try { return value; } finally { value = []; } };' },
        { code: 'const read = () => { try { throw Error("stop"); } finally {} return []; };' },
        { code: 'const read = () => { let value = "ok"; try { value = []; throw Error("stop"); } catch (error) { return value.map(Boolean); } return "unreachable"; };' },
        { code: 'const read = () => { outer: for (;;) { break outer; } return "ok"; };' },
        { code: 'const read = () => { while (true) { return []; } return "unreachable"; };' }
    ],
    invalid: [
        {
            code: 'const read = cb => { if (typeof cb !== "function") return [].forEach(() => {}); return ""; };',
            errors: [{ messageId: 'inconsistent' }, { messageId: 'inconsistent' }]
        },
        {
            code: 'const select = func => { if (typeof func !== "function") return; return func; };',
            errors: [{ messageId: 'inconsistent' }, { messageId: 'inconsistent' }]
        },
        {
            code: 'const getValue = flag => { if (flag) return ""; };',
            errors: [{ messageId: 'inconsistent' }, { messageId: 'inconsistent' }]
        },
        {
            code: 'const getValue = flag => { if (flag) return ""; return; };',
            errors: [{ messageId: 'inconsistent' }, { messageId: 'inconsistent' }]
        },
        {
            code: 'const read = flag => { let value = ""; if (flag) return 1; try { return value; } finally { value = 1; } };',
            errors: [{ messageId: 'inconsistent' }, { messageId: 'inconsistent' }]
        },
        {
            code: 'const read = flag => { try { return []; } finally { if (flag) return "ok"; } };',
            errors: [
                { messageId: 'inconsistent' },
                { messageId: 'inconsistent' }
            ]
        },
        {
            code: 'const isFunction = value => !!value; const select = func => { if (!isFunction(func)) return [].forEach(() => {}); return () => {}; };',
            errors: [
                { messageId: 'inconsistent' },
                { messageId: 'inconsistent' }
            ]
        },
        {
            code: 'const isFunction = value => typeof value === "function"; const select = func => { if (!isFunction(func)) return [].forEach(() => {}); return () => {}; };',
            errors: [{ messageId: 'inconsistent' }, { messageId: 'inconsistent' }]
        },
        {
            code: 'const select = func => { if (!isFunction(func)) return [].forEach(() => {}); return func; };',
            errors: [{ messageId: 'inconsistent' }, { messageId: 'inconsistent' }]
        },
        {
            code: 'const select = func => { if (typeof func !== "function") return [].forEach(() => {}); return func; };',
            errors: [{ messageId: 'inconsistent' }, { messageId: 'inconsistent' }]
        },
        {
            code: 'const select = func => { const isFunction = () => true; if (!isFunction(func)) return [].forEach(() => {}); return () => {}; };',
            errors: [
                { messageId: 'inconsistent' },
                { messageId: 'inconsistent' }
            ]
        },
        {
            code: 'const getValue = (enabled) => { if (enabled) return []; return ""; };',
            errors: [
                { messageId: 'inconsistent' },
                { messageId: 'inconsistent' }
            ]
        },
        {
            code: "const getValue = (enabled = false) => enabled ? '' : null;",
            errors: [
                { messageId: 'inconsistent' },
                { messageId: 'inconsistent' }
            ]
        },
        {
            code: "const getValue = (enabled = false) => { return enabled ? '' : null; };",
            errors: [
                { messageId: 'inconsistent' },
                { messageId: 'inconsistent' }
            ]
        },
        {
            code: 'const getValue = async (enabled = false) => { if (enabled) return []; return ""; };',
            errors: [
                { messageId: 'inconsistent' },
                { messageId: 'inconsistent' }
            ]
        },
        {
            code: 'const select = func => isFunction(func) ? func : [].forEach(() => {});',
            errors: [
                { messageId: 'inconsistent' },
                { messageId: 'inconsistent' }
            ]
        },
        {
            code: 'const select = func => { if (!func) return [].forEach(() => {}); return () => {}; };',
            errors: [
                { messageId: 'inconsistent' },
                { messageId: 'inconsistent' }
            ]
        },
        {
            code: 'const select = func => { if (func) return () => {}; return [].forEach(() => {}); };',
            errors: [
                { messageId: 'inconsistent' },
                { messageId: 'inconsistent' }
            ]
        },
        {
            code: [
                'const select = func => {',
                '    if (!isFunction(func)) {',
                '        if (func) return () => {};',
                '        return [].forEach(() => {});',
                '    }',
                '    return () => {};',
                '};'
            ].join(' '),
            errors: [
                { messageId: 'inconsistent' },
                { messageId: 'inconsistent' },
                { messageId: 'inconsistent' }
            ]
        },
        {
            code: [
                'const outer = func => {',
                '    if (!isFunction(func)) return () => {',
                '        if (func) return () => {};',
                '        return [].forEach(() => {});',
                '    };',
                '    return () => {};',
                '};'
            ].join(' '),
            errors: [
                { messageId: 'inconsistent' },
                { messageId: 'inconsistent' }
            ]
        }
    ]
});
