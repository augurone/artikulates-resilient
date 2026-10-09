import { empty, freezeItems, put } from './collections.js';
import { fresh } from './knowledge.js';
import { evaluate } from './obligations.js';
import { work, deliver } from './observation.js';
import { describe } from './requirements.js';
import { sourceOf } from './source-owners.js';

// Own registered consumer judgments, currentness guards, and observer delivery.
const judgments = new WeakMap();

export const isCurrent = (judgment) => {
    const record = judgments.get(judgment);

    if (!record) return false;

    const { facts = empty } = record;

    return facts.every(fresh);
};

export const inspect = (judgment) => {
    const record = judgments.get(judgment);

    if (!record) throw new TypeError('Expected a registered judgment');

    const { outcome = '', facts = empty } = record;

    return Object.freeze({ historicalOutcome: outcome, current: isCurrent(judgment), facts });
};

// Accessors read the registered receiver at access time. Sharing their platform
// receiver preserves identity and avoids a closure per consumer request.
const judgmentPrototype = Object.freeze({
    get status() {
        const record = judgments.get(this);

        if (!record) throw new TypeError('Expected a registered judgment');

        const { facts = empty, outcome = '' } = record;

        if (!facts.every(fresh)) throw new Error('Stale judgment; request current source evidence');

        return outcome;
    },
    get consumer() {
        const { consumer = '' } = judgments.get(this);

        return consumer;
    },
    get required() {
        const { required = false } = judgments.get(this);

        return required;
    },
    get facts() {
        const { facts = empty } = judgments.get(this);

        return facts;
    },
    get fact() {
        // An empty conjunction has no first fact; retain the public accessor's
        // absent array-element result rather than inventing evidence.
        const { facts = empty } = judgments.get(this);

        return facts.at(0);
    }
});

export const request = ({ owner = false, required = false, consumer = '', onWork } = {}) => {
    sourceOf(owner);

    if (typeof consumer !== 'string') throw new TypeError('Expected a consumer label string');

    const obligation = describe(required);
    const observation = typeof onWork === 'function' ? { events: [] } : {};
    const result = evaluate({ owner, required: obligation, observation });
    const { facts: established = empty } = result;
    const facts = freezeItems(established);
    const judgment = Object.freeze(Object.create(judgmentPrototype));

    put(judgments, judgment, Object.freeze({ ...result, facts, consumer, required }));
    work(observation, 'judgment');

    const { events = empty } = observation;

    events.forEach(event => deliver(onWork, event));

    if (!isCurrent(judgment)) throw new Error('Source changed during request');

    return judgment;
};
