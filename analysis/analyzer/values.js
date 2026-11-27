import { createOwner, producer, readFamily, reference } from 'eslint-plugin-resilient/agreement';

import { put, retain } from '../collections.js';
import { traverse } from '../traversal.js';

const ownerOf = ({ owner = false } = {}) => owner;
const primitiveTags = new Map([['string', 'String'], ['number', 'Number'], ['boolean', 'Boolean']]);
const absenceTags = new Map([['null', 'Null'], ['undefined', 'Undefined']]);
export const typeofNames = new Set(['undefined', 'object', 'boolean', 'number', 'bigint', 'string', 'symbol', 'function']);
export const valueInputs = ({ input = false, inputs = [] } = {}) => input ? [input] : inputs;
const sharedIdentity = (values, name = 'identity') => {
    const [first = {}] = values;
    const identity = Reflect.get(first, name) || false;

    return values.every(value => Reflect.get(value, name) === identity) ? identity : false;
};
export const normalValue = ({ owner = false, memberOwner = owner, identity = false, identityContext = false, callable = false, constant = false,
    typeOf = false, objectTagOf = false, nativeTag = '', unowned = false, promise = 'unknown', promiseIdentity = '', promiseOrigin = false,
    settlement = false, protocolUnknown = false, suspensionSafe = false, standardPrototype = false, slots = false, plain = false,
    emptyDefault = false, emptyRecord = false, written = false, producer = false, borrowed = false,
    truth = -1, absence = 'unknown', inputs = [], reach = 1, literal = Boolean(constant),
    input = false, guard = 1, truthGate = truth === 1 ? reach : 0, nullishGate = ['null', 'undefined'].includes(absence) ? reach : 0,
    undefinedGate = absence === 'undefined' ? reach : 0, nullGate = absence === 'null' ? reach : 0 } = {}) => Object.freeze({
    owner, memberOwner, identity, identityContext, callable, constant, typeOf, objectTagOf, nativeTag, unowned, promise, promiseIdentity, promiseOrigin, settlement, protocolUnknown, suspensionSafe,
    standardPrototype, slots, plain, emptyDefault, emptyRecord, written, producer, borrowed,
    truth, absence, inputs: Object.freeze(inputs), input, guard, reach, truthGate, nullishGate, undefinedGate, nullGate, literal
});

