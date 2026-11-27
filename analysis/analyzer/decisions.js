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
const pairWidth = 2 ** 26;
const pairRow = ({ packed: small = new Map(), wide = new Map() } = {}, left, packed) => {
    const block = packed ? Math.floor(left / 4096) : left;
    const rows = packed ? small : wide;

    return rows.get(block) || put(rows, block, new Map());
};
const pairTable = () => ({ packed: new Map(), wide: new Map() });
const hashNode = (variable, low, high) => {
    const mixed = Math.imul(variable + 1, 0x9e3779b1) ^ Math.imul(low + 1, 0x85ebca77) ^ Math.imul(high + 1, 0xc2b2ae3d);

    return mixed ^ (mixed >>> 16);
};
const createIndex = size => new DataView(new ArrayBuffer(size * 4));
// Only the private canonical index is written. The node's identity and evidence stay immutable.
const placeNode = (table, position, id) => table.setUint32(position * 4, id, true);
const noFrame = Object.freeze({ low: -1 });

// Canonical ordered Boolean decisions preserve repeated stable tests without
// enumerating complete execution paths. Node 0 is false; node 1 is true.
// New variables precede old ones: extending a sequential completion condition
// adds a node above its shared history instead of rebuilding that history.
export const createDecisions = ({ limit = Infinity, memoEntries = 1048576 } = {}) => {
    const nodeVariables = [];
    const nodeLows = [];
    const nodeHighs = [];
    const variables = new Map();
    const unique = new Map([['table', createIndex(1024)]]);
    const computed = new Map();
    const projections = new Map();
    let computedCount = 0;
    let projectionCount = 0;
    let memoSize = 0;
    const work = () => nodeVariables.length + computedCount + projectionCount;
    const nodeFor = id => id < 2 ? {} : { variable: nodeVariables.at(id - 2), low: nodeLows.at(id - 2), high: nodeHighs.at(id - 2) };
    const cache = (results, key, value) => {
        if (work() >= limit) throw new RangeError('Analysis decision limit exceeded');

        put(results, key, value);
        computedCount += 1;
        memoSize += 1;

        return value;
    };
    const cacheProjection = (namespace, id, value) => {
        if (work() >= limit) throw new RangeError('Analysis decision limit exceeded');

        const entries = projections.get(namespace) || new Map();
        const existing = entries.has(id);

        put(entries, id, value);

        if (!existing) projectionCount += 1;

        if (!projections.has(namespace)) put(projections, namespace, entries);

        return value;
    };
    const positionFor = (table, variable, low, high) => {
        const { byteLength = 0 } = table;
        const mask = byteLength / 4 - 1;
        let position = (hashNode(variable, low, high) & mask) >>> 0;
        let id = table.getUint32(position * 4, true);

        // eslint-disable-next-line resilient/prefer-prototype-methods -- Open addressing follows collisions in the private index. It stops at the equal canonical node or the first empty position.
        while (id) {
            const index = id - 2;

            if (nodeVariables.at(index) === variable && nodeLows.at(index) === low && nodeHighs.at(index) === high) return position;

            position = ((position + 1) & mask) >>> 0;
            id = table.getUint32(position * 4, true);
        }

        return position;
    };
    const growUnique = ({ byteLength = 0 } = {}) => {
        const grown = createIndex(byteLength / 2);

        nodeVariables.forEach((variable, index) => {
            const position = positionFor(grown, variable, nodeLows.at(index), nodeHighs.at(index));

            placeNode(grown, position, index + 2);
        });

        return put(unique, 'table', grown);
    };
    const make = (variable, low, high) => {
        if (low === high) return low;

        const current = unique.get('table');
        const slot = positionFor(current, variable, low, high);
        const previous = current.getUint32(slot * 4, true);

        if (previous) return previous;

        if (work() >= limit) throw new RangeError('Analysis decision limit exceeded');

        const id = nodeVariables.length + 2;
        const { byteLength = 0 } = current;
        const table = id * 8 >= byteLength ? growUnique(current) : current;
        const position = table === current ? slot : positionFor(table, variable, low, high);

        append(nodeVariables, variable);
        append(nodeLows, low);
        append(nodeHighs, high);
        placeNode(table, position, id);

        return id;
    };
    const variable = (key) => {
        if (!variables.has(key)) put(variables, key, variables.size);

        return make(variables.get(key), 0, 1);
    };
    const releaseMemo = () => {
        if (memoSize < memoEntries) return;

        // eslint-disable-next-line resilient/prefer-safe-transformations -- Clearing this private cache leaves canonical IDs and published results intact.
        computed.clear();
        memoSize = 0;
    };
    const apply = (operator, first, second) => {
        const immediate = terminal(operator, first, second);

        if (immediate >= 0) return immediate;

        releaseMemo();
        const table = computed.get(operator) || put(computed, operator, pairTable());
        const pending = [];
        let firstOperand = first;
        let secondOperand = second;
        let result = -1;

        // Each unresolved pair needs one frame. A completed child passes its ID
        // directly to its parent, including a terminal or memoized child.
        // eslint-disable-next-line resilient/prefer-prototype-methods -- Boolean pairs discover children dynamically and publish a parent only after both child results are available.
        while (result < 0 || pending.length) {
            const frame = result >= 0 ? pending.at(-1) ?? noFrame : noFrame;
            const { low = -1 } = frame;

            if (frame !== noFrame && low < 0) {
                // eslint-disable-next-line resilient/prefer-safe-destructuring-defaults -- An unfinished pair owns both high operands.
                const { highLeft, highRight } = frame;

                // eslint-disable-next-line resilient/prefer-safe-transformations -- The pending pair owns this frame and its low-child result is assigned once.
                frame.low = result;
                firstOperand = highLeft;
                secondOperand = highRight;
                result = -1;

                continue;
            }

            if (frame !== noFrame) {
                // eslint-disable-next-line resilient/prefer-safe-destructuring-defaults -- A completed frame must publish to its original pair and canonical variable.
                const { variable, results, key } = frame;

                result = cache(results, key, make(variable, low, result));
                takeLast(pending);

                continue;
            }

            result = terminal(operator, firstOperand, secondOperand);

            if (result >= 0) continue;

            const left = Math.min(firstOperand, secondOperand);
            const right = Math.max(firstOperand, secondOperand);
            // Small pairs pack exactly; wide pairs keep separate numeric keys.
            const packed = right < pairWidth;
            const results = pairRow(table, left, packed);
            const key = packed ? left * pairWidth + right : right;

            result = results.get(key) ?? -1;

            if (result >= 0) continue;

            const leftIndex = left - 2;
            const rightIndex = right - 2;
            const a = leftIndex < 0 ? -1 : nodeVariables.at(leftIndex) ?? -1;
            const b = rightIndex < 0 ? -1 : nodeVariables.at(rightIndex) ?? -1;
            const variable = Math.max(a, b);

            const splitLeft = a >= 0 && a === variable;
            const splitRight = b >= 0 && b === variable;

            append(pending, { variable, results, key, low: -1,
                highLeft: splitLeft ? nodeHighs.at(leftIndex) : left, highRight: splitRight ? nodeHighs.at(rightIndex) : right });
            firstOperand = splitLeft ? nodeLows.at(leftIndex) : left;
            secondOperand = splitRight ? nodeLows.at(rightIndex) : right;
        }

        return result;
    };
    const possible = (root, truths = new Map(), onVisit) => {
        const values = new Map([[0, false], [1, true]]);
        const children = (id) => {
            const { variable: selected = -1, low = 0, high = 1 } = nodeFor(id);
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

            const { variable: key = -1, low = 0, high = 1 } = nodeFor(id);

            retain(selected, key);

            return [low, high];
        } }));

        return [...selected];
    };

    // eslint-disable-next-line resilient/prefer-safe-destructuring-defaults -- Identity reuse requires the frame's original ID, variable, and children; defaults could falsely prove an unchanged node.
    const rebuild = ({ id, variable, low: previousLow, high: previousHigh }, low, high) => {
        if (low === previousLow && high === previousHigh) return id;

        return make(variable, low, high);
    };
    const project = (root, keep, { key = '', onVisit, local = false } = {}) => {
        if (typeof keep !== 'function') throw new TypeError('Expected a decision projection predicate');

        if (root < 2) return root;

        const namespace = `project:${key}:`;
        const previous = projections.get(namespace);

        if (previous && previous.has(root)) return previous.get(root);

        // Source-site filters share completed requests. Their internal pairs
        // are private to a walk because other sites own different predicates.
        const scratch = local ? new Map() : false;
        const entriesFor = () => scratch || projections.get(namespace);
        const publish = (id, result) => {
            if (!scratch || id === root) return cacheProjection(namespace, id, result);

            if (work() + scratch.size >= limit) throw new RangeError('Analysis decision limit exceeded');

            return put(scratch, id, result);
        };
        const pending = [{ id: root, ready: false }];

        // eslint-disable-next-line resilient/prefer-prototype-methods -- Projection publishes children before their parent and preserves observer order with an explicit private frontier.
        while (pending.length) {
            const current = pending.at(-1);
            // eslint-disable-next-line resilient/prefer-safe-destructuring-defaults -- Private projection frames require their numeric identity and stage; omission must not select another projection.
            const { id, ready } = current;
            const entries = entriesFor();

            if (entries && entries.has(id)) {
                takeLast(pending);

                continue;
            }

            if (ready) {
                // eslint-disable-next-line resilient/prefer-safe-destructuring-defaults -- Ready projections require their variable and child IDs; missing state cannot become a Boolean decision.
                const { variable, low, high } = current;
                const retained = keep(variable);
                const completed = entriesFor();
                const selectedLow = low < 2 ? low : completed.get(low);
                const selectedHigh = high < 2 ? high : completed.get(high);
                const result = retained ? rebuild(current, selectedLow, selectedHigh) : apply('or', selectedLow, selectedHigh);

                publish(id, result);
                takeLast(pending);

                continue;
            }

            if (scratch && previous && previous.has(id)) {
                publish(id, previous.get(id));
                takeLast(pending);

                continue;
            }

            visit(onVisit);

            // eslint-disable-next-line resilient/prefer-safe-destructuring-defaults -- Canonical nodes require variable and child IDs; defaults fabricate evidence after missing publication.
            const { variable, low, high } = nodeFor(id);

            prepareFrame(current, { variable, low, high });

            if (high >= 2) append(pending, { id: high, ready: false });

            if (low >= 2) append(pending, { id: low, ready: false });
        }

        return projections.get(namespace).get(root);
    };

    return { variable, dependencies, and: (left, right) => apply('and', left, right), or: (left, right) => apply('or', left, right),
        not: value => apply('xor', value, 1), possible, project, variables, count: () => nodeVariables.length, work };
};
