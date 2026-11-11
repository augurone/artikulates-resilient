import { deepStrictEqual } from 'node:assert/strict';

export const assertFunctionSyntax = async (lint) => {
    const source = [
        'export const plain = function () {};',
        'export const named = function named() {};',
        'export const asynchronous = async function () {};',
        'export const generator = function* () {};',
        'export const asynchronousGenerator = async function* () {};',
        'export const record = { plain: function () {}, asynchronous: async function () {}, generator: function* () {} };',
        'export const arrow = () => 1;',
        'export const protocols = { get value() { return 1; }, set value(input) {}, method() {}, async asynchronous() {}, *iterator() {}, async *stream() {} };',
        'export const nested = { method() { return function () {}; } };',
        'export const optional = record?.plain;',
        'export class Declaration {}',
        'export const Expression = class {};'
    ].join('\n');
    const messages = await lint(source);

    deepStrictEqual(messages.filter(({ ruleId = '' } = {}) => ruleId === 'no-restricted-syntax')
        .map(({ line = 0, severity = 0 } = {}) => [line, severity]), [
        [1, 2], [2, 2], [3, 2], [4, 2], [5, 2], [6, 2], [6, 2], [6, 2], [9, 2], [10, 2], [11, 2], [12, 2]
    ]);
};
