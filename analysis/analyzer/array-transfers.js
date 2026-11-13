import { append, put, retain } from '../collections.js';
import { propertyName } from '../estree-properties.js';
import { traverse } from '../traversal.js';
import { arrayDataMethods, nativeResultFamily } from './native-members.js';

export const arrayCallbacks = new Set(['every', 'filter', 'find', 'findIndex', 'findLast', 'findLastIndex', 'flatMap', 'forEach', 'map', 'reduce',
    'reduceRight', 'some', 'sort', 'toSorted']);
const arrayResults = new Set(['concat', 'copyWithin', 'fill', 'filter', 'reverse', 'slice', 'sort', 'splice', 'toReversed', 'toSorted', 'toSpliced', 'with']);

// Native array argument/result positions are acquired once per call. Unknown
// indexes stay unknown; they cannot become a known append or overwrite.
export const acquireArrayTransfers = ({ methodFor, arrayMethodFor, argumentsFor, widthFor, selectionSourceFor,
    operators = new WeakMap(), identities = new WeakMap(), positionsSafe, nativeArrays = true } = {}) => {
    if (typeof methodFor !== 'function' || typeof arrayMethodFor !== 'function' || typeof argumentsFor !== 'function' ||
        typeof widthFor !== 'function' || typeof positionsSafe !== 'function' || typeof selectionSourceFor !== 'function') throw new TypeError('Expected acquired array transfer dependencies');

    const transfers = new WeakMap();
    const facts = new WeakMap();
    const complete = new WeakSet();
    const arrayFor = (node) => {
        if (complete.has(node)) return facts.get(node);

        traverse(node, { enter: (current = {}) => {
            if (facts.has(current)) return [];

            put(facts, current, { minimum: 0, maximum: Infinity, visits: 0, possibleVisits: Infinity });
            const { type = '' } = current;
            const { init = false } = identities.get(current) ?? {};

            return type === 'Identifier' && init && positionsSafe(current) ? [init] : [];
        }, leave: (current = {}) => {
            if (complete.has(current)) return;

            retain(complete, current);
            const { type = '', elements = [] } = current;
            const { init = false } = identities.get(current) ?? {};
            const source = type === 'Identifier' && init && positionsSafe(current) && facts.get(init);
            const width = widthFor(current);
            const { minimum = 0, maximum = Infinity } = width;
            const present = elements.filter(Boolean);
            const fixed = type === 'ArrayExpression' && !present.some(({ type = '' } = {}) => type === 'SpreadElement');
            const first = fixed ? elements.findIndex(Boolean) : -1;
            const last = fixed ? elements.findLastIndex(Boolean) : -1;
            const count = type === 'ArrayExpression' ? present.reduce(({ visits = 0, possibleVisits = 0 } = {}, { type = '', argument = {} } = {}) => {
                const { minimum = 1, maximum = 1 } = type === 'SpreadElement' ? widthFor(argument) : {};

                return { visits: visits + minimum, possibleVisits: possibleVisits + maximum };
            }, { visits: 0, possibleVisits: 0 }) : { visits: 0, possibleVisits: Infinity };

            put(facts, current, source || { minimum, maximum, first, last, ...count });
        } });

        return facts.get(node);
    };

    const undefinedArgument = (node = {}) => {
        const { type = '', name = '' } = node;

        return (type === 'UnaryExpression' && operators.get(node) === 'void') ||
            (type === 'Identifier' && name === 'undefined' && !identities.has(node));
    };
    const integer = (node = {}) => {
        const { type = '', value = false, argument = {}, regex = false } = node;
        const { type: operand = '', value: number = false } = argument;

        if (undefinedArgument(node)) return 0;

        if (type === 'Literal' && !regex && (value === null || ['number', 'string', 'boolean'].includes(typeof value))) return Math.trunc(Number(value)) || 0;

        const operator = operators.get(node);
        const signed = type === 'UnaryExpression' && operand === 'Literal' && typeof number === 'number' && ['-', '+'].includes(operator);

        return signed ? Math.trunc(operator === '-' ? -number : number) : NaN;
    };
    const indexAt = (node, fallback, length) => {
        const value = node ? integer(node) : fallback;

        if (value >= 0) return value;

        return Number.isFinite(length) ? Math.max(0, length + value) : NaN;
    };
    const optionalEnd = (node, length) => indexAt(undefinedArgument(node) ? false : node, length, length);

    return (call = {}) => {
        if (transfers.has(call)) return transfers.get(call);

        const { callee = {} } = call;
        const { object = {} } = callee;
        const name = methodFor(callee);
        const { stable = false, replacement = false } = arrayMethodFor(callee);
        const selectedResult = ['at', 'pop', 'shift'].includes(name);
        const reversed = ['reverse', 'toReversed'].includes(name);
        const supported = nativeArrays && stable && !replacement &&
            (selectedResult || reversed || ['with', 'fill', 'toSpliced', 'concat', 'slice', 'reduce', 'reduceRight'].includes(name));

        if (!supported) return put(transfers, call, {});

        const args = argumentsFor(call);
        const stablePositions = positionsSafe(object, call);
        const { minimum = 0, maximum = Infinity, visits = 0, possibleVisits = Infinity, first: firstPresent = -1, last: lastPresent = -1 }
            = stablePositions ? arrayFor(object) : {};
        const inputs = new Map();

        if (name === 'reduce' || name === 'reduceRight') return put(transfers, call, { name, args, minimum: visits, maximum: possibleVisits,
            seed: name === 'reduce' ? firstPresent : lastPresent, terminal: name === 'reduce' ? lastPresent : firstPresent, inputs });

        const length = minimum === maximum ? minimum : Infinity;
        const [first = false, , third = false] = args;

        if (selectedResult) {
            const index = name === 'at' && first ? integer(first) : 0;
            const relative = index < 0 ? length + index : index;
            const position = name === 'pop' ? length - 1 : relative;
            const exact = stablePositions && Number.isFinite(position);

            return put(transfers, call, { selected: exact ? { minimum: position, maximum: position } : { minimum: 0, maximum: Infinity } });
        }

        const second = args.at(1);
        const withIndex = name === 'with' && first ? integer(first) : 0;
        const relative = withIndex < 0 ? length + withIndex : withIndex;
        const rawStart = name === 'with' ? relative : indexAt(name === 'fill' ? second : first, 0, length);
        const start = name === 'with' ? rawStart : Math.min(length, rawStart);
        const omittedRemoval = args.length ? length : 0;
        const removed = args.length > 1 ? Math.max(0, integer(second)) : omittedRemoval;
        const ends = { with: start + 1, fill: optionalEnd(third, length), toSpliced: Math.min(length, start + removed), slice: optionalEnd(second, length) };
        const { [name]: end = 0 } = ends;
        const offsets = [];

        args.reduce((offset, value = {}) => {
            append(offsets, offset);
            const { type = '' } = value;
            const { minimum = 0, maximum = Infinity } = widthFor(value);
            const scalar = ['Literal', 'FunctionExpression', 'ArrowFunctionExpression', 'ObjectExpression'].includes(type);
            const width = scalar ? 1 : Infinity;

            return offset + (type === 'ArrayExpression' && minimum === maximum ? minimum : width);
        }, length);
        const inserted = name === 'toSpliced' ? Math.max(0, args.length - 2) : 0;
        const fixed = Number.isFinite(start) && !args.some(({ type = '' } = {}) => type === 'SpreadElement');
        // An insertion starts after clipping to the receiver length. With
        // unknown length, a positive start is an upper bound on that slot.
        const insertionStart = name === 'toSpliced' && !Number.isFinite(length) ? 0 : start;
        const exactStart = name !== 'toSpliced' || insertionStart === start;
        const receiver = target => selectionSourceFor((path) => {
            if (!stablePositions) return [{ kind: 'forward', target, uncertainPositions: true }];

            const [{ minimum = 0, maximum = Infinity } = {}] = path;

            if (reversed) {
                const reposition = Number.isFinite(length) ? { minimum: Math.max(0, length - maximum - 1), maximum: length - minimum - 1 }
                    : { minimum: 0, maximum: Infinity };

                return [{ kind: 'forward', target, reposition }];
            }

            if (!exactStart) return [{ kind: 'forward', target, uncertainPositions: true }];

            const before = maximum < start;
            const after = minimum >= end;

            if (['with', 'fill', 'toSpliced'].includes(name) && fixed && minimum >= start && maximum < end) return [];

            if (name === 'slice' && fixed && (before || after)) return [];

            const exact = name === 'concat' || (fixed && (name === 'slice' || before || after));
            const moved = name === 'toSpliced' && after ? inserted - (end - start) : 0;
            const shift = name === 'slice' && fixed ? -start : moved;

            return [{ kind: 'forward', target, offset: { minimum: shift, maximum: shift }, uncertainPositions: !exact }];
        });

        return put(transfers, call, { name, args, minimum, maximum, start, insertionStart, end, fixed, offsets, receiver, inputs });
    };
};

