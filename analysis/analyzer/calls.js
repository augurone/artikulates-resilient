import { absent, all, createOwner, readField, request } from 'eslint-plugin-resilient/agreement';

import { append, put } from '../collections.js';
import { sourcePropertyName as propertyName } from '../estree-properties.js';
import { traverse } from '../traversal.js';
import { acquireArgumentLists } from './argument-positions.js';
import { locationOf } from './locations.js';
import { ownsRecordFields } from './records.js';
import { uncertainty, unknownOwner } from './uncertainty.js';

const unrestricted = all();
const missingOwner = createOwner({ evidence: absent() });
const unresolvedOwner = unknownOwner();
const unknownDefaultOwner = unknownOwner({ code: 'unsupported-signature' });

export const argumentMetadata = (node = {}) => {
    const acquired = new WeakMap();
    const layouts = acquireArgumentLists();
    const arrays = new WeakMap();
    const propertiesOf = (node = {}) => {
        const { type = '', properties = [], elements = [] } = node;

        if (arrays.has(node)) return arrays.get(node);

        if (type === 'ArrayExpression') {
            const values = layouts({ arguments: elements });
            const unknown = values.findIndex(({ type = '' } = {}) => type === 'SpreadElement');
            const selected = unknown < 0 ? values : values.slice(0, unknown);

            return put(arrays, node, selected.map((value, slot) => ({ type: 'Property', key: { type: 'Literal', value: slot }, value })));
        }

        return ownsRecordFields({ type, properties }) ? properties : [];
    };

    traverse(node, { enter: current => propertiesOf(current).filter(({ type = '' } = {}) => type === 'Property').map(({ value = {} } = {}) => value),
        leave: (current) => {
            const properties = propertiesOf(current);
            // This index owns only source locations and explicit literal keys.
            // Agreement owns writer selection, presence and value evidence.
            const fields = new Map(properties.flatMap(({ type = '', value = {}, ...property } = {}) => {
                const { known = false, name = '' } = propertyName(property);

                return type === 'Property' && known ? [[name, acquired.get(value)]] : [];
            }));

            put(acquired, current, Object.freeze({ location: locationOf(current), fields,
                closed: ownsRecordFields(current) && properties.every(({ type = '', computed = false } = {}) => type === 'Property' && !computed) }));
        } });

    return acquired.get(node);
};

// Required expression acquisition is checked before use; no substitute can manufacture source evidence.
export const prepareCalls = ({ calls = [], functions = [], expressionFor } = {}) => {
    if (typeof expressionFor !== 'function') throw new TypeError('Expected shared expression acquisition');

    const signatures = functions.map(({ signature = {} } = {}) => signature);
    const prepared = calls.map(({ node = {}, callee = {}, argumentsList = [], conditional = false } = {}, index) => {
        const { name = '', property: { name: member = '' } = {} } = callee;
        const expression = expressionFor(node);
        const { function: { signature = {} } = {} } = expression;
        const { kind = '' } = expression;
        const spread = kind === 'opaque' && argumentsList.some(({ type = '' } = {}) => type === 'SpreadElement');
        const { descriptor: { index: signatureIndex = false } = {} } = signature;
        const eligible = signatureIndex !== false && !conditional && !spread;
        const code = [conditional && 'optional-call', spread && 'spread-call', signatureIndex === false && 'unresolved-call', 'unsupported-signature'].find(Boolean);

        return {
            expression, signature, eligible, cause: uncertainty({ code, location: locationOf(node) }),
            argumentsList: [],
            descriptor: Object.freeze({ index, callee: name || member, location: locationOf(node), signature: signatureIndex })
        };
    });

    return {
        prepared, signatures: Object.freeze(signatures.map(({ descriptor = {} } = {}) => descriptor)),
        counts: { signatures: signatures.length, signatureParameters: signatures.reduce((total, { parameters = [] } = {}) => total + parameters.length, 0) }
    };
};

