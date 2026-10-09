import { deepStrictEqual, ok } from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import plugin from 'eslint-plugin-resilient/eslint';

const { rules = [] } = JSON.parse(readFileSync(new URL('../config/rule-inventory.json', import.meta.url), 'utf8'));

test('every inventoried rule is delivered and has maintained public coverage', () => {
    deepStrictEqual(Object.keys(plugin.rules).toSorted(), rules.map(({ name = '' } = {}) => name).toSorted());
    rules.forEach(({ coverage = [] } = {}) => {
        ok(coverage.some(path => path.startsWith('tests/')));
        coverage.forEach(path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
    });
});
