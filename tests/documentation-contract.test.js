import assert from 'node:assert/strict';
import fs from 'node:fs';

import resilient from 'eslint-plugin-resilient';

const requiredSections = [
    '## What this finding means',
    '## Boundaries and non-goals',
    '## Repair recipes'
];

const getDocumentPath = (url = '') => new URL(
    new URL(url).pathname.replace('/augurone/artikulates-resilient/blob/main/', '../'),
    import.meta.url
);

Object.entries(resilient.rules).forEach(([ruleName = '', rule = {}] = []) => {
    const { meta: { docs: { url = '' } = {} } = {} } = rule;
    const document = fs.readFileSync(getDocumentPath(url), 'utf8');

    requiredSections.forEach(section => assert.ok(document.includes(section), `${ruleName}: ${section}`));
    assert.ok(document.includes('```javascript'), `${ruleName}: representation example`);
});

const diagnosticGuide = fs.readFileSync(new URL('../docs/guide/diagnostic-explanations.md', import.meta.url), 'utf8');
const objectionsGuide = fs.readFileSync(new URL('../docs/guide/overcoming-objections.md', import.meta.url), 'utf8');

assert.ok(diagnosticGuide.includes('## Contract diagnostic map'));
assert.match(diagnosticGuide, /ESLint documentation\s+metadata/u);
assert.ok(objectionsGuide.includes('## From an objection to a repair'));
