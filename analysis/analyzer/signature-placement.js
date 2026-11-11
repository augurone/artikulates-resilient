import { append, put } from '../collections.js';
import { acquireInitializers } from './initializers.js';
import { locationOf, validRange } from './locations.js';
import { patternChildren, traverse } from './traversal.js';
import { notify } from './work.js';

const decision = (placement, reason, references, relocation = false, evidence = []) => Object.freeze({
    placement, reason, references, relocation, evidence: Object.freeze(evidence)
});

// Retained queries close over owned ranges and shared use summaries only.
const placementQueries = (entries, declarations) => {
    const results = new Map();
    const check = ({ index = -1, ...observation } = {}) => {
        if (!Number.isInteger(index) || index < 0 || index >= entries.length) throw new RangeError('Expected a signature extraction index in this analysis');

        if (results.has(index)) return results.get(index);

        const { placement = '', reason = '', references = [], relocation = false, leaves = [] } = entries.at(index);
        const complete = (result) => {
            notify(observation, 'signature-placement');

            return put(results, index, result);
        };

        if (placement) return complete(decision(placement, reason, references));

        const guarded = leaves.map(index => declarations.checkPresence({ index, ...observation })).filter(({ required = true } = {}) => !required);

        if (guarded.length) return complete(decision('body', 'guarded-provider', references, false, guarded));

        return complete(decision('signature', relocation ? 'entry-extraction' : 'manual-restructuring', references, relocation));
    };

    return { check, descriptors: Object.freeze(entries.map(({ descriptor = {} } = {}) => descriptor)) };
};

