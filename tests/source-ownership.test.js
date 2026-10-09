import { deepStrictEqual, notStrictEqual, ok, strictEqual, throws } from 'node:assert/strict';
import test from 'node:test';

import { parse } from 'espree';

import { createOwner, fromESTree, isCurrent, replaceEvidence, request, unresolved } from 'eslint-plugin-resilient/agreement';

const families = ['string', 'number', 'boolean', 'regexp', 'nullish'];
const expression = (source) => {
    const { body: [{ expression: node = false } = {}] = [] } = parse(`(${source})`, { ecmaVersion: 'latest', sourceType: 'module' });

    return node;
};
const evidence = source => fromESTree(expression(source));
const own = source => createOwner({ evidence: evidence(source) });
test('literal families remain known, including their falsey members', () => {
    [
        ['"text"', 'string'], ['""', 'string'], ['42', 'number'], ['0', 'number'],
        ['true', 'boolean'], ['false', 'boolean'], ['/value/gi', 'regexp'], ['/(?:)/', 'regexp'], ['null', 'nullish']
    ].forEach(([source = '', family = ''] = []) => {
        const owner = own(source);

        families.forEach((required) => {
            const { fact = false, status = '' } = request({ owner, required });
            const { state = '', family: actual = '' } = fact;

            strictEqual(state, 'known');
            strictEqual(actual, family);
            strictEqual(status, family === required ? 'agreement' : 'contradiction');
            ok(Object.isFrozen(fact));
        });
    });
});

test('independent consumers share source knowledge and automatically see replacement', () => {
    const label = own('"foundation"');
    const unrelated = own('false');
    const caption = () => request({ owner: label, required: 'string', consumer: 'caption' });
    const counter = () => request({ owner: label, required: 'number', consumer: 'counter' });

    const first = caption();
    const mismatch = counter();
    const second = caption();
    const { fact = false, status: firstStatus = '' } = first;

    const { status: mismatchStatus = '', fact: mismatchFact = false } = mismatch;
    const { fact: secondFact = false } = second;

    strictEqual(firstStatus, 'agreement');
    strictEqual(mismatchStatus, 'contradiction');
    strictEqual(mismatchFact, fact);
    strictEqual(secondFact, fact);

    replaceEvidence({ owner: unrelated, evidence: evidence('true') });

    strictEqual(isCurrent(first), true);
    strictEqual(caption().fact, fact);

    strictEqual(replaceEvidence({ owner: label, evidence: evidence('7') }), label);
    strictEqual(isCurrent(first), false);

    const changed = caption();

    const { status: changedStatus = '', fact: changedFact = false } = changed;
    const { family: changedFamily = '' } = changedFact;

    strictEqual(changedStatus, 'contradiction');
    strictEqual(changedFamily, 'number');
    strictEqual(counter().status, 'agreement');
    strictEqual(isCurrent(changed), true);
    notStrictEqual(changedFact, fact);
});

test('unknown is retained by its owner until evidence changes, without erasing other knowledge', () => {
    const owner = createOwner({ evidence: unresolved({ reason: 'Awaiting evidence' }) });
    const independent = request({ owner: own('"known"'), required: 'number' });
    const first = request({ owner, required: 'string' });
    const repeated = request({ owner, required: 'number' });

    const { status: firstStatus = '', fact: firstFact = false } = first;
    const { status: repeatedStatus = '', fact: repeatedFact = false } = repeated;
    const { reason = '' } = firstFact;
    const { status: independentStatus = '' } = independent;

    strictEqual(firstStatus, 'unknown');
    strictEqual(repeatedStatus, 'unknown');
    strictEqual(repeatedFact, firstFact);
    strictEqual(reason, 'Awaiting evidence');
    strictEqual(independentStatus, 'contradiction');
    strictEqual(isCurrent(independent), true);

    replaceEvidence({ owner, evidence: evidence('"ready"') });

    strictEqual(isCurrent(first), false);
    strictEqual(request({ owner, required: 'string' }).status, 'agreement');
});