export const callOutcome = (statuses) => {
    if (statuses.includes('contradiction')) return 'contradiction';

    return statuses.includes('unknown') ? 'unknown' : 'agreement';
};

const evaluateParameter = ({ parameter = {}, argument = {}, callLocation = {}, observation = {}, protocol = '' } = {}, summarize, readValue, defaultOwner, readSlot) => {
    if (typeof summarize !== 'function' || typeof readValue !== 'function' || typeof defaultOwner !== 'function' || typeof readSlot !== 'function') {
        throw new TypeError('Expected call evidence reading, default selection and summarization');
    }

    const { index = -1, expected = '', required = false, fallback = false, defaulted = false, supported = false } = parameter;
    const { owner: supplied = false } = argument;
    const actual = supplied ? readValue(supplied) : {};
    const { absence = '' } = actual;
    const argumentPath = index ? `argument[${index}]` : 'argument';
    const path = protocol ? `${protocol}.callback${index ? `.${argumentPath}` : ''}` : argumentPath;

    if (!supplied && !defaulted) return [Object.freeze({ path, expected, status: 'unknown', ...uncertainty({ code: 'omitted-argument', location: callLocation }), facts: Object.freeze([]) })];

    if ((!supplied || absence === 'undefined') && defaulted && !fallback) return [Object.freeze({ path, expected, status: 'unknown',
        ...uncertainty({ code: 'unsupported-signature', location: callLocation }), facts: Object.freeze([]) })];

    if (!supported && !expected) return [Object.freeze({ path, expected, status: 'unknown', ...uncertainty({ code: 'unsupported-signature', location: callLocation }), facts: Object.freeze([]) })];

    const source = (!supplied || absence === 'undefined') && defaulted ? { owner: fallback, location: callLocation, fields: new Map() } : argument;
    const { owner = false, location = {} } = source;
    // Default syntax selects undefined even when the authored replacement is
    // unknown. Flow values and registered agreement owners have separate roles.
    const selectedOwner = defaulted && supplied ? defaultOwner(supplied, fallback || unknownDefaultOwner) : owner;
    const query = ({ required: obligation = false, path: selected = '', expected: family = '', location: span = location } = {}) => {
        const { status = '', facts = [] } = request({ ...observation, owner: selectedOwner, required: obligation, consumer: `Call ${selected}` });

        return Object.freeze({ path: selected, expected: family, status, location: span, absence: selected === path ? absence : '', facts: Object.freeze(facts.map(fact => summarize(fact))) });
    };
    const root = query({ required, path, expected });
    const { status = '' } = root;

    // A wrong outer family is the root contradiction, not one per child field.
    if (status === 'contradiction') return [root];

    const obligations = [root];
    const pending = { owner: selectedOwner, parameter, path: index || protocol ? path : '', metadata: source };

    traverse(pending, { enter: ({ owner = false, parameter: { fields = [], complete = false, closed = false, emptyArrayDefault = false, fallback: arrayFallback = false } = {},
        path = '', metadata = {} } = {}) => {
        const { location = {}, fields: locations = new Map(), closed: literal = false } = metadata;
        const declared = new Set(fields.map(({ name = '' } = {}) => name));

        if (!complete) append(obligations, Object.freeze({ path, status: 'unknown', location, facts: Object.freeze([]) }));

        if (closed && literal) [...locations].filter(([name = ''] = []) => !declared.has(name)).forEach(([name = '', { location = {} } = {}] = []) => append(obligations,
            Object.freeze({ kind: 'excessProperty', path: path ? `${path}.${name}` : name, status: 'contradiction', location, facts: Object.freeze([]) })));

        return fields.flatMap((parameter) => {
            const { name = '', slot = -1, expected = '', selectable = false, fallback = false, defaulted = false, supported = false } = parameter;
            const selectedPath = path ? `${path}.${name}` : name;
            const metadata = locations.get(name) || { location };
            const { location: span = location } = metadata;

            if (!selectable) {
                append(obligations, Object.freeze({ path: selectedPath, expected, status: 'unknown', location: span, facts: Object.freeze([]) }));

                return [];
            }

            const emptySlot = emptyArrayDefault && owner === arrayFallback;
            const selectedSlot = slot >= 0 && !emptySlot && readSlot(owner, slot);
            const { fact = false, cases = [] } = slot >= 0 ? { cases: [{ state: emptySlot ? 'absent' : 'present', owner: selectedSlot }] }
                : readField({ ...observation, owner, name });

            return cases.flatMap((entry = {}) => {
                const { state = '', owner: source = false } = entry;
                const omitted = state === 'absent';
                const selected = omitted ? fallback || missingOwner : source || unresolvedOwner;
                const actual = omitted ? {} : readValue(selected, entry);
                const { absence = '' } = actual;
                const unknownDefault = defaulted && !fallback && (omitted || absence === 'undefined');

                if ((!supported && !expected) || unknownDefault) {
                    append(obligations, Object.freeze({ path: selectedPath, expected, status: 'unknown', location: span, facts: Object.freeze(fact ? [summarize(fact)] : []) }));

                    return [];
                }

                if (omitted && !expected) return [];

                const valueOwner = !omitted && defaulted ? defaultOwner(selected, fallback || unknownDefaultOwner) : selected;
                const { status = '', facts = [] } = request({ ...observation, owner: valueOwner, required: expected || unrestricted, consumer: `Call ${selectedPath}` });

                append(obligations, Object.freeze({ path: selectedPath, expected, status, location: span, absence,
                    facts: Object.freeze([...(fact ? [fact] : []), ...facts].map(fact => summarize(fact))) }));

                return status === 'contradiction' ? [] : [{ owner: valueOwner, parameter, path: selectedPath, metadata }];
            });
        });
    } });

    return obligations;
};

