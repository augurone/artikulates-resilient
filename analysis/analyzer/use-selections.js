import { append, forget, put, retain, takeLast } from '../collections.js';
import { traverse } from '../traversal.js';

// An element's position travels through carrier forwarding, not through the
// selected element's consumer. Only demanded subject/range pairs are acquired.
export const acquireUseSelections = (uses, observe = use => use) => {
    const selections = new Map();
    const subjects = new Set();
    const roots = [];
    const completed = new Set();
    const active = new Set();
    const sources = new Map();
    const continuations = new Map();
    const continuationIds = [];
    // Apply a returned carrier's consumer after its acquired position changes,
    // rather than selecting the consumer at the producer's original address.
    const continuationFor = ({ resultTarget = false, nestedResultTarget = false, resultDepth = 1, capability = false } = {}, outer = {}) => {
        const { index = -1 } = outer;
        const nested = continuations.get(resultTarget) || put(continuations, resultTarget, new Map());
        const choices = nested.get(nestedResultTarget) || put(nested, nestedResultTarget, new Map());
        const key = `${resultDepth}/${index}`;
        const proofs = choices.get(key) || put(choices, key, new Map());

        if (proofs.has(capability)) return proofs.get(capability);

        const result = { index: continuationIds.length, resultTarget, nestedResultTarget, resultDepth, outer, capability };

        append(continuationIds, result);

        return put(proofs, capability, result);
    };
    const sourceFor = (acquire) => {
        const subject = Object.freeze({});

        put(sources, subject, acquire);
        put(uses, subject, acquire([{ minimum: 0, maximum: Infinity }]));

        return subject;
    };
    const project = (source, path, continuation = {}) => {
        const slots = selections.get(source) || put(selections, source, new Map());
        const { index = -1 } = continuation;
        const key = `${index}/` + path.map(({ minimum = 0, maximum = Infinity } = {}) => `${minimum}:${maximum}`).join('/');

        if (slots.has(key)) return slots.get(key);

        const subject = Object.freeze({});

        put(slots, key, subject);
        put(uses, subject, []);
        retain(subjects, subject);
        append(roots, { source, subject, path, continuation });

        return subject;
    };
    const consumeResult = ({ resultTarget: consumer = false, nestedResultTarget: nested = false, resultDepth = 1, outer = {}, capability = false } = {},
        path, uncertainPositions, pending, node = false) => {
        const result = path.length === resultDepth ? consumer : path.length === resultDepth + 1 && nested;
        const positions = uncertainPositions ? path.map(() => ({ minimum: 0, maximum: Infinity })) : path;

        if (!result) return [{ kind: 'escape' }];

        const projected = project(result, positions, outer);

        append(pending, { source: result, subject: projected, path: positions, continuation: outer });

        const use = { kind: 'forward', target: projected };

        return [node && capability ? observe({ ...use, node, capability }) : use];
    };
    const select = (source, minimum = 0, maximum = Infinity) => project(source, [{ minimum, maximum }]);
    const completeRoot = root => traverse(root, { enter: ({ source = false, subject = false, path = [], continuation = {} } = {}) => {
        const [{ minimum = 0, maximum = Infinity } = {}] = path;
        const { index: returningIndex = -1 } = continuation;
        const returningResult = returningIndex >= 0;

        if (completed.has(subject)) return [];

        retain(completed, subject);
        retain(active, source);
        const pending = [];
        const acquire = sources.get(source);
        const original = acquire ? acquire(path) : uses.get(source) || [];
        const entries = original.flatMap((entry) => {
            const { selected = false, unnest = false, enclosed = false, reposition = false, target = false, kind = '', offset = {}, resultTarget = false,
                selectResult = false, uncertainPositions = false, ...description } = entry;
            const { minimum: lower = 0, maximum: upper = Infinity } = selected ? selected : {};

            const { resultRole = '', capability = false, returnNode = false } = description;

            if (returningResult && resultRole === 'discard') return [];

            if (selected && (minimum > upper || maximum < lower)) return [];

            if (selected && (!unnest || path.length < 2)) return [{ ...description, kind, target, resultTarget }];

            if (kind === 'result' && returningResult) return consumeResult(continuation, path, uncertainPositions, pending, returnNode);

            if (kind !== 'forward' || !target || subjects.has(target)) return [entry];

            if (active.has(target) && !returningResult) return [entry];

            if (active.has(target)) {
                const { resultTarget = false, nestedResultTarget = false } = continuation;

                return [{ kind: 'escape' }, ...[resultTarget, nestedResultTarget].filter(Boolean).map(target => ({ kind: 'forward', target }))];
            }

            const { minimum: shift = 0, maximum: limit = 0 } = offset;
            const shifted = [reposition || { minimum: minimum + shift, maximum: maximum + limit }, ...path.slice(1)];
            const retained = uncertainPositions ? shifted.map(() => ({ minimum: 0, maximum: Infinity })) : shifted;
            const next = unnest ? path.slice(1) : retained;
            const positions = enclosed ? [enclosed, ...next] : next;
            const { outer = {}, capability: origin = false } = continuation;
            const proof = returningResult && capability && capability !== origin ? continuationFor({ ...continuation, capability }, outer) : continuation;
            const returning = selectResult && resultTarget ? continuationFor(entry, proof) : proof;
            const projected = project(target, positions, returning);

            append(pending, { source: target, subject: projected, path: positions, continuation: returning });

            return [{ ...entry, target: projected, resultTarget: selectResult ? false : resultTarget }];
        });

        put(uses, subject, entries);

        return pending;
    }, leave: ({ source = false } = {}) => forget(active, source) });
    const complete = () => {
        // eslint-disable-next-line resilient/prefer-prototype-methods -- Projected argument positions can discover further rest selections; this private frontier drains each acquired subject once.
        while (roots.length) completeRoot(takeLast(roots));
    };

    return { select, sourceFor, complete };
};