test('request ordering cannot redefine source evidence', () => {
    const answers = (source, requirements) => {
        const owner = createOwner({ evidence: source });

        return Object.fromEntries(requirements.map((required) => {
            const { status = '' } = request({ owner, required });

            return [required, status];
        }));
    };

    [evidence('""'), evidence('0'), unresolved()].forEach((source) => {
        deepStrictEqual(answers(source, families), answers(source, families.toReversed()));
    });
});

test('each replacement expires historical judgments, even when replacing with identical evidence', () => {
    const source = evidence('"same"');
    const owner = createOwner({ evidence: source });
    const first = request({ owner, required: 'string' });

    replaceEvidence({ owner, evidence: source });

    const second = request({ owner, required: 'string' });

    strictEqual(isCurrent(first), false);
    strictEqual(isCurrent(second), true);
    const { fact: { version: firstVersion = false } = {} } = first;
    const { fact: { version: secondVersion = false } = {} } = second;

    notStrictEqual(firstVersion, secondVersion);
    throws(() => request({ owner: Object.freeze({}), required: 'string' }), TypeError);
});

test('AST edits cannot silently change the owned premise', () => {
    const node = expression('"captured"');
    const owner = createOwner({ evidence: fromESTree(node) });

    // This deliberate external AST edit checks that source evidence was captured independently.
    Object.defineProperties(node, { type: { value: 'Identifier' }, value: { value: 42 } });

    strictEqual(request({ owner, required: 'string' }).status, 'agreement');
});

test('unsupported forms remain stable unknowns', () => {
    ['1n', '-1', '-0', 'undefined'].forEach((source) => {
        const owner = own(source);

        families.forEach((required) => {
            const { status = '', fact = false } = request({ owner, required });

            strictEqual(status, 'unknown');
            strictEqual(Object.hasOwn(fact, 'family'), false);
        });
    });
});

test('invalid boundaries, parsing errors, and observer failures remain failures', () => {
    const owner = own('"valid"');

    throws(() => request({ owner, required: 'imaginary' }), TypeError);
    throws(() => request({ required: 'string' }), TypeError);
    throws(() => fromESTree(), TypeError);
    throws(() => createOwner(), TypeError);
    throws(() => replaceEvidence(), TypeError);
    throws(() => expression('('), SyntaxError);
    strictEqual(isCurrent(), false);

    ['establishment', 'literal-classification', 'judgment'].forEach((failedKind) => {
        const failure = new Error(failedKind);
        const fail = ({ kind = '' } = {}) => {
            if (kind !== failedKind) return;

            throw failure;
        };

        throws(() => request({ owner: own('"value"'), required: 'string', onWork: fail }), error => error === failure);
    });
});

test('replacement during observation cannot publish stale knowledge', () => {
    const owner = own('"before"');
    const replacement = evidence('42');
    const onWork = ({ kind = '' } = {}) => {
        if (kind !== 'literal-classification') return;

        replaceEvidence({ owner, evidence: replacement });
    };

    throws(() => request({ owner, required: 'string', onWork }), /Source changed during request/);
    strictEqual(request({ owner, required: 'number' }).status, 'agreement');
});

['establishment', 'literal-classification', 'judgment'].forEach((nestedAt) => {
    test(`nested demand during ${nestedAt} observes the single published source fact`, () => {
        const owner = own('"shared"');
        let nested = false;
        const onWork = ({ kind = '' } = {}) => {
            if (kind !== nestedAt) return;

            nested = request({ owner, required: 'number', consumer: 'nested' });
        };
        const outer = request({ owner, required: 'string', consumer: 'outer', onWork });
        const later = request({ owner, required: 'string' });

        const { status: outerStatus = '', fact: outerFact = false } = outer;
        const { status: nestedStatus = '', fact: nestedFact = false } = nested;
        const { fact: laterFact = false } = later;

        strictEqual(outerStatus, 'agreement');
        strictEqual(nestedStatus, 'contradiction');
        strictEqual(nestedFact, outerFact);
        strictEqual(laterFact, outerFact);
        strictEqual(isCurrent(nested), true);
    });
});
