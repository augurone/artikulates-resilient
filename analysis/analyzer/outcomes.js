import { append, put, retain } from '../collections.js';
import { traverse } from '../traversal.js';
import { valueInputs } from './values.js';

const outcome = ({ normal = 0, thrown = 0, returned = 0, broken = 0, continued = 0, uncertain = 0, effects = 0, value = false,
    result = false, returns = false, sites = false, calls = false, unresolved = false } = {}) => (
    Object.freeze({ normal, thrown, returned, broken, continued, uncertain, effects, value, result, returns, sites, calls, unresolved })
);
const joined = (left, right) => left && right ? Object.freeze({ inputs: Object.freeze([left, right]) }) : left || right;
const restricted = (contribution, gate) => contribution && gate ? Object.freeze({ input: contribution, gate }) : false;

// One completion algebra serves expression evaluation and statement execution.
// Values and return provenance retain shared contributions rather than path lists.
// Required decision functions are checked below before closure capture; no fallback can supply them.
export const createOutcomes = ({ decisions: { and, or, not } = {}, values = {}, absent = {} } = {}) => {
    if (typeof and !== 'function' || typeof or !== 'function' || typeof not !== 'function') throw new TypeError('Expected Boolean decision operations');

    const empty = outcome();
    const continuation = outcome({ normal: 1 });
    const complete = (value) => {
        if (!value) return empty;

        const { reach = 0 } = value;

        return outcome({ value, normal: reach });
    };
    const restrict = (entry, gate, visit) => {
        if (!gate) return empty;

        if (gate === 1) return entry;

        const { normal = 0, thrown = 0, returned = 0, broken = 0, continued = 0, uncertain = 0, effects = 0, value = false, result = false,
            returns = false, sites = false, calls = false } = entry;

        return outcome({ ...entry, normal: and(normal, gate), thrown: and(thrown, gate), returned: and(returned, gate), uncertain: and(uncertain, gate), effects: and(effects, gate),
            broken: and(broken, gate), continued: and(continued, gate), value: values.restrict(value, gate, visit), result: values.restrict(result, gate, visit),
            returns: restricted(returns, gate), sites: restricted(sites, gate), calls: restricted(calls, gate) });
    };
    const join = ({ normal: a = 0, thrown: at = 0, returned: ar = 0, uncertain: au = 0, effects: ae = 0, value: av = false, result: resultA = false,
        returns: returnsA = false, sites: sitesA = false, calls: callsA = false, unresolved: ax = false, broken: ab = 0, continued: ac = 0 } = {},
    { normal: b = 0, thrown: bt = 0, returned: br = 0, uncertain: bu = 0, effects: be = 0, value: bv = false, result: resultB = false,
        returns: returnsB = false, sites: sitesB = false, calls: callsB = false, unresolved: bx = false, broken: bb = 0, continued: bc = 0 } = {}) => outcome({
        normal: or(a, b), thrown: or(at, bt), returned: or(ar, br), uncertain: or(au, bu), effects: or(ae, be), value: values.joined([av, bv]), result: values.joined([resultA, resultB]),
        broken: or(ab, bb), continued: or(ac, bc), returns: joined(returnsA, returnsB), sites: joined(sitesA, sitesB), calls: joined(callsA, callsB), unresolved: ax || bx
    });
    const sequence = (left, right, visit) => {
        const { normal = 0 } = left;

        return join(outcome({ ...left, normal: 0, value: false, sites: false }), restrict(right, normal, visit));
    };
    // Conditional expression sites follow the same selected conditions as values.
    // Calls and bindings establish their own use site instead of exposing a callee's sites.
    const located = (entry, locations = []) => {
        const { value = false, sites = false } = entry;

        const origins = sites || (value && locations.map(({ location = {}, operator = '', gate = 1 } = {}) => (
            restricted(Object.freeze({ value, location, operator }), gate)
        )).reduce(joined, false));

        return outcome({ ...entry, sites: origins });
    };
    const returned = (entry, location, operator = '') => {
        const { normal = 0, value = false, sites = false } = entry;

        return outcome({ ...entry, normal: 0, value: false, sites: false, returned: normal, result: value,
            returns: sites || (value ? Object.freeze({ value, location, operator }) : false) });
    };
    const thrown = ({ normal = 0, thrown: failure = 0, effects = 0, calls = false, unresolved = false } = {}) => outcome({ thrown: or(normal, failure), effects, calls, unresolved });
    const caught = (entry, handler, visit) => {
        const { thrown = 0 } = entry;

        return join(outcome({ ...entry, thrown: 0, uncertain: 0 }), restrict(handler, thrown, visit));
    };
    const finalized = (entry, cleanup, visit) => {
        const { normal = 0, effects = 0, calls: cleanupCalls = false } = cleanup;
        const { effects: prior = 0, calls = false } = entry;

        // Cleanup replaces completion, never a boundary already reached.
        const completed = join(restrict(entry, normal, visit), outcome({ ...cleanup, normal: 0, value: false, sites: false, effects: or(prior, effects) }));

        return outcome({ ...completed, calls: joined(calls, cleanupCalls) });
    };
    const invoked = ({ normal = 0, returned = 0, thrown = 0, uncertain = 0, effects = 0, result = false, unresolved = false, returns = false, calls = false } = {}, location, visit) => {
        const absentValue = values.restrict(absent, and(normal, not(uncertain)), visit);

        return outcome({ normal: or(normal, returned), thrown, uncertain, effects, value: values.joined([result, absentValue]), unresolved, calls,
            returns: joined(returns, absentValue ? Object.freeze({ value: absentValue, location, fallthrough: true }) : false) });
    };
    // A call owns its body contributions. Callee/argument evaluation is sequenced
    // outside this node, so those obligations cannot become its descendants.
    const called = (entry, { key = '', site = '', call = false } = {}) => {
        const { calls = false } = entry;

        return outcome({ ...entry, calls: Object.freeze({ key, site: site || key, call, descendants: calls }) });
    };
    const describeCalls = (entries, visit) => {
        const selected = [];
        const visited = new Set();
        const seen = new WeakMap();
        const sites = new Set(entries.map(({ key = '' } = {}) => key));

        traverse({ node: { inputs: entries.map(({ entry: { calls = false } = {} } = {}) => calls) } }, {
            enter: ({ node = false, gate = 1, descendant = false } = {}) => {
                if (!node || !gate) return [];

                const conditions = seen.get(node) || put(seen, node, new Set());
                const scope = `${gate}:${descendant}`;

                if (conditions.has(scope)) return [];

                retain(conditions, scope);

                if (typeof visit === 'function') visit('call-contribution');

                const { inputs = false, input = false, gate: ownGate = 1, key = '', site = '', call = false, descendants = false } = node;

                if (inputs) return inputs.map(node => ({ node, gate, descendant }));

                if (input) return [{ node: input, gate: and(gate, ownGate), descendant }];

                if ((!descendant && !sites.has(site)) || visited.has(key)) return [];

                retain(visited, key);
                const { eligible = false } = call ? call : {};

                if (call && (!descendant || eligible)) append(selected, call);

                if (typeof visit === 'function') visit('call-boundary');

                return [{ node: descendants, gate, descendant: true }];
            }
        });

        return Object.freeze(selected);
    };
    const describe = ({ returns = false } = {}, visit) => {
        const selected = [];
        const seen = new WeakMap();

        traverse({ node: returns, gate: 1 }, { enter: ({ node = false, gate = 1 } = {}) => {
            if (!node || !gate) return [];

            const gates = seen.get(node) || put(seen, node, new Set());

            if (gates.has(gate)) return [];

            retain(gates, gate);

            if (typeof visit === 'function') visit();

            const { inputs = false, input = false, gate: ownGate = 1, value = false, location = {}, operator = '', fallthrough = false } = node;

            if (inputs) return inputs.map(child => ({ node: child, gate }));

            if (input) return [{ node: input, gate: and(gate, ownGate) }];

            const result = values.restrict(value, gate, visit);

            if (result) append(selected, Object.freeze({ value: result, location, operator, fallthrough }));

            return [];
        } });

        return Object.freeze(selected);
    };
    const mapReturns = (returns, transform, visit) => {
        if (typeof transform !== 'function') throw new TypeError('Expected return-value projection');

        const completed = new WeakMap();
        const read = node => node && completed.get(node);

        traverse(returns, { enter: (node = false) => {
            if (!node || completed.has(node)) return [];

            if (typeof visit === 'function') visit();

            return valueInputs(node);
        }, leave: (node = false) => {
            if (!node || completed.has(node)) return;

            const { input = false, inputs = false, value = false } = node;

            if (input) {
                put(completed, node, Object.freeze({ ...node, input: read(input) }));

                return;
            }

            if (inputs) {
                put(completed, node, Object.freeze({ ...node, inputs: Object.freeze(inputs.map(read).filter(Boolean)) }));

                return;
            }

            const selected = value && transform(value);

            put(completed, node, selected ? Object.freeze({ ...node, value: selected }) : false);
        } });

        return read(returns);
    };

    return { empty, continuation, complete, outcome, restrict, join, sequence, located, returned, thrown, caught, finalized, invoked, called, describeCalls, describe, mapReturns };
};