// Values retain guarded contribution links. Empty selection is no value, not an
// unresolved value. Projection memoizes each contribution/mode/condition relation.
export const createValues = ({ unknown = {}, decisions = {}, limit = Infinity } = {}, valueGate, ownerGate) => {
    // Required decision functions are checked below before closure capture; no fallback can supply them.
    const { and, or, not } = decisions;

    if (typeof and !== 'function' || typeof or !== 'function' || typeof not !== 'function') throw new TypeError('Expected Boolean decision operations');

    const unknownValue = normalValue(unknown);
    const { owner: unresolvedOwner = false } = unknownValue;
    const unresolved = Object.freeze({ owner: unresolvedOwner, memberOwner: unresolvedOwner, identity: false, promises: Object.freeze(['unknown']),
        contributions: Object.freeze({ callable: false, gate: 1 }) });
    const projections = new WeakMap();
    const conditionProjections = new WeakMap();
    const replacements = new WeakMap();
    const guards = new WeakMap();
    const ownership = new WeakMap();
    const retired = new WeakMap();
    const protocols = new WeakMap();
    const loans = new WeakMap();
    const familyOwners = new WeakMap();
    const typeSelections = new WeakMap();
    const refinements = new WeakMap();
    const shapeDefaults = new WeakMap();
    const emptyRecords = new WeakMap();
    const openedShapes = new WeakMap();
    const transfers = new WeakMap();
    const familyOwner = source => familyOwners.get(source) || put(familyOwners, source,
        createOwner({ evidence: reference({ owner: source, projection: 'family' }) }));
    const retire = (value, { protocol = false } = {}) => {
        if (!value) return value;

        const { unowned = false, constant = false, protocolUnknown = false } = value;

        // Primitive literal payloads have no mutable member snapshot. An
        // already retired value must not gain a new identity on every transfer.
        if ((unowned && (!protocol || protocolUnknown)) || constant) return value;

        const cache = protocol ? protocols : retired;

        return cache.get(value) || put(cache, value, normalValue({ ...value, owner: false, input: value, inputs: [], unowned: true,
            protocolUnknown: protocol || protocolUnknown }));
    };
    const borrow = (value) => {
        const { borrowed = false } = value ? value : {};

        return !value || borrowed ? value : loans.get(value) || put(loans, value, normalValue({ ...value, owner: false, input: value, inputs: [], borrowed: true }));
    };
    const transfer = (value, mode, { module = '', location: { range: [start = -1, end = -1] = [] } = {} } = {}, onVisit) => {
        if (!value) return value;

        const key = `${mode}:${module}:${start}:${end}`;
        const cacheFor = entry => transfers.get(entry) || put(transfers, entry, new Map());
        const read = entry => cacheFor(entry).get(key);
        const select = (entry) => {
            const { borrowed = false, producer: { module: origin = '', location: { range: [from = -1, to = -1] = [] } = {} } = {} } = entry;

            if (['escape', 'protocol-escape'].includes(mode)) return borrowed ? retire(entry, { protocol: mode === 'protocol-escape' }) : false;

            if (borrowed) return entry;

            if (start >= 0 && from >= start && to >= from && to <= end && module === origin) return entry;

            return valueInputs(entry).length ? false : borrow(entry);
        };

        traverse(value, { enter: (entry) => {
            const cached = cacheFor(entry);

            if (cached.has(key)) return [];

            if (typeof onVisit === 'function') onVisit();

            const selected = select(entry);

            if (selected) {
                put(cached, key, selected);

                return [];
            }

            return valueInputs(entry);
        }, leave: (entry) => {
            const cached = cacheFor(entry);

            if (cached.has(key)) return;

            const children = valueInputs(entry);
            const { input = false } = entry;
            const changed = children.some(child => read(child) !== child);

            put(cached, key, changed ? normalValue({ ...entry, owner: false, memberOwner: false,
                input: input && read(input), inputs: input ? [] : children.map(read) }) : entry);
        } });

        return read(value);
    };
    const snapshot = ({ unowned = false, protocolUnknown = false } = {}, evidence, onVisit) => {
        if (!unowned || !evidence) return evidence;

        const { owner: source = false, protocolUnknown: exposed = false } = evidence;
        const { owner: unknownSource = false } = unknownValue;
        const owner = familyOwner(source);

        const { families = [] } = readFamily({ owner, onWork: onVisit });
        const immutable = families.length && families.every(name => ['string', 'number', 'boolean', 'nullish'].includes(name));

        return Object.freeze({ ...evidence, owner, memberOwner: immutable ? owner : unknownSource, protocolUnknown: protocolUnknown || exposed,
            standardPrototype: immutable, nativeTag: '', slots: false, plain: false, emptyDefault: false });
    };
    const union = (items, name) => items.reduce((gate, item) => or(gate, Reflect.get(item, name)), 0);
    const joined = (values) => {
        const items = [...new Set(values.filter(Boolean))];

        if (!items.length) return false;

        if (items.length === 1) return items.at(0);

        const sources = [...new Set(items.map(ownerOf))];
        const truths = new Set(items.map(({ truth = -1 } = {}) => truth));
        const absences = new Set(items.map(({ absence = 'unknown' } = {}) => absence));
        const [truth = -1] = truths;
        const [absence = 'unknown'] = absences;

        const identityContext = sharedIdentity(items, 'identityContext');

        return normalValue({ identity: identityContext && sharedIdentity(items), identityContext, owner: sources.length === 1 ? sources.at(0) : false,
            typeOf: sharedIdentity(items, 'typeOf'), objectTagOf: sharedIdentity(items, 'objectTagOf'),
            literal: items.some(({ literal = false } = {}) => literal), suspensionSafe: items.every(({ suspensionSafe = false } = {}) => suspensionSafe),
            truth: truths.size === 1 ? truth : -1, absence: absences.size === 1 ? absence : 'unknown', inputs: items,
            reach: union(items, 'reach'), truthGate: union(items, 'truthGate'), nullishGate: union(items, 'nullishGate'),
            undefinedGate: union(items, 'undefinedGate'), nullGate: union(items, 'nullGate') });
    };
    const selectedGate = ({ reach = 0, truthGate = 0, nullishGate = 0, undefinedGate = 0 } = {}, mode) => {
        if (mode === 'truthy') return truthGate;

        if (mode === 'falsey') return and(reach, not(truthGate));

        if (mode === 'present') return and(reach, not(nullishGate));

        return mode === 'defined' ? and(reach, not(undefinedGate)) : reach;
    };
    const narrowed = (value, reach, mode) => {
        const { truthGate = 0, nullishGate = 0, undefinedGate = 0, nullGate = 0 } = value;

        return normalValue({ ...value, inputs: [], reach, truthGate: and(truthGate, reach), nullishGate: and(nullishGate, reach),
            undefinedGate: and(undefinedGate, reach), nullGate: and(nullGate, reach),
            ...(['truthy', 'falsey'].includes(mode) ? { truth: Number(mode === 'truthy') } : {}), ...(mode === 'present' ? { absence: 'present' } : {}) });
    };
    const restrict = (value, condition, onVisit) => {
        if (!value) return false;

        const gate = valueGate(condition);
        const { reach: reached = 0, truthGate = 0, nullishGate = 0, undefinedGate = 0, nullGate = 0 } = value;
        const reach = and(reached, gate);

        if (!reach) return false;

        if (reach === reached) return value;

        const cached = guards.get(value) || put(guards, value, new Map());

        if (cached.has(gate)) return cached.get(gate);

        if (typeof onVisit === 'function') onVisit();

        return put(cached, gate, normalValue({ ...value, owner: false, input: value, inputs: [], guard: gate, reach,
            truthGate: and(truthGate, gate), nullishGate: and(nullishGate, gate), undefinedGate: and(undefinedGate, gate), nullGate: and(nullGate, gate) }));
    };
    const projectConditions = (value, projectGate, key, onVisit) => {
        if (!value) return value;

        if (typeof projectGate !== 'function') throw new TypeError('Expected a condition projection');

        const conditions = ['guard', 'reach', 'truthGate', 'nullishGate', 'undefinedGate', 'nullGate'];
        const structural = Object.keys(value).filter(name => !conditions.includes(name) && !['owner', 'input', 'inputs'].includes(name));
        const cacheFor = entry => conditionProjections.get(entry) || put(conditionProjections, entry, new Map());
        const read = entry => cacheFor(entry).get(key);

        traverse(value, { enter: entry => cacheFor(entry).has(key) ? [] : valueInputs(entry), leave: (entry) => {
            if (cacheFor(entry).has(key)) return;

            if (typeof onVisit === 'function') onVisit();

            const gates = Object.fromEntries(conditions.map(name => [name, projectGate(Reflect.get(entry, name))]));
            const { input = false, inputs = [] } = entry;
            const { reach = 0, guard = 1 } = gates;
            const child = input && read(input);
            const children = inputs.map(read).filter(Boolean);
            const original = conditions.every(name => Reflect.get(entry, name) === Reflect.get(gates, name)) &&
                (!input || child === input) && inputs.length === children.length && inputs.every((value, index) => value === children.at(index));
            const restricted = child && structural.every(name => Reflect.get(entry, name) === Reflect.get(input, name)) && restrict(child, guard, onVisit);
            // A guard-only wrapper whose private choices were projected away
            // must not become another retained layer at every async return.
            const unchanged = restricted && conditions.filter(name => name !== 'guard')
                .every(name => Reflect.get(restricted, name) === Reflect.get(gates, name));
            const projected = unchanged ? restricted : normalValue({ ...entry, ...gates, input: child, inputs: children });
            const selected = reach && (original ? entry : projected);

            put(cacheFor(entry), key, selected || false);
        } });

        return read(value);
    };
    const project = (value, mode, onVisit, gate = 1) => {
        const root = restrict(value, gate, onVisit);

        if (!root) return Object.freeze({ value: false, matched: false, omitted: false, omittedGate: 0 });

        const cacheFor = entry => projections.get(entry) || put(projections, entry, new Map());
        const read = entry => cacheFor(entry).get(mode);
        const visits = new Set();

        traverse(root, { enter: (entry) => {
            if (read(entry)) return [];

            retain(visits, entry);

            if (visits.size > limit) throw new RangeError('Analysis value selection limit exceeded');

            if (typeof onVisit === 'function') onVisit();

            const { reach = 0, inputs = [], input = false } = entry;
            const selected = selectedGate(entry, mode);

            if (!selected || selected === reach) return [];

            return input ? [input] : inputs;
        }, leave: (entry) => {
            if (read(entry)) return;

            const { reach = 0, inputs = [], input = false, guard = 1 } = entry;
            const selected = selectedGate(entry, mode);
            const omittedGate = and(reach, not(selected));
            const valueOf = ({ value = false } = {}) => value;
            const children = () => input ? restrict(valueOf(read(input)), guard, onVisit) : joined(inputs.map(child => valueOf(read(child))));
            const resultFor = () => {
                if (selected === reach) return entry;

                return input || inputs.length ? children() : narrowed(entry, selected, mode);
            };
            const result = selected && resultFor();

            put(cacheFor(entry), mode, Object.freeze({ value: result || false, matched: Boolean(result), omitted: Boolean(omittedGate), omittedGate }));
        } });

        return read(root);
    };
    const evidenceFor = (value, onVisit) => {
        if (!value) return unresolved;

        const pair = (entry, gate) => ({ entry, gate: ownerGate(entry, gate) });
        const root = pair(value, 1);
        const cacheFor = entry => ownership.get(entry) || put(ownership, entry, new Map());
        const read = ({ entry = {}, gate = 1 } = {}) => cacheFor(entry).get(gate);
        const children = ({ entry: { input = false, inputs = [], guard = 1 } = {}, gate = 1 } = {}) => (
            input ? [pair(input, and(gate, guard))] : inputs.map(child => pair(child, gate))
        );
        const visits = new Set();

        traverse(root, { enter: (selected) => {
            const { entry = {}, gate = 1 } = selected;
            const cached = cacheFor(entry);

            if (cached.has(gate)) return [];

            retain(visits, selected);

            if (visits.size > limit) throw new RangeError('Analysis value ownership limit exceeded');

            if (typeof onVisit === 'function') onVisit();

            const { reach = 0, owner = false, memberOwner = owner, identity = false, identityContext = false, input = false, inputs = [], promise = 'unknown',
                callable = false, standardPrototype = false, nativeTag = '', slots = false, plain = false, emptyDefault = false, producer = false, borrowed = false,
                protocolUnknown = false, promiseIdentity = '', constant = false, absence = 'unknown' } = entry;

            if (!and(reach, gate)) {
                put(cached, gate, false);

                return [];
            }

            if (owner && !input && !inputs.length) {
                const { capability: { absenceQuestion = false } = {} } = identity ? identity : {};

                put(cached, gate, snapshot(entry, Object.freeze({ owner, memberOwner, identity, identityContext, origin: entry,
                    standardPrototype, nativeTag, slots, plain, emptyDefault, borrowed, protocolUnknown, promiseIdentity,
                    producers: producer && Object.freeze({ source: producer, owner }),
                    contributions: Object.freeze({ origin: absenceQuestion && entry, callable, constant, absence, gate: and(reach, gate) }),
                    promises: Object.freeze([promise]) }), onVisit));

                return [];
            }

            return children(selected);
        }, leave: (selected) => {
            const { entry = {}, gate = 1 } = selected;
            const cached = cacheFor(entry);

            if (cached.has(gate)) return;

            const evidence = children(selected).map(read).filter(Boolean);
            const sources = [...new Set(evidence.map(ownerOf))];
            const owner = sources.length > 1 ? createOwner({ evidence: producer({ owners: sources }) }) : sources.at(0) || false;
            const members = [...new Set(evidence.map(({ memberOwner = false } = {}) => memberOwner))];
            const combined = members.length > 1 ? createOwner({ evidence: producer({ owners: members }) }) : members.at(0) || false;
            const memberOwner = members.length === sources.length && members.every((member, index) => member === sources.at(index)) ? owner : combined;

            const promises = Object.freeze([...new Set(evidence.flatMap(({ promises = [] } = {}) => promises))]);
            // These caller-owned links retain immediate guarded contributions,
            // never a copied list of all origins/callees below every prefix.
            const inputs = [...new Set(evidence.map(({ contributions = false } = {}) => contributions).filter(Boolean))];
            const contributions = inputs.length === 1 ? inputs.at(0) : Object.freeze({ inputs: Object.freeze(inputs) });
            const standardPrototype = Boolean(evidence.length) && evidence.every(({ standardPrototype = false } = {}) => standardPrototype);

            const producers = [...new Set(evidence.map(({ producers = false } = {}) => producers).filter(Boolean))];
            const { borrowed = false, protocolUnknown = false } = entry;

            const identityContext = sharedIdentity(evidence, 'identityContext');

            put(cached, gate, snapshot(entry, evidence.length ? Object.freeze({ owner, memberOwner, identity: identityContext && sharedIdentity(evidence), identityContext, contributions,
                nativeTag: sharedIdentity(evidence, 'nativeTag'), origin: sharedIdentity(evidence, 'origin') || entry, promiseIdentity: sharedIdentity(evidence, 'promiseIdentity'),
                borrowed: borrowed || evidence.some(({ borrowed = false } = {}) => borrowed),
                protocolUnknown: protocolUnknown || evidence.some(({ protocolUnknown = false } = {}) => protocolUnknown),
                producers: producers.length === 1 ? producers.at(0) : producers.length && Object.freeze({ inputs: Object.freeze(producers) }),
                emptyDefault: evidence.some(({ emptyDefault = false } = {}) => emptyDefault),
                standardPrototype, slots: sharedIdentity(evidence, 'slots'), plain: evidence.every(({ plain = false } = {}) => plain), promises }) : false, onVisit));
        } });

        return read(root) || unresolved;
    };
    // A consuming query owns this transient result and traversal scratch.
    // Gates are already selected at each leaf by evidenceFor. Shared nodes can
    // therefore be visited once; distinct gated leaves still merge with OR.
    const casesFor = (value, name, onVisit) => {
        const { contributions = {} } = evidenceFor(value, onVisit);
        const visited = new Set();
        const cases = new Map();

        traverse(contributions, { enter: (entry = {}) => {
            if (visited.has(entry)) return [];

            retain(visited, entry);

            if (visited.size > limit) throw new RangeError('Analysis value case limit exceeded');

            if (typeof onVisit === 'function') onVisit();

            const { inputs = [], gate = 0 } = entry;

            if (inputs.length) return inputs;

            const target = Reflect.get(entry, name) || false;

            if (gate && (name === 'callable' || target)) put(cases, target, or(cases.get(target) || 0, gate));

            return [];
        } });

        return Object.freeze([...cases].map(([target = false, gate = 0] = []) => Object.freeze({ [name]: target, gate })));
    };
    // Type guards select existing guarded contributions at the use. They do
    // not replace producer families or add caller facts to a generic formal.
    const typeGate = (value, name, unknownGate, onVisit, mode = 'typeof', { key = '', accepts = false } = {}) => {
        if (!value) return 0;

        if (mode === 'typeof' && !typeofNames.has(name)) return 0;

        const pair = (entry, retired = false) => {
            const { unowned = false, protocolUnknown = false } = entry;
            const exposed = mode === 'protocol' && (retired || protocolUnknown);

            return { entry, retired: exposed || (['tag', 'tag-inert', 'copy-inert', 'shape', 'contents'].includes(mode) && (retired || unowned)) };
        };
        const root = pair(value);
        // Ownership is relative to this discarded use, not a global promise bit.
        const keyFor = ({ retired = false } = {}) => `${mode}:${name}:${unknownGate}:${retired}${key ? ':' + key : ''}`;
        const cacheFor = entry => typeSelections.get(entry) || put(typeSelections, entry, new Map());
        const read = ({ entry = {}, ...selection } = {}) => cacheFor(entry).get(keyFor(selection));
        const children = mode === 'contents' ? ({ entry = {}, retired = false } = {}) => {
            const inputs = valueInputs(entry);
            const { slots = false, standardPrototype = false } = entry;
            const contents = !retired && standardPrototype && slots && (!accepts || accepts(false, entry)) && slots;

            return (inputs.length ? inputs : contents || []).filter(Boolean).map(child => pair(child, retired));
        } : ({ entry = {}, retired = false } = {}) => valueInputs(entry).map(child => pair(child, retired));
        const contentsGate = ({ entry = {}, retired = false } = {}, selectedChildren = []) => {
            const { promise = 'unknown', promiseOrigin = false, reach = 1, slots = false, standardPrototype = false, owner = false } = entry;

            if (promise === name) return accepts && !accepts(promiseOrigin, entry) ? 0 : reach;

            const nested = selectedChildren.reduce((gate, child) => or(gate, read(child)), 0);

            if (name !== 'unknown' || (!retired && standardPrototype && slots)) return and(reach, nested);

            const { families = [] } = readFamily({ owner, onWork: onVisit });

            return or(and(reach, nested), families.includes('array') ? reach : 0);
        };

        const select = (selection) => {
            const { entry = {}, retired = false } = selection;
            const { input = false, inputs = [], guard = 1, reach = 1, owner = false, absence = 'unknown', constant = false,
                nativeTag = '', standardPrototype = false, plain = false, promise = 'unknown' } = entry;
            const selectedChildren = children(selection);

            if (input || inputs.length) return and(reach, input ? and(read(selectedChildren.at(0)), guard)
                : selectedChildren.reduce((gate, child) => or(gate, read(child)), 0));

            if (mode === 'protocol') return (name === 'unsafe' ? retired || promise !== 'known' : !retired && promise === 'known') ? reach : 0;

            if (mode === 'promise') return promise === name ? reach : 0;

            if (mode === 'contents') return contentsGate(selection, selectedChildren);

            if (mode === 'literal' && absenceTags.has(absence)) return 0;

            if (mode === 'literal' && constant) return and(reach, Number(Reflect.get(constant, 'value') === name));

            const { families = [], incomplete = false } = readFamily({ owner, onWork: onVisit });

            if (mode === 'primitive') {
                const primitive = !incomplete && families.length && families.every(family => ['string', 'number', 'boolean', 'nullish'].includes(family));

                return (name === 'unsafe' ? !primitive : primitive) ? reach : 0;
            }

            // Missing an exact constant does not erase an established family.
            // An incomplete contribution can still contain the compared family.
            if (mode === 'literal') return and(reach,
                !incomplete && families.length && !families.includes(typeof name) ? 0 : unknownGate);

            if (mode === 'tag-inert' || mode === 'copy-inert') {
                const inert = Boolean((!retired && standardPrototype && (nativeTag || (mode === 'copy-inert' && plain))) || constant || absenceTags.has(absence) ||
                    (!incomplete && families.length && families.every(family => primitiveTags.has(family) || (mode === 'copy-inert' && family === 'nullish'))));

                return (mode === 'copy-inert' && name === 'unsafe' ? !inert : inert) ? reach : 0;
            }

            if (mode === 'shape') return (incomplete && !families.length) ||
                (!incomplete && families.length === 1 && families.at(0) === 'object' && (retired || !plain)) ? reach : 0;

            if (mode === 'tag') {
                const primitiveTag = !incomplete && families.length === 1 && primitiveTags.get(families.at(0));
                const absentTag = absenceTags.get(absence) || '';
                const tag = (!retired && nativeTag) || absentTag || primitiveTag;

                return and(reach, tag ? Number(tag === name) : unknownGate);
            }

            const types = families.map(family => ['array', 'object', 'regexp'].includes(family) || absence === 'null' ? 'object' : family);
            const typed = constant ? [typeof Reflect.get(constant, 'value')] : types;
            const known = mode === 'family' ? families : typed;
            const selected = absence === 'undefined' ? ['undefined'] : known;
            const match = selected.includes(name);
            const established = !incomplete && selected.length && !selected.includes('nullish');
            const gate = established && selected.every(type => type === name) ? 1 : unknownGate;

            return and(reach, established && !match ? 0 : gate);
        };

        traverse(root, { enter: (selection) => {
            const { entry = {} } = selection;

            if (cacheFor(entry).has(keyFor(selection))) return [];

            if (typeof onVisit === 'function') onVisit();

            return children(selection);
        }, leave: (selection) => {
            const { entry = {} } = selection;
            const cache = cacheFor(entry);
            const key = keyFor(selection);

            if (!cache.has(key)) put(cache, key, select(selection));
        } });

        return read(root);
    };
    // A canonical empty fallback declares an open shape only on unresolved
    // input paths that also return that same input under an object guard.
    // Concrete supplied alternatives retain their own closed field evidence.
    const normalizeShape = (value, testsFor, onVisit) => {
        if (!value) return value;

        if (shapeDefaults.has(value)) return shapeDefaults.get(value);

        traverse(value, { enter: (entry) => {
            if (emptyRecords.has(entry)) return [];

            if (typeof onVisit === 'function') onVisit();

            return valueInputs(entry);
        }, leave: (entry) => {
            if (emptyRecords.has(entry)) return;

            const children = valueInputs(entry);
            const { emptyRecord = false } = entry;

            put(emptyRecords, entry, children.length ? children.some(child => emptyRecords.get(child)) : emptyRecord);
        } });

        if (!emptyRecords.get(value)) return put(shapeDefaults, value, value);

        const visited = new WeakMap();
        const openings = new Set();

        traverse({ entry: value, gate: 1 }, { enter: ({ entry = {}, gate = 1 } = {}) => {
            const { reach = 1, guard = 1 } = entry;
            const selected = and(gate, reach);
            const seen = visited.get(entry) || put(visited, entry, new Set());

            if (!selected || seen.has(selected)) return [];

            retain(seen, selected);

            if (typeof onVisit === 'function') onVisit();

            testsFor(entry).forEach(({ input = false, tested = 0 } = {}) => {
                const domain = typeGate(input, 'object', 0, onVisit, 'shape');
                const passed = and(selected, domain);

                if (passed && !and(passed, not(tested))) retain(openings, and(domain, not(tested)));
            });

            return valueInputs(entry).map(child => ({ entry: child, gate: and(selected, guard) }));
        } });
        const opening = valueGate([...openings].reduce((gate, selected) => or(gate, selected), 0));

        if (!opening) return put(shapeDefaults, value, value);

        const pair = (entry, gate) => {
            const { reach = 1 } = entry;

            return { entry, gate: valueGate(and(reach, gate)) };
        };
        const root = pair(value, 1);
        const cacheFor = entry => openedShapes.get(entry) || put(openedShapes, entry, new Map());
        const keyFor = ({ gate = 1 } = {}) => `${opening}:${gate}`;
        const read = ({ entry = {}, ...selection } = {}) => cacheFor(entry).get(keyFor(selection));
        const childrenFor = ({ entry = {}, gate = 1 } = {}) => {
            const { guard = 1 } = entry;

            return valueInputs(entry).map(child => pair(child, and(gate, guard)));
        };

        traverse(root, { enter: (selection) => {
            const { entry = {}, gate = 1 } = selection;
            const cached = cacheFor(entry);
            const key = keyFor(selection);

            if (cached.has(key)) return [];

            if (typeof onVisit === 'function') onVisit();

            if (!gate || !emptyRecords.get(entry)) {
                put(cached, key, gate && entry);

                return [];
            }

            return childrenFor(selection);
        }, leave: (selection) => {
            const { entry = {}, gate = 1 } = selection;
            const cached = cacheFor(entry);
            const key = keyFor(selection);

            if (cached.has(key)) return;

            const { input = false, emptyRecord = false, owner: source = false } = entry;
            const children = childrenFor(selection);
            const changed = children.some(({ entry = {}, ...selection } = {}) => read({ entry, ...selection }) !== entry);
            const replacement = () => {
                if (!and(gate, opening)) return entry;

                const owner = familyOwner(source);
                const open = normalValue({ ...entry, owner, memberOwner: owner, plain: false, emptyRecord: false });

                if (!and(gate, not(opening))) return open;

                return joined([restrict(open, opening, onVisit), restrict(entry, not(opening), onVisit)]);
            };

            if (!children.length) {
                put(cached, key, emptyRecord ? replacement() : entry);

                return;
            }

            const mapped = children.map(read).filter(Boolean);
            const selected = () => mapped.length && normalValue({ ...entry, owner: false, memberOwner: false,
                input: input && mapped.at(0), inputs: input ? [] : mapped });

            put(cached, key, changed ? selected() : entry);
        } });

        return put(shapeDefaults, value, read(root));
    };
    // A guard fills unresolved leaves only. Known shapes and guarded branches
    // remain source-owned, including known contradictions beside uncertainty.
    const refine = (value, family, owner, gate, tested, tag, onVisit) => {
        const pair = (entry, selected) => {
            const { reach = 1 } = entry;

            return { entry, selected: and(selected, reach) };
        };
        const root = pair(value, gate);
        const cacheFor = entry => refinements.get(entry) || put(refinements, entry, new Map());
        const keyFor = ({ selected = 1 } = {}) => `${family}:${tag}:${tested}:${selected}`;
        const read = ({ entry = {}, ...selection } = {}) => cacheFor(entry).get(keyFor(selection));
        const childrenFor = ({ entry = {}, selected = 1 } = {}) => {
            const { guard = 1 } = entry;

            return valueInputs(entry).map(child => pair(child, and(selected, guard)));
        };
        const visits = new Set();

        traverse(root, { enter: (selection) => {
            const { entry = {} } = selection;
            const cached = cacheFor(entry);
            const key = keyFor(selection);

            if (cached.has(key)) return [];

            retain(visits, selection);

            if (visits.size > limit) throw new RangeError('Analysis value refinement limit exceeded');

            if (typeof onVisit === 'function') onVisit();

            const { owner: source = false } = evidenceFor(entry, onVisit);
            const { incomplete = false } = readFamily({ owner: source, onWork: onVisit });

            if (!incomplete) {
                put(cached, key, entry);

                return [];
            }

            return childrenFor(selection);
        }, leave: (selection) => {
            const { entry = {}, selected: reached = 1 } = selection;
            const cached = cacheFor(entry);
            const key = keyFor(selection);

            if (cached.has(key)) return;

            const { input = false, guard = 1, truthGate = 0, reach = 1 } = entry;
            const children = childrenFor(selection);

            if (children.length && children.every((child) => {
                const { entry = {} } = child;

                return read(child) === entry;
            })) {
                put(cached, key, entry);

                return;
            }

            const replacement = () => {
                const { owner: source = false } = evidenceFor(entry, onVisit);
                const { families = [], incomplete = false } = readFamily({ owner: source, onWork: onVisit });

                if (!reached || and(reached, not(tested)) || !incomplete || families.length) return entry;

                return normalValue({ ...entry, owner, memberOwner: owner, nativeTag: tag, absence: 'present', nullishGate: 0, nullGate: 0, undefinedGate: 0,
                    truthGate: ['array', 'function', 'object', 'regexp'].includes(family) ? reach : truthGate });
            };
            const mapped = children.map(read);
            const selected = () => normalValue({ ...entry, owner: false, memberOwner: false,
                input: input && mapped.at(0), inputs: input ? [] : mapped,
                truthGate: and(guard, union(mapped, 'truthGate')), nullishGate: and(guard, union(mapped, 'nullishGate')),
                nullGate: and(guard, union(mapped, 'nullGate')), undefinedGate: and(guard, union(mapped, 'undefinedGate')) });
            const result = children.length ? selected() : replacement();

            put(cached, key, result);
        } });

        return read(root);
    };
    const replace = (value, mode, fallback, onVisit) => {
        const selection = project(value, mode, onVisit);
        const { value: selected = false, matched = false, omitted = false, omittedGate = 0 } = selection;

        if (!omitted) return selected;

        const replacement = restrict(fallback, omittedGate, onVisit);

        if (!matched) return replacement;

        const cached = replacements.get(selection) || put(replacements, selection, new WeakMap());

        return cached.get(fallback) || put(cached, fallback, joined([selected, replacement]));
    };

    // Select before combining evidence: distinct arrays can disagree at one
    // position, and an unknown alternative must not erase a known contribution.
    const selectSource = (value, select, unresolved, onVisit, { fresh = false } = {}) => {
        if (typeof select !== 'function' || typeof unresolved !== 'function') throw new TypeError('Expected value selection and source-owned uncertainty');

        if (!value) return unresolved();

        const selected = new Map();
        const visits = new Set();

        traverse(value, { enter: (entry) => {
            if (selected.has(entry)) return [];

            retain(visits, entry);

            if (visits.size > limit) throw new RangeError('Analysis slot selection limit exceeded');

            if (typeof onVisit === 'function') onVisit();

            const { unowned = false } = entry;

            return unowned ? [] : valueInputs(entry);
        }, leave: (entry) => {
            if (selected.has(entry)) return;

            const { unowned = false, borrowed = false, input = false, inputs = [], guard = 1, reach = 1 } = entry;
            const fromSource = () => {
                if (unowned) return unresolved();

                if (input) return restrict(selected.get(input), guard, onVisit);

                if (inputs.length) return joined(inputs.map(child => selected.get(child)));

                return select(entry);
            };
            const result = restrict(fromSource(), reach, onVisit);

            put(selected, entry, borrowed && !fresh ? borrow(result) : result);
        } });

        return selected.get(value);
    };
    const selectSlots = (value, select, unresolved, onVisit) => selectSource(value, ({ slots = false, standardPrototype = false } = {}) => (
        slots && standardPrototype ? select(slots) : unresolved()
    ), unresolved, onVisit);
    const selectSlot = (value, position, absent, unresolved, onVisit) => selectSlots(value, slots => slots.at(position) || absent, unresolved, onVisit);
    const escape = (value, onVisit, { protocol = false } = {}) => {
        const { borrowed = false } = evidenceFor(value, onVisit);

        return borrowed ? transfer(value, protocol ? 'protocol-escape' : 'escape', {}, onVisit) : value;
    };
    const borrowWithin = (value, scope, onVisit, observation = {}) => {
        const { owner = false } = evidenceFor(value, onVisit);
        const { families = [], incomplete = false } = readFamily({ owner, ...observation });
        const immutable = !incomplete && families.length && families.every(family => ['string', 'number', 'boolean', 'nullish'].includes(family));

        return immutable ? borrow(value) : transfer(value, 'borrow', scope, onVisit);
    };

    return { unknownValue, joined, project, projectConditions, restrict, replace, evidenceFor, casesFor, typeGate, normalizeShape, refine, retire, borrow, borrowWithin, escape,
        selectSource, selectSlot, selectSlots };
};