// Callback effects and the values returned through native array methods have
// separate consumers. Every projection works at the existing carrier depth.
export const acquireArrayResults = (bySubject, selectSubjectFor, selectionSourceFor) => {
    const positionRelay = (target, placement) => {
        if (!target) return false;

        const subject = Object.freeze({});

        put(bySubject, subject, [{ kind: 'forward', target, ...placement }]);

        return subject;
    };
    const scalarResultUse = ({ resultRole = '', resultTarget = false } = {}) => {
        if (resultRole === 'invoke') return { kind: 'argument' };

        if (resultRole === 'return') return { kind: 'result' };

        return resultTarget ? { kind: 'forward', target: resultTarget, absenceSafe: true, unresolvedRequiresCallable: true } : { kind: 'data', absenceSafe: true };
    };
    const callbackOutput = ({ name = '', reduce = false, selected = false, stablePositions = false, terminal = -1, position = 0,
        possibleVisits = Infinity, accumulator = {}, effect = {}, valueReturnTarget = false } = {}) => {
        const { target: accumulated = false, localProofOnly: localAccumulator = false, packedTarget: packedAccumulator = false,
            nestedPackedTarget: nestedAccumulator = false, packedReturnTarget: returnedAccumulator = false,
            nestedReturnTarget: returnedNestedAccumulator = false } = accumulator;

        return (destination, packedReturn = false, depth = 0) => selectionSourceFor((path) => {
            const [{ minimum = 0, maximum = Infinity } = {}] = path;
            const { minimum: selectedFirst = 0, maximum: selectedLast = Infinity } = selected ? selected : {};

            if (maximum < selectedFirst || minimum > selectedLast) return [];

            const range = stablePositions ? { minimum, maximum } : { minimum: 0, maximum: Infinity };
            const { minimum: first = 0, maximum: last = Infinity } = range;
            const { packedResultTarget: outputElements = false } = destination;
            const consumer = reduce ? scalarResultUse(destination) : { kind: 'forward', target: outputElements &&
                selectSubjectFor(outputElements, first, last) };
            const final = !reduce || position === 0 || terminal < 0 || (minimum <= terminal && maximum >= terminal);
            const laterElement = name === 'reduce' ? minimum < terminal : maximum > terminal;
            const repeated = reduce && (position === 0 ? possibleVisits > 2 : terminal < 0 || laterElement);
            const { nestedResultTarget: outputNested = false } = destination;
            const flatten = { unnest: true, enclosed: { minimum: 0, maximum: Infinity } };
            const contents = (target, effectTarget, returned, resultDepth) => {
                if (!repeated) return final && target;

                const subject = Object.freeze({});
                const entries = [
                    effectTarget && { kind: 'forward', target: effectTarget, localProofOnly: localAccumulator, resultRole: 'discard' },
                    final && target && { kind: 'forward', target },
                    target && returned && { kind: 'forward', target: returned, localProofOnly: localAccumulator,
                        selectResult: true, resultRole: 'consumer', resultDepth, resultTarget: target }
                ];

                put(bySubject, subject, entries.filter(Boolean));

                return subject;
            };
            const mappedTarget = name === 'map' ? outputNested : outputElements;
            const mappedPlacement = name === 'map' ? { enclosed: range } : flatten;
            const firstResult = reduce ? contents(outputElements, packedAccumulator, returnedAccumulator, 1) : positionRelay(mappedTarget, mappedPlacement);
            const secondResult = reduce ? contents(outputNested, nestedAccumulator, returnedNestedAccumulator, 2)
                : name === 'flatMap' && positionRelay(outputNested, flatten);

            if (packedReturn) {
                const selectedResult = [firstResult, secondResult].at(depth);

                return selectedResult ? [{ ...effect, target: packedReturn, resultRole: 'consumer', resultTarget: selectedResult,
                    resultDepth: depth + 1, selectResult: true, unnest: true }] : [];
            }

            const resultTarget = Object.freeze({});
            const returned = reduce && repeated && Object.freeze({});

            if (returned) put(bySubject, returned, [consumer]);

            put(bySubject, resultTarget, [...final ? [consumer] : [], ...returned ? [{ ...effect, target: accumulated,
                selected: false, localProofOnly: localAccumulator, resultRole: 'consumer', resultTarget: returned }] : []]);

            const returnedValue = valueReturnTarget && (firstResult || secondResult) && { kind: 'forward', target: valueReturnTarget, selectResult: true,
                resultRole: 'consumer', resultTarget: firstResult, nestedResultTarget: secondResult, reposition: { minimum: 0, maximum: 0 } };

            return [{ ...effect, resultRole: 'consumer', resultTarget }, ...[returnedValue].filter(Boolean)];
        });
    };

    return { positionRelay, scalarResultUse, callbackOutput };
};

