import { append, put, retain, takeLast } from '../collections.js';
import { traverse } from '../traversal.js';

const visit = (onVisit) => {
    if (typeof onVisit !== 'function') return;

    onVisit();
};
const terminal = (operator, left = 0, right = 0) => {
    if (operator === 'and' && (!left || !right)) return 0;

    if (operator === 'or' && (left === 1 || right === 1)) return 1;

    if (left < 2 && right < 2) return operator === 'xor' ? Number(left !== right) : Number(operator === 'and' ? left && right : left || right);

    if (left === right) return operator === 'xor' ? 0 : left;

    if (operator === 'and' && (left === 1 || right === 1)) return left === 1 ? right : left;

    if (operator !== 'and' && (!left || !right)) return left || right;

    return -1;
};
const prepareFrame = (frame, fields) => {
    // eslint-disable-next-line resilient/prefer-safe-transformations -- Only a private decision-frontier frame receives its completed split; no source, context, or published evidence is mutated.
    Object.assign(frame, fields, { ready: true });
};

// Canonical ordered Boolean decisions preserve repeated stable tests without
// enumerating complete execution paths. Node 0 is false; node 1 is true.
// New variables precede old ones: extending a sequential completion condition
// adds a node above its shared history instead of rebuilding that history.
export const createDecisions = ({ limit = Infinity } = {}) => {
    const nodes = new Map();
    const variables = new Map();
    const unique = new Map();
    const computed = new Map();
    const projections = new Map();
    const cacheCounts = new Map([['computed', 0], ['projections', 0]]);
    const work = () => nodes.size + cacheCounts.get('computed') + cacheCounts.get('projections');
    const nodeFor = id => nodes.get(id) || {};
    // Rows retain completed pairs under numeric operands, avoiding composite
    // string allocation and hashing at every visit to the decision frontier.
    const pairFrame = (operator, first, second) => {
        const left = Math.min(first, second);
        const right = Math.max(first, second);
        const rows = computed.get(operator) || put(computed, operator, new Map());
        const results = rows.get(left) || put(rows, left, new Map());

        return { left, right, results, ready: false };
    };
    // eslint-disable-next-line resilient/prefer-safe-destructuring-defaults -- A completed pair requires its original operand and memo row; defaults would publish a different operation.
    const cache = ({ results, right }, value) => {
        if (work() >= limit) throw new RangeError('Analysis decision limit exceeded');

        const existing = results.has(right);

        put(results, right, value);

        if (!existing) put(cacheCounts, 'computed', cacheCounts.get('computed') + 1);

        return value;
    };
    const cacheProjection = (namespace, id, value) => {
        if (work() >= limit) throw new RangeError('Analysis decision limit exceeded');

        const entries = projections.get(namespace) || new Map();
        const existing = entries.has(id);

        put(entries, id, value);

        if (!existing) put(cacheCounts, 'projections', cacheCounts.get('projections') + 1);

        if (!projections.has(namespace)) put(projections, namespace, entries);

        return value;
    };
    const make = ({ variable = -1, low = 0, high = 1 } = {}) => {
        if (low === high) return low;

        const key = `${variable}:${low}:${high}`;

        if (unique.has(key)) return unique.get(key);

        if (work() >= limit) throw new RangeError('Analysis decision limit exceeded');

        const id = nodes.size + 2;

        put(nodes, id, Object.freeze({ variable, low, high }));

        return put(unique, key, id);
    };
    const variable = (key) => {
        if (!variables.has(key)) put(variables, key, variables.size);

        return make({ variable: variables.get(key) });
    };
    const split = (operator, { left = 0, right = 0 } = {}) => {
        const { variable: a = -1, low: al = left, high: ah = left } = nodeFor(left);
        const { variable: b = -1, low: bl = right, high: bh = right } = nodeFor(right);
        const selected = Math.max(a, b);

        return { variable: selected, low: pairFrame(operator, a === selected ? al : left, b === selected ? bl : right),
            high: pairFrame(operator, a === selected ? ah : left, b === selected ? bh : right) };
    };
    const apply = (operator, first, second) => {
        const immediate = terminal(operator, first, second);

        if (immediate >= 0) return immediate;

        const root = pairFrame(operator, first, second);
        // eslint-disable-next-line resilient/prefer-safe-destructuring-defaults -- A pair frame requires its original operand and memo row; defaults would select another operation.
        const { results: rootResults, right: rootRight } = root;

        if (rootResults.has(rootRight)) return rootResults.get(rootRight);

        const pending = [root];

        // eslint-disable-next-line resilient/prefer-prototype-methods -- Boolean pairs discover children dynamically; completed splits stay in private frames until both child results are published.
        while (pending.length) {
            const current = pending.at(-1);
            // eslint-disable-next-line resilient/prefer-safe-destructuring-defaults -- Private pair frames require operands, stage, and memo row; absence cannot become a terminal operand.
            const { results, ready, left, right } = current;

            if (results.has(right)) {
                takeLast(pending);

                continue;
            }

            if (ready) {
                // eslint-disable-next-line resilient/prefer-safe-destructuring-defaults -- Ready pairs require their selected variable and child memo rows; defaults cannot replace a completed split.
                const { variable, lowResults, lowRight, highResults, highRight } = current;

                cache(current, make({ variable, low: lowResults.get(lowRight), high: highResults.get(highRight) }));
                takeLast(pending);

                continue;
            }

            const result = terminal(operator, left, right);

            if (result >= 0) {
                cache(current, result);
                takeLast(pending);

                continue;
            }

            // eslint-disable-next-line resilient/prefer-safe-destructuring-defaults -- Splits require a variable and both child frames; missing children must fail rather than become Boolean evidence.
            const { variable, low: { results: lowResults, right: lowRight }, high: { results: highResults, right: highRight }, low, high } = split(operator, current);

            prepareFrame(current, { variable, lowResults, lowRight, highResults, highRight });
            append(pending, high);
            append(pending, low);
        }

        if (work() > limit) throw new RangeError('Analysis decision limit exceeded');

        return rootResults.get(rootRight);
    };
    const possible = (root, truths = new Map(), onVisit) => {
        const values = new Map([[0, false], [1, true]]);
        const children = (id) => {
            const { variable: selected = -1, low = 0, high = 1 } = nodes.get(id);
            const truth = truths.get(selected);

            if (truth === true) return [high];

            return truth === false ? [low] : [low, high];
        };

        traverse(root, { enter: (id) => {
            if (values.has(id)) return [];

            visit(onVisit);

            return children(id);
        }, leave: (id) => {
            if (!values.has(id)) put(values, id, children(id).some(child => values.get(child)));
        } });

        return values.get(root);
    };

    const dependencies = (roots, onVisit) => {
        const seen = new Set();
        const selected = new Set();

        roots.forEach(root => traverse(root, { enter: (id) => {
            if (id < 2 || seen.has(id)) return [];

            retain(seen, id);

            visit(onVisit);

            const { variable: key = -1, low = 0, high = 1 } = nodes.get(id);

            retain(selected, key);

            return [low, high];
        } }));

        return [...selected];
    };

    // eslint-disable-next-line resilient/prefer-safe-destructuring-defaults -- Identity reuse requires the frame's original ID, variable, and children; defaults could falsely prove an unchanged node.
    const rebuild = ({ id, variable, low: previousLow, high: previousHigh }, low, high) => {
        if (low === previousLow && high === previousHigh) return id;

        return make({ variable, low, high });
    };
    const project = (root, keep, { key = '', onVisit } = {}) => {
        if (typeof keep !== 'function') throw new TypeError('Expected a decision projection predicate');

        if (root < 2) return root;

        const namespace = `project:${key}:`;
        const previous = projections.get(namespace);

        if (previous && previous.has(root)) return previous.get(root);

        const pending = [{ id: root, ready: false }];

        // eslint-disable-next-line resilient/prefer-prototype-methods -- Projection publishes children before their parent and preserves observer order with an explicit private frontier.
        while (pending.length) {
            const current = pending.at(-1);
            // eslint-disable-next-line resilient/prefer-safe-destructuring-defaults -- Private projection frames require their numeric identity and stage; omission must not select another projection.
            const { id, ready } = current;
            const entries = projections.get(namespace);

            if (entries && entries.has(id)) {
                takeLast(pending);

                continue;
            }

            if (ready) {
                // eslint-disable-next-line resilient/prefer-safe-destructuring-defaults -- Ready projections require their variable and child IDs; missing state cannot become a Boolean decision.
                const { variable, low, high } = current;
                const retained = keep(variable);
                const completed = projections.get(namespace);
                const selectedLow = low < 2 ? low : completed.get(low);
                const selectedHigh = high < 2 ? high : completed.get(high);
                const result = retained ? rebuild(current, selectedLow, selectedHigh) : apply('or', selectedLow, selectedHigh);

                cacheProjection(namespace, id, result);
                takeLast(pending);

                continue;
            }

            visit(onVisit);

            // eslint-disable-next-line resilient/prefer-safe-destructuring-defaults -- Canonical nodes require variable and child IDs; defaults fabricate evidence after missing publication.
            const { variable, low, high } = nodes.get(id);

            prepareFrame(current, { variable, low, high });

            if (high >= 2) append(pending, { id: high, ready: false });

            if (low >= 2) append(pending, { id: low, ready: false });
        }

        return projections.get(namespace).get(root);
    };

    return { variable, dependencies, and: (left, right) => apply('and', left, right), or: (left, right) => apply('or', left, right),
        not: value => apply('xor', value, 1), possible, project, variables, count: () => nodes.size, work };
};
