import { createOwner, readField, record } from 'eslint-plugin-resilient/agreement';

import { put } from '../collections.js';
import { traverse } from '../traversal.js';
import { objectPrototypeMembers } from './native-members.js';
import { normalValue, valueInputs } from './values.js';
import { notify } from './work.js';

// Copying publishes immediate field/slot values while preserving the containing
// receiver. The caller owns this cache and the field layers; shared value edges
// are projected once, without flattening alternatives or retaining caller paths.
export const createCopyRetirement = ({ valueModel = {}, recordLayers = new WeakMap(), cache = new WeakMap() } = {}, onVisit) => {
    const { retire = false } = valueModel;

    if (typeof retire !== 'function') throw new TypeError('Expected copied-value retirement');

    return (value) => {
        if (!value) return value;

        traverse(value, { enter: (entry) => {
            const { unowned = false } = entry;

            return cache.has(entry) || unowned ? [] : valueInputs(entry);
        }, leave: (entry) => {
            if (cache.has(entry)) return;

            if (typeof onVisit === 'function') onVisit();

            const { unowned = false, input = false, memberOwner = false, plain = false, slots = false, standardPrototype = false } = entry;
            const children = valueInputs(entry);
            const selected = children.map(child => cache.get(child));
            const project = () => {
                if (unowned) return entry;

                if (children.length) return children.every((child, index) => child === selected.at(index)) ? entry
                    : normalValue({ ...entry, owner: false, memberOwner: false, input: input && selected.at(0), inputs: input ? [] : selected });

                if (plain) {
                    const owner = createOwner({ evidence: record({ source: memberOwner, retire: true }) });

                    put(recordLayers, owner, { source: entry, retire: true, retireProtocol: true });

                    return normalValue({ ...entry, owner, memberOwner: owner });
                }

                return slots && standardPrototype ? normalValue({ ...entry,
                    slots: Object.freeze(slots.map(value => value && valueModel.retire(value, { protocol: true }))) }) : entry;
            };
            const result = project();

            put(cache, entry, result);
            put(cache, result, result);
        } });

        return cache.get(value);
    };
};
// Agreement supplies ordered field evidence. This session-local selector keeps
// the corresponding value conditions and copy lifetimes through that evidence.
export const createRecordFields = ({ valueModel = {}, decisions = {}, recordLayers = new WeakMap(), absentValue = {}, unknown = {}, observation = {} } = {},
    sourceValue, copiedFieldValue, condition, selection) => {
    const { and, or, not } = decisions;

    if (typeof and !== 'function' || typeof or !== 'function' || typeof not !== 'function') {
        throw new TypeError('Expected Boolean decision operations');
    }

    if ([sourceValue, copiedFieldValue, condition, selection].some(value => typeof value !== 'function')) {
        throw new TypeError('Expected field value acquisition and Boolean decision operations');
    }

    const { unknownValue = {} } = valueModel;
    const literalField = (entry) => {
        const value = copiedFieldValue(entry);

        return value && Reflect.get(value, 'literal');
    };
    const fieldValue = (cases, expression, context) => {
        const { name = '', kind = '' } = expression;
        const values = [...new Set(cases.map((entry = {}) => {
            const { state = '', owner = false } = entry;

            if (state === 'present') return copiedFieldValue(entry) || sourceValue({ ...unknown, ...expression, owner }, context);

            return state === 'absent' && !objectPrototypeMembers.has(name) ? absentValue : sourceValue({ ...unknown, ...expression,
                identity: kind === 'selection' && expression, identityContext: kind === 'selection' && context }, context);
        }))];

        if (values.length < 2) return valueModel.joined(values) || unknownValue;

        const remaining = new Map([['gate', 1]]);

        return valueModel.joined(values.map((value, index) => {
            const prior = remaining.get('gate');
            const choice = index === values.length - 1 ? 1 : condition(expression, context, `field-alternative:${index}`);

            put(remaining, 'gate', and(prior, not(choice)));

            return valueModel.restrict(value, and(prior, choice), selection);
        })) || unknownValue;
    };
    const fieldSelection = (cases, expression, context) => {
        if (!cases.some(({ state = '' } = {}) => state === 'absent')) return { value: fieldValue(cases, expression, context), missing: 0 };

        if (cases.every(({ state = '' } = {}) => state === 'absent')) return { value: absentValue, missing: 1 };

        const choices = cases.length ? cases : [{ state: 'unknown' }];
        const remaining = new Map([['gate', 1], ['missing', 0]]);
        const values = choices.map((entry = {}, index) => {
            const { state = '' } = entry;
            const prior = remaining.get('gate');
            const choice = index === choices.length - 1 ? 1 : condition(expression, context, `field-alternative:${index}`);
            const gate = and(prior, choice);

            put(remaining, 'gate', and(prior, not(choice)));

            if (state === 'absent') put(remaining, 'missing', or(remaining.get('missing'), gate));

            const selected = fieldValue([entry], expression, context);

            return valueModel.restrict(selected, gate, selection);
        });

        return { value: valueModel.joined(values) || unknownValue, missing: remaining.get('missing') };
    };
    // Agreement owns ordered presence and field families. These links keep
    // the execution gates of a copied field without multiplying record
    // alternatives when two independent conditional writers meet.
    const layeredField = (value, expression, context) => {
        const { name = '' } = expression;
        const selected = new Map();
        const layerFor = ({ memberOwner = false } = {}) => recordLayers.get(memberOwner);
        const children = (entry) => {
            const { unowned = false } = entry;

            if (unowned) return [];

            const inputs = valueInputs(entry);

            if (inputs.length) return inputs;

            const { base = false, source = false, fields = new Set(), excluded = [] } = layerFor(entry) ?? {};

            return fields.has(name) || excluded.includes(name) ? [] : [source, base].filter(Boolean);
        };
        traverse(value, { enter: entry => selected.has(entry) ? [] : children(entry), leave: (entry) => {
            if (selected.has(entry)) return;

            selection();
            notify(observation, 'record-field-layer');

            const { unowned = false, borrowed = false, input = false, guard = 1, reach = 1, memberOwner = false } = entry;
            const inputs = valueInputs(entry);
            const { base = false, source = false, fields = new Set(), excluded = [], retire = false, retireProtocol = false } = layerFor(entry) ?? {};
            const absent = { value: absentValue, missing: 1 };
            const result = () => {
                if (unowned) return fieldSelection([], expression, context);

                if (inputs.length) return inputs.map(child => selected.get(child)).reduce(({ value: left = false, missing: a = 0 } = {}, { value: right = false, missing: b = 0 } = {}) => ({
                    value: valueModel.joined([left, right]), missing: or(a, b)
                }), { value: false, missing: 0 });

                if (fields.has(name)) return fieldSelection(readField({ ...observation, owner: memberOwner, name }).cases, expression, context);

                if (excluded.includes(name)) return absent;

                const previous = base ? selected.get(base) : absent;
                const { value: retained = false, missing: previouslyMissing = 0 } = previous;

                if (source) {
                    const { value: copied = false, missing = 0 } = selected.get(source);
                    const supplied = retire ? valueModel.retire(copied, { protocol: retireProtocol }) : copied;

                    return { value: valueModel.joined([valueModel.restrict(supplied, not(missing), selection),
                        valueModel.restrict(retained, missing, selection)]), missing: and(missing, previouslyMissing) };
                }

                return base ? previous : fieldSelection(readField({ ...observation, owner: memberOwner, name }).cases, expression, context);
            };
            const { value: field = false, missing = 0 } = result();
            const gate = and(reach, input ? guard : 1);
            const owned = borrowed ? valueModel.borrow(field) : field;

            put(selected, entry, { value: valueModel.restrict(owned, gate, selection), missing: and(missing, gate) });
        } });

        const { value: field = false, missing = 0 } = selected.get(value);

        // A copy walks own-property absence. The eventual property read can
        // still see an inherited member, so that absence cannot select a default.
        if (!missing || !objectPrototypeMembers.has(name)) return { value: field, missing };

        const inherited = fieldValue([{ state: 'absent' }], expression, context);

        return { value: valueModel.joined([valueModel.restrict(field, not(missing), selection), valueModel.restrict(inherited, missing, selection)]), missing };
    };
    const fieldFrom = (value, expression, context) => {
        const { name = '' } = expression;
        const { memberOwner = false, plain = false, borrowed = false, origin: { inputs = [] } = {} } = valueModel.evidenceFor(value, selection);
        const { cases = [] } = readField({ ...observation, owner: memberOwner, name });

        if (recordLayers.has(memberOwner) || (inputs.length && cases.length > 1 && (plain || cases.some(literalField)))) {
            return { cases, ...layeredField(value, expression, context) };
        }

        const selected = fieldValue(cases, expression, context);

        return { cases, value: borrowed ? valueModel.borrow(selected) : selected };
    };

    return { fieldValue, fieldFrom };
};