// Parameter use is source-owned. Existing lexical references are classified once;
// this is neither a caller-derived signature nor a second completion evaluator.
export const prepareSignaturePlacement = ({ index = {}, model = {}, declarations = {} } = {}) => {
    const { bindings: lexical = [], declarations: bindings = [], references = [], identities = new WeakMap(), parents = new WeakMap(), writes = new Set(),
        opaqueExecutions = new Set(), executionOf = new WeakMap(), callableResolutions = new WeakMap(), initializerNames = new Map(),
        functionEntries = [], ownFunctionCount = 0, initializerFacts = new WeakMap() } = index;
    const functions = new Map(functionEntries.slice(0, ownFunctionCount).map((entry) => {
        const { execution = false } = entry;

        return [execution, entry];
    }));
    const { capabilities: { subjects = new WeakMap() } = {} } = model;
    const parameters = new Map(lexical.flatMap((binding) => {
        const { execution = false, parameter: { index = -1 } = {} } = binding;
        const subject = subjects.get(binding);

        return index >= 0 && functions.has(execution) && subject ? [[subject, binding]] : [];
    }));
    const parameterFor = (binding) => {
        const { parameter: { index = -1 } = {} } = binding ?? {};

        return index >= 0 ? binding : parameters.get(subjects.get(binding));
    };
    const grouped = new Map();
    references.forEach(({ node = {}, parent = {}, execution = false, unsupported = false } = {}) => {
        const declared = identities.get(node);
        const binding = parameterFor(declared);
        const { execution: owner = false, parameter: { index: position = -1, origin = false } = {} } = binding ?? {};
        const { declaration: { node: declaration = false } = {} } = declared ?? {};

        if (position < 0 || !functions.has(owner) || node === origin || node === declaration) return;

        const { type = '', init = false, id = {}, object = false, computed = false } = parent;
        const { type: pattern = '' } = id ?? {};
        const { control = false, receiver = false, mutation = false } = model.contextFor(node);
        const member = type === 'MemberExpression' && object === node;
        const extraction = type === 'VariableDeclarator' && init === node && ['ObjectPattern', 'ArrayPattern'].includes(pattern);
        const alias = type === 'VariableDeclarator' && init === node && pattern === 'Identifier' && parameterFor(identities.get(id)) === binding;
        const unresolvedAlias = type === 'VariableDeclarator' && init === node && pattern === 'Identifier' && !alias;
        const kind = [unsupported && 'unsupported-reference', execution !== owner && 'capture', control && 'control', member && computed && 'dynamic', member && receiver && 'receiver',
            member && mutation && 'mutation', extraction && 'extraction', alias && 'alias', unresolvedAlias && 'unstable-alias', member && 'static-read', 'whole'].find(Boolean);
        const uses = grouped.get(binding) || put(grouped, binding, []);

        append(uses, Object.freeze({ kind, location: locationOf(node) }));
    });
    const summaries = new Map([...grouped].map(([binding = {}, uses = []] = []) => {
        const { kind: retained = '' } = uses.find(({ kind = '' } = {}) => ['capture', 'control', 'dynamic', 'receiver', 'mutation'].includes(kind)) ?? {};
        const { kind: uncertain = '' } = uses.find(({ kind = '' } = {}) => ['unstable-alias', 'unsupported-reference'].includes(kind)) ?? {};
        const wholeEnd = uses.reduce((end, { kind = '', location: { range: [, next = -1] = [] } = {} } = {}) => kind === 'whole' ? Math.max(end, next) : end, -1);

        return [binding, { references: Object.freeze(uses), retained, uncertain, wholeEnd,
            located: uses.every(({ location: { range = [] } = {} } = {}) => validRange(range)) }];
    }));
    const leaves = new WeakMap();

    bindings.forEach(({ node = {}, pattern = {} } = {}, index) => {
        const { type = '' } = node;

        if (type !== 'Identifier') return;

        const entries = leaves.get(pattern) || put(leaves, pattern, []);

        append(entries, index);
    });
    const candidates = bindings.filter(({ node = {}, pattern = {}, init = false } = {}) => {
        const { type = '' } = node;
        const { type: initialized = '' } = init ? init : {};
        const { type: parent = '' } = parents.get(node) ?? {};

        return node === pattern && type === 'ObjectPattern' && initialized === 'Identifier' && parent === 'VariableDeclarator';
    });
    const patterns = new WeakMap();
    const initializers = [];

    candidates.forEach(({ pattern = {}, execution = false } = {}) => {
        const hazards = [];
        const defaults = [];
        const captured = initializerNames.get(execution);

        traverse(pattern, { enter: (node) => {
            const { type = '', computed = false, right = false, name = '' } = node;

            if (type === 'Property' && computed) append(hazards, 'computed-pattern');

            if (type === 'Identifier' && writes.has(identities.get(node))) append(hazards, 'written-binding');

            if (type === 'Identifier' && captured && captured.has(name)) append(hazards, 'initializer-capture');

            if (type === 'AssignmentPattern') {
                append(initializers, { node: right });
                append(defaults, right);
            }

            return patternChildren(node);
        } });
        put(patterns, pattern, { hazards, defaults });
    });
    const inert = acquireInitializers({ initializers, identities, inert: initializerFacts });
    const entries = candidates.flatMap(({ pattern = {}, init = {} } = {}) => {
        const binding = parameterFor(identities.get(init));
        const { name = '', execution = false, parameter: { index: position = -1, origin = false } = {} } = binding ?? {};
        const owner = functions.get(execution);
        const declarator = parents.get(pattern) ?? {};
        const statement = parents.get(declarator) ?? {};

        if (!owner || position < 0 || !origin || executionOf.get(init) !== execution) return [];

        const { node = {}, body = {}, params = [], index: functionIndex = -1 } = owner;
        const { async = false, generator = false, type: functionType = '' } = node;
        const { body: statements = [] } = body;
        const { type: nextType = '', expression: { type: expressionType = '', value: nextValue = false } = {} } = statements.at(1) ?? {};
        const directive = nextType === 'ExpressionStatement' && expressionType === 'Literal' && typeof nextValue === 'string';
        const { kind = '', declarations: declared = [] } = statement;
        const { references = Object.freeze([]), retained = '', uncertain = '', wholeEnd = -1, located = false } = summaries.get(binding) ?? {};
        const { hazards = [], defaults = [] } = patterns.get(pattern) ?? {};
        const parameterLocation = locationOf(origin);
        const patternLocation = locationOf(pattern);
        const declarationLocation = locationOf(statement);
        const { range: [start = -1] = [] } = patternLocation;
        const nested = parents.get(statement) !== body;
        const unsupported = opaqueExecutions.has(execution) || async || generator;
        const unavailable = identities.get(init) !== binding && callableResolutions.get(init) !== identities.get(init);
        const unlocated = !located || ![parameterLocation, patternLocation, declarationLocation].every(({ range = [] } = {}) => validRange(range));
        const reason = [unsupported && 'unsupported-execution', unavailable && 'unavailable-alias', unlocated && 'unavailable-location', writes.has(binding) && 'written-parameter', retained,
            nested && 'conditional-extraction', wholeEnd > start && 'whole-value-after-extraction', hazards.includes('computed-pattern') && 'computed-pattern', uncertain].find(Boolean) || '';
        const unknown = ['unsupported-execution', 'unavailable-alias', 'unavailable-location', 'unstable-alias', 'unsupported-reference'].includes(reason);
        const relocatable = !reason && statements.at(0) === statement && !directive && declared.length === 1 && kind === 'const' && references.length === 1 && !hazards.length &&
            defaults.every(value => inert.get(value)) && params.slice(position + 1).every(({ type = '' } = {}) => type === 'Identifier');

        const retainedPlacement = unknown ? 'unknown' : 'body';

        return [{ placement: reason ? retainedPlacement : '', reason, references, leaves: leaves.get(pattern) || [],
            relocation: relocatable ? Object.freeze({ parameter: parameterLocation, pattern: patternLocation, declaration: declarationLocation,
                arrow: functionType === 'ArrowFunctionExpression', single: params.length === 1 }) : false,
            descriptor: { name, functionIndex, parameterIndex: position, location: patternLocation } }];
    }).map(({ descriptor = {}, ...entry } = {}, index) => ({ ...entry, descriptor: Object.freeze({ ...descriptor, index }) }));

    return { ...placementQueries(entries, declarations), counts: Object.freeze({ boundaryParameters: summaries.size,
        boundaryReferences: [...summaries.values()].reduce((total, { references = [] } = {}) => total + references.length, 0), signatureExtractions: entries.length }) };
};