export const acquireArrayReceiver = ({ resultUseFor, resultFor, positionsSafe, traceCarrier, argumentsFor, arrayMethodFor, nativeArrays = true,
    subjectFor, transferFor, formalAt, callables = new Map(), callableResolutions = new WeakMap(), capabilities = {}, carrierFor, callbackOutput, scalarResultUse } = {}) => {
    if (typeof resultUseFor !== 'function' || typeof resultFor !== 'function' || typeof positionsSafe !== 'function' || typeof traceCarrier !== 'function' ||
        typeof argumentsFor !== 'function' || typeof arrayMethodFor !== 'function' || typeof subjectFor !== 'function' || typeof transferFor !== 'function' ||
        typeof formalAt !== 'function' || typeof carrierFor !== 'function' || typeof callbackOutput !== 'function' || typeof scalarResultUse !== 'function') {
        throw new TypeError('Expected acquired array receiver dependencies');
    }

    const traceCallbacks = (node, call, name, result) => {
        const args = argumentsFor(call);
        const { resultRole = '', packedResultTarget = false, nestedResultTarget = false } = result;
        const [callback = {}] = args;
        const { type: callbackType = '' } = callback;
        const reduce = ['reduce', 'reduceRight'].includes(name);
        const unseeded = reduce && args.length < 2;
        const { minimum: visits = 0, maximum: possibleVisits = Infinity, seed = -1, terminal = -1 } = transferFor(call);
        const sort = ['sort', 'toSorted'].includes(name);
        const positions = sort || unseeded ? [0, 1] : [Number(reduce)];
        const helper = callables.get(callableResolutions.get(callback)) || callback;
        const { observesArrayElements = () => false } = capabilities;
        const stablePositions = name === 'map' && observesArrayElements(helper);

        if (sort && !args.length) return;

        // A sole present element is the unseeded result; no callback runs.
        // Holes affect length but do not count as reduction visits.
        if (unseeded && visits <= 1 && possibleVisits >= 1) {
            traceCarrier(node, 1, scalarResultUse(result));
            [packedResultTarget, nestedResultTarget].forEach((target, depth) => {
                if (target) traceCarrier(node, depth + 2, { kind: 'forward', target, selected: { minimum: 0, maximum: Infinity }, unnest: true });
            });
            [1, 2].forEach((depth) => {
                traceCarrier(node, depth + 1, { kind: 'forward', target: carrierFor(call, depth, true),
                    selected: { minimum: 0, maximum: Infinity }, unnest: true }, true, true);
                traceCarrier(node, depth + 1, { kind: 'data', absenceSafe: true });
            });
        }

        if (reduce && possibleVisits <= Number(unseeded)) return;

        positions.forEach((position) => {
            const seedRange = { minimum: seed, maximum: seed };
            const elementRange = { minimum: name === 'reduce' ? seed + 1 : 0, maximum: name === 'reduce' ? Infinity : seed - 1 };
            const selected = unseeded && seed >= 0 && [seedRange, elementRange].at(position);
            const formal = callbackType === 'SpreadElement' ? {} : formalAt(callback, position);
            const { target = false, packedTarget = false, nestedPackedTarget = false, localProofOnly = false, defined = false, available = false,
                valueReturnTarget = false, packedReturnTarget = false, nestedReturnTarget = false } = formal;
            const effect = { kind: 'forward', target, localProofOnly, absenceSafe: true, unresolvedRequiresCallable: true,
                unresolvedValue: !defined || (available && !target), resultRole: 'discard', selected };

            traceCarrier(node, 1, effect);
            [packedTarget, nestedPackedTarget].forEach((target, depth) => {
                if (target) traceCarrier(node, depth + 2, { ...effect, target, selected: selected || { minimum: 0, maximum: Infinity }, unnest: true });
            });

            if (!['map', 'flatMap', 'reduce', 'reduceRight'].includes(name)) return;

            if (!reduce && resultRole === 'return') traceCarrier(node, 1, { ...effect, resultRole: 'return', uncertainPositions: !stablePositions }, true, true);

            const carriesPackedResult = valueReturnTarget || packedReturnTarget || nestedReturnTarget;

            if (!reduce && !packedResultTarget && !(resultRole === 'return' && carriesPackedResult)) return;

            const accumulator = reduce ? formalAt(callback, 0) : {};
            const output = callbackOutput({ name, reduce, selected, stablePositions, terminal, position, possibleVisits, accumulator, effect, valueReturnTarget });

            const transport = (destination, returning = false) => {
                traceCarrier(node, 1, { kind: 'forward', target: output(destination) }, true, returning);
                [packedReturnTarget, nestedReturnTarget].forEach((returned, depth) => {
                    if (returned) traceCarrier(node, depth + 2, { kind: 'forward', target: output(destination, returned, depth) }, true, returning);
                });
            };

            if (reduce || packedResultTarget) transport(result);

            if (resultRole === 'return' && carriesPackedResult) transport({
                packedResultTarget: carrierFor(call, 1, true),
                nestedResultTarget: carrierFor(call, 2, true)
            }, true);
        });
        const array = callbackType === 'SpreadElement' ? {} : formalAt(callback, reduce ? 3 : 2);
        const { packedTarget = false, nestedPackedTarget = false } = array;

        if (!sort) [packedTarget, nestedPackedTarget].forEach((target, depth) => {
            if (target) traceCarrier(node, depth + 1, { kind: 'forward', target, absenceSafe: true, resultRole: 'discard' });
        });
    };

    return (node) => {
        const { consumer: member = {}, value = node } = resultUseFor(node) ?? {};
        const { type = '', object = false, computed = false, property: key = {} } = member;

        if (type !== 'MemberExpression' || object !== value) return;

        const { name = '', known = false } = propertyName({ computed, key });
        const selected = known && positionsSafe(node) ? { minimum: Number(name), maximum: Number(name) } : { minimum: 0, maximum: Infinity };

        if (computed && (!known || /^(0|[1-9]\d*)$/u.test(name))) {
            const result = resultFor(member);
            const { packedResultTarget = false, nestedResultTarget = false } = result;

            traceCarrier(node, 1, { ...scalarResultUse(result), selected });
            [packedResultTarget, nestedResultTarget].forEach((target, depth) => {
                if (target) traceCarrier(node, depth + 2, { kind: 'forward', target, selected, unnest: true });
            });

            return;
        }

        const { consumer: call = {}, value: invoked = member } = resultUseFor(member) ?? {};
        const { type: use = '', callee = false } = call;

        if (use !== 'CallExpression' || callee !== invoked) return;

        const { replacement = false, stable = false } = arrayMethodFor(member);

        // Source replacements retain their acquired captured uses; this
        // receiver query does not invent native callback behavior for them.
        if (replacement) return;

        const knownMethod = arrayCallbacks.has(name) || arrayDataMethods.has(name);
        const modeled = nativeArrays && stable && knownMethod;

        // A known incompatible native operation fails on the array carrier,
        // independently of its elements. Its existing operation rule owns it.
        if (nativeArrays && stable && !knownMethod && nativeResultFamily.has(name)) return;

        // Unmodeled receiver calls retain the formal/result carrier's
        // obligation. General property storage keeps its existing owner.
        const { type: receiverType = '' } = node;

        if (!modeled && !subjectFor(node) && receiverType !== 'CallExpression') return;

        if (!modeled) {
            [1, 2, 3].forEach(depth => traceCarrier(node, depth, { kind: 'argument' }));

            return;
        }

        const result = resultFor(call);
        const { packedResultTarget = false, nestedResultTarget = false } = result;

        const { receiver: project = false } = transferFor(call);

        if (arrayResults.has(name)) [packedResultTarget, nestedResultTarget].forEach((target, depth) => {
            if (target) traceCarrier(node, depth + 1, { kind: 'forward', target: project ? project(target) : target, uncertainPositions: !project });
        });

        if (arrayResults.has(name)) [1, 2].forEach((depth) => {
            const target = carrierFor(call, depth, true);

            traceCarrier(node, depth, { kind: 'forward', target: project ? project(target) : target, uncertainPositions: !project }, true, true);
            traceCarrier(node, depth, { kind: 'data', absenceSafe: true });
        });

        if (['at', 'pop', 'shift', 'find', 'findLast'].includes(name)) {
            const { selected = { minimum: 0, maximum: Infinity } } = transferFor(call);

            traceCarrier(node, 1, { ...scalarResultUse(result), selected });
            [packedResultTarget, nestedResultTarget].forEach((target, depth) => {
                if (target) traceCarrier(node, depth + 2, { kind: 'forward', target, selected, unnest: true });
            });
        }

        if (arrayCallbacks.has(name)) traceCallbacks(node, call, name, result);
    };
};
