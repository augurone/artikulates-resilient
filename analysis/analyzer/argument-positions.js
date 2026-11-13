import { append, put } from '../collections.js';
import { traverse } from '../traversal.js';

const empty = Object.freeze({ minimum: 0, maximum: 0 });
const single = Object.freeze({ minimum: 1, maximum: 1 });
const unknown = Object.freeze({ minimum: 0, maximum: Infinity });
const add = ({ minimum = 0, maximum = 0 } = {}, { minimum: lower = 0, maximum: upper = 0 } = {}) => ({
    minimum: minimum + lower, maximum: maximum + upper
});
const spreadOf = ({ type = '', argument = false } = {}) => type === 'SpreadElement' && argument;
export const choicesOf = ({ type = '', consequent = false, alternate = false, left = false, right = false, expressions = [], expression = false } = {}) => {
    if (type === 'ConditionalExpression') return [consequent, alternate];

    if (type === 'LogicalExpression') return [left, right];

    if (type === 'SequenceExpression') return expressions.slice(-1);

    return type === 'ChainExpression' ? [expression] : [];
};
export const applyOperand = ({ call = false, minimum = Infinity, maximum = 0, apply = false } = {}, receiverFor) => {
    const { type = '', callee = {} } = call ? call : {};
    const { method = '', replacement = false } = type === 'CallExpression' ? receiverFor(callee) : {};

    return !apply && !replacement && method === 'apply' && minimum <= 1 && maximum >= 1;
};

// Bounds are relative to normal iteration with native array widths. Opaque
// iterable producers can contribute any number of positions.
export const acquireArgumentPositions = (parents, resultUseFor, nativeArrays, receiverFor) => {
    const widths = new WeakMap();
    const layouts = new WeakMap();
    const positions = new WeakMap();
    const argumentLists = new WeakMap();
    const argumentsFor = (node = {}) => {
        if (argumentLists.has(node)) return argumentLists.get(node);

        const { arguments: args = [] } = node;
        const values = [];

        args.forEach(argument => traverse(argument || {}, { enter: (current = {}) => {
            const spread = spreadOf(current);
            const { type = '', elements = [] } = spread ? spread : {};

            if (nativeArrays && type === 'ArrayExpression') return elements.map(element => element || {});

            append(values, current);

            return [];
        } }));

        return put(argumentLists, node, values);
    };
    const widthFor = (node) => {
        if (!nativeArrays) return unknown;

        traverse(node, { enter: (current) => {
            if (widths.has(current)) return [];

            const { type = '', elements = [] } = current;

            return type === 'ArrayExpression' ? elements.filter(Boolean).map(spreadOf).filter(Boolean) : choicesOf(current);
        }, leave: (current) => {
            if (widths.has(current)) return;

            const { type = '', elements = [] } = current;

            if (type === 'ArrayExpression') {
                put(widths, current, elements.reduce((width, element) => add(width, widths.get(spreadOf(element || {})) || single), empty));

                return;
            }

            const choices = choicesOf(current).map(choice => widths.get(choice) || unknown);
            const width = choices.reduce(({ minimum = Infinity, maximum = 0 } = {}, { minimum: lower = 0, maximum: upper = Infinity } = {}) => ({
                minimum: Math.min(minimum, lower), maximum: Math.max(maximum, upper)
            }), { minimum: Infinity, maximum: 0 });

            put(widths, current, choices.length ? width : unknown);
        } });

        return widths.get(node) || unknown;
    };
    const layoutFor = (node) => {
        if (layouts.has(node)) return layouts.get(node);

        const { type = '', arguments: args = [], expressions = args, elements = expressions } = node;
        const offsets = new WeakMap();
        const start = type === 'TemplateLiteral' ? single : empty;
        const { spread = false } = elements.reduce(({ offset = empty, spread: earlier = false } = {}, element) => {
            if (element) put(offsets, element, offset);

            const operand = element && spreadOf(element);

            return { offset: add(offset, operand ? widthFor(operand) : single), spread: earlier || Boolean(operand) };
        }, { offset: start, spread: false });

        return put(layouts, node, { offsets, spread });
    };
    const outerArguments = (node) => {
        const { consumer = {}, value = false, truthy = false } = resultUseFor(node) ?? {};
        const { type = '' } = consumer;

        if (!truthy) return [];

        return type === 'SpreadElement' ? [consumer] : [value].filter(Boolean);
    };

    const argumentFor = (node) => {
        traverse(node, { enter: (current) => {
            if (positions.has(current)) return [];

            const parent = parents.get(current) ?? {};
            const { type = '' } = parent;

            return type === 'ArrayExpression' ? outerArguments(parent) : [];
        }, leave: (current) => {
            if (positions.has(current)) return;

            const parent = parents.get(current) ?? {};
            const { type = '' } = parent;
            const tagged = type === 'TemplateLiteral' && parents.get(parent);
            const { type: tagType = '' } = tagged ? tagged : {};
            const direct = ['CallExpression', 'NewExpression'].includes(type) || tagType === 'TaggedTemplateExpression';
            const [outer = {}] = type === 'ArrayExpression' ? outerArguments(parent) : [];
            const { type: outerType = '' } = outer;
            const position = positions.get(outer);
            const selected = position ? position : {};
            const spreadInto = outerType === 'SpreadElement';
            const apply = !spreadInto && applyOperand(selected, receiverFor);
            const { call: outerCall = false, apply: inheritedApply = false, ...base } = selected;
            const call = direct ? tagged || parent : (spreadInto || apply) && outerCall;

            if (!call) {
                put(positions, current, false);

                return;
            }

            const { offsets = new WeakMap(), spread = false } = layoutFor(parent);
            const offset = offsets.get(current);

            put(positions, current, offset ? { ...add(spreadInto ? base : empty, direct || apply || nativeArrays ? offset : unknown),
                call, spread: spread || !direct, apply: apply || inheritedApply } : false);
        } });

        return positions.get(node);
    };

    return { argumentFor, argumentsFor, widthFor, elementFor: (node) => {
        const parent = parents.get(node) ?? {};
        const { offsets = new WeakMap() } = layoutFor(parent);

        return nativeArrays ? offsets.get(node) || unknown : unknown;
    } };
};
