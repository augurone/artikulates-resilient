import { append, put, retain } from '../collections.js';
import { sourcePropertyName as propertyName } from '../estree-properties.js';
import { traverse } from '../traversal.js';

// Prefix subtrees occupy contiguous ranges. A balanced interval index keeps a
// publication shared by all descendant aliases: O(log P) records per event and
// read, rather than an event list copied to every selected path.
const copyRegions = (roots) => {
    const positions = [];
    const ranges = new WeakMap();

    roots.forEach(root => traverse(root, { enter: (path) => {
        const { children = new Map() } = path;

        put(ranges, path, { start: positions.length });
        append(positions, path);

        return [...children.values()];
    }, leave: path => put(ranges, path, { ...ranges.get(path), end: positions.length }) }));
    const size = 2 ** Math.ceil(Math.log2(Math.max(positions.length, 1)));
    const covering = (path) => {
        const { start = 0, end = 0 } = ranges.get(path) ?? {};
        const result = [];

        traverse({ left: start + 1 + size, right: end + size }, { enter: ({ left = 0, right = 0 } = {}) => {
            if (left >= right) return [];

            if (left % 2) append(result, left);

            if (right % 2) append(result, right - 1);

            return [{ left: Math.ceil(left / 2), right: Math.floor(right / 2) }];
        } });

        return result;
    };
    const containing = (path) => {
        const { start = -1 } = ranges.get(path) ?? {};
        const result = [];

        if (start < 0) return result;

        traverse(start + size, { enter: (region) => {
            append(result, region);

            return region > 1 ? [Math.floor(region / 2)] : [];
        } });

        return result;
    };

    return { covering, containing };
};

// A shallow copy publishes field values, not its source receiver. Canonical
// selection prefixes share aliases and pattern selections without path arrays.
export const acquireMemberCopies = ({ references = [], memberAccesses = [], identities = new WeakMap(), writes = new Set(),
    executionOf = new WeakMap(), selectionFor = () => false } = {}, contextFor) => {
    const paths = new WeakMap();
    const roots = new WeakMap();
    const rootPaths = [];
    const events = [];
    const executions = new Map();
    const consumers = new WeakSet();
    const lifetimes = new WeakMap();
    const rootFor = (key, execution) => {
        if (roots.has(key)) return roots.get(key);

        const path = { execution, children: new Map() };

        append(rootPaths, path);

        return put(roots, key, path);
    };
    const childFor = ({ execution = false, children = new Map() } = {}, name) => (
        children.get(name) || put(children, name, { execution, children: new Map(), selection: true })
    );
    const previous = (node = {}, { type = '', object = false, patternValue = '', target = false, init = false, range: [start = -1] = [] } = node) => {
        if (type === 'MemberExpression') return object;

        if (patternValue === 'root') return init;

        if (patternValue === 'field') return target;

        if (type !== 'Identifier') return false;

        const binding = identities.get(node);
        const { immutable = false, init: initializer = false, declaration: { destructured = false } = {} } = binding ?? {};
        const { type: initialized = '', range: [, end = Infinity] = [] } = initializer ? initializer : {};

        if (!immutable || writes.has(binding) || end > start) return false;

        if (destructured) return selectionFor(binding);

        return ['Identifier', 'MemberExpression'].includes(initialized) && initializer;
    };
    const pathFor = (node) => {
        traverse(node, { enter: current => paths.has(current) ? [] : [previous(current)].filter(Boolean), leave: (current = {}) => {
            if (paths.has(current)) return;

            const { type = '', computed = false, property = {}, patternValue = '', name: selected = '', position = -1 } = current;
            const before = previous(current);
            const parent = before && paths.get(before);
            const binding = identities.get(current);
            const { immutable = false, execution = false, declaration: { destructured = false } = {} } = binding ?? {};
            const { known = false, name = '' } = propertyName({ computed, key: property });
            const member = type === 'MemberExpression' && known;
            const field = patternValue === 'field';
            const rooted = type === 'Identifier' && immutable && !destructured && !writes.has(binding);
            const root = rooted && rootFor(binding, execution);
            const fieldName = position >= 0 ? String(position) : selected;
            const path = member || field ? parent && childFor(parent, member ? name : fieldName) : parent || root;

            put(paths, current, path || false);
        } });

        return paths.get(node);
    };
    const register = (node, consumer) => {
        const path = pathFor(node);
        const { selection = false } = path ? path : {};

        if (!selection) return false;

        const { execution = false } = path;
        const { range: [, end = -1] = [] } = consumer;
        const local = execution === executionOf.get(consumer);

        append(events, { path, source: consumer, position: local ? end : -1, call: local && consumer });
        retain(executions.get(path) || put(executions, path, new Set()), executionOf.get(consumer));
        retain(consumers, consumer);

        return true;
    };
    const finish = () => {
        if (!events.length) return;

        const latest = new Map();
        const external = Object.freeze({ lifetime: true, call: false });
        const reads = [...references, ...memberAccesses].map(({ node = {} } = {}) => {
            const { range: [position = -1] = [] } = node;
            const path = pathFor(node);
            const providers = executions.get(path);
            const crossed = providers && (providers.size > 1 || !providers.has(executionOf.get(node)));

            return { path, source: node, position, reading: true, crossed };
        });

        const regions = copyRegions(rootPaths);
        const providers = new Map();
        const published = new Map();
        const scoped = events.map((entry) => {
            const { path = false, source = {} } = entry;
            const covering = regions.covering(path);

            covering.forEach(region => retain(providers.get(region) || put(providers, region, new Set()), executionOf.get(source)));

            return { ...entry, covering };
        });

        [...scoped, ...reads].toSorted(({ position: a = -1, reading: first = false } = {}, { position: b = -1, reading: second = false } = {}) => (
            a - b || Number(first) - Number(second)
        )).forEach(({ path = false, source = {}, reading = false, call = false, crossed = false, covering = [] } = {}) => {
            if (!path) return;

            const prior = latest.get(path) || false;

            if (reading) {
                const shallow = crossed ? external : prior;
                const { type = '' } = source;
                const deep = (type === 'Identifier' ? regions.containing(path) : []).map((region) => {
                    const executions = providers.get(region);
                    const foreign = executions && (executions.size > 1 || !executions.has(executionOf.get(source)));

                    return foreign ? external : published.get(region);
                }).filter(Boolean);
                const proofs = [...new Set(deep)].map(lifetime => ({ lifetime, deep: true })).concat(shallow ? [{ lifetime: shallow, deep: false }] : []);

                put(lifetimes, source, Object.freeze(proofs));

                return;
            }

            const ordered = Boolean(call && contextFor(call).ordered);

            put(latest, path, { lifetime: true, call, prior, ordered });
            covering.forEach(region => put(published, region, { lifetime: true, call, prior: published.get(region) || false, ordered }));
        });
    };

    return { register, finish, forNode: node => lifetimes.get(node) || [], consumer: node => consumers.has(node) };
};