export const checkCall = ({ call = {}, summarize, observation = {}, readValue, defaultOwner, readSlot } = {}) => {
    const { eligible = false, signature = {}, protocol = false, argumentsList = [], cause = {}, descriptor: { location = {}, callee = 'Function' } = {} } = call;

    if (!eligible) return Object.freeze({ status: 'unknown', ...cause, obligations: Object.freeze([]) });

    const { parameters = [], arity: counts = [] } = signature;
    const handled = counts.some(({ count = -1 } = {}) => count === argumentsList.length);
    const missing = handled ? [] : parameters.filter(({ index = -1, defaulted = false, rest = false } = {}) => !defaulted && !rest && index >= argumentsList.length);
    const rest = parameters.some(({ rest = false } = {}) => rest);
    const extra = !protocol && !rest && argumentsList.length > parameters.length;
    const requiredNames = missing.map(({ name = '', index = -1 } = {}) => name || `argument[${index}]`).join(', ');
    const arity = missing.length || extra ? [Object.freeze({ kind: 'arity', status: 'contradiction', location, facts: Object.freeze([]),
        message: missing.length ? `${callee} requires ${requiredNames}; provide the argument or add a default to the ${callee} signature.`
            : `${callee} accepts at most ${parameters.length} argument${parameters.length === 1 ? '' : 's'}, but got ${argumentsList.length}.` })] : [];
    const obligations = Object.freeze([...arity, ...parameters.filter(({ rest = false, index = -1 } = {}) => !rest && (!handled || index < argumentsList.length)).flatMap((parameter) => {
        const { index = -1 } = parameter;

        return evaluateParameter({ parameter, argument: argumentsList.at(index), callLocation: location, observation, protocol }, summarize, readValue, defaultOwner, readSlot);
    })]);
    const statuses = obligations.map(({ status = '' } = {}) => status);

    return Object.freeze({
        status: callOutcome(statuses), reason: '', obligations
    });
};
