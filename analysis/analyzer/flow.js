import { put } from '../collections.js';
import { traverse } from '../traversal.js';
import { locationOf } from './locations.js';
import { unknownOwner } from './uncertainty.js';

export const sequenceFlow = (entries, own, empty) => entries.reduce((left, right) => left === empty ? right : own({ kind: 'sequence', left, right }), empty);

// Acquisition owns executable relationships. It does not guess expression
// success: expression and statement templates use the same outcome evaluator.
export const acquireFlow = ({ body = {}, expressionFor, patterns = {}, own, handlerFor = () => false, naturalInitializer = () => false,
    absence = false, nodes = new WeakMap(), prefixes = new WeakMap() } = {}) => {
    if (typeof expressionFor !== 'function' || typeof own !== 'function') throw new TypeError('Expected expression and statement acquisition capabilities');

    const empty = own({ kind: 'continue' });
    const read = node => node ? nodes.get(node) : empty;
    const sequence = (entries, points = []) => entries.reduce((left, right, index) => {
        const value = left === empty ? right : own({ kind: 'sequence', left, right });
        const point = points.at(index);

        if (point) put(prefixes, point, value);

        return value;
    }, empty);
    const children = ({ type = '', body: entries = [], consequent = false, alternate = false, block = false, handler = false, finalizer = false, declaration = false } = {}) => {
        if (['BlockStatement', 'Program'].includes(type)) return entries;

        if (type === 'ExportNamedDeclaration') return declaration ? [declaration] : [];

        if (type === 'IfStatement') return [consequent, alternate].filter(Boolean);

        if (['DoWhileStatement', 'WhileStatement', 'ForStatement', 'ForInStatement', 'ForOfStatement'].includes(type)) return [entries];

        if (type === 'TryStatement') return [block, handler, finalizer].filter(Boolean);

        if (type === 'CatchClause') return [entries];

        return [];
    };
    const compile = (node = {}) => {
        const { type = '', body: entries = [], argument = false, test = {}, consequent = false, alternate = false,
            expression = {}, declarations = [], block = false, handler = false, finalizer = false, declaration = false, label = false, param = {} } = node;
        const location = locationOf(node);

        if (['BlockStatement', 'Program'].includes(type)) return sequence(entries.map(read), entries);

        if (type === 'ExportNamedDeclaration') return read(declaration);

        if (type === 'ExportDefaultDeclaration') return own({ kind: 'effect', argument: expressionFor(declaration), location });

        if (type === 'IfStatement') return own({ kind: 'branch', test: expressionFor(test), yes: read(consequent), no: read(alternate), location });

        if (type === 'DoWhileStatement') return own({ kind: 'do', body: read(entries), test: expressionFor(test), location,
            owner: unknownOwner({ code: 'unsupported-statement', location }) });

        if (!label && ['BreakStatement', 'ContinueStatement'].includes(type)) return own({ kind: 'jump', continued: type === 'ContinueStatement', location });

        if (['ReturnStatement', 'ThrowStatement'].includes(type)) return own({ kind: type === 'ReturnStatement' ? 'return' : 'throw',
            argument: argument ? expressionFor(argument) : absence, location: locationOf(argument || node) });

        if (type === 'TryStatement') return own({ kind: 'try', block: read(block), handler: handler ? read(handler) : false,
            binding: handler && handlerFor(handler), finalizer: finalizer ? read(finalizer) : false, location, owner: unknownOwner({ code: 'opaque-catch', location }) });

        if (type === 'CatchClause') {
            const { type: binding = '' } = param ? param : {};

            return ['ObjectPattern', 'ArrayPattern'].includes(binding)
                ? own({ kind: 'unsupported', location, owner: unknownOwner({ code: 'opaque-catch', location }) }) : read(entries);
        }

        if (['EmptyStatement', 'DebuggerStatement', 'FunctionDeclaration', 'ImportDeclaration', 'ExportAllDeclaration'].includes(type)) return empty;

        if (type === 'ExpressionStatement') return own({ kind: 'effect', argument: expressionFor(expression), location });

        if (type === 'VariableDeclaration') return sequence(declarations.flatMap(({ id = {}, id: { type: pattern = '' } = {}, init = false } = {}) => {
            const omitted = !init && naturalInitializer(id);
            const effects = patterns.effectsFor(id);

            return [own({ kind: 'effect', argument: init ? expressionFor(init) : omitted || absence, initializes: Boolean(init || omitted),
                binding: pattern !== 'Identifier', objectPattern: !!effects.length, formalPattern: !!effects.length,
                nativePattern: patterns.inertArray(id), location }),
            ...effects.map(({ value = {}, object = false } = {}) => own({ kind: 'effect', argument: expressionFor(value), initializes: true,
                binding: object, objectPattern: object, formalPattern: object, location }))];
        }));

        return own({ kind: 'unsupported', location, owner: unknownOwner({ code: 'unsupported-statement', location }) });
    };
    const { type = '' } = body;

    if (!['BlockStatement', 'Program'].includes(type)) return own({ kind: 'return', argument: expressionFor(body), location: locationOf(body) });

    traverse(body, { enter: children, leave: node => put(nodes, node, compile(node)) });

    return read(body);
};
