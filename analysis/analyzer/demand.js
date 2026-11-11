import { createOwner, familyEvidence, producer, readFamily, readField, record, reference, replaceEvidence, unresolved } from 'eslint-plugin-resilient/agreement';

import { append, forget, put, retain, takeLast } from '../collections.js';
import { primitivePropertyName } from '../estree-properties.js';
import { operations } from '../operations.js';
import { traverse } from '../traversal.js';
import { createEnvironments } from './environments.js';
import { collectionMethods, nativePropertyFamily, nativeResultFamily, objectPrototypeMembers, objectTags, operationRequirements } from './native-members.js';
import { createOutcomes } from './outcomes.js';
import { createCopyRetirement, createRecordFields } from './record-fields.js';
import { createSettlements } from './settlements.js';
import { unknownOwner } from './uncertainty.js';
import { createValues, normalValue, typeofNames } from './values.js';
import { notify } from './work.js';

const indexOf = ({ index = -1 } = {}) => index;
const executionOf = ({ execution = false } = {}) => execution;
const keyOf = ({ key = '' } = {}) => key;
const normalOf = ({ normal = 0 } = {}) => normal;
const valueOf = ({ value = false } = {}) => value;
const kindOf = ({ kind = '' } = {}) => kind;
const statementOf = ({ statement = false } = {}) => statement;
const categoryOf = ({ statement = false, functionModel = false, kind = '' } = {}) => {
    if (functionModel) return 'function';

    if (kind === 'capability') return 'capability';

    return statement ? 'statement' : 'value';
};
const expressionOf = ({ expression = {} } = {}) => expression;
const effectsOf = ({ effects = 0 } = {}) => effects;
const uncertainOf = ({ uncertain = 0 } = {}) => uncertain;
const thrownOf = ({ thrown = 0 } = {}) => thrown;
const guardFamilies = Object.freeze(['string', 'number', 'boolean', 'function', 'array'].map(family => ({ family, test: family, tag: '' }))
    .concat([...objectTags].map(([tag = '', family = ''] = []) => ({ family, test: `tag:${tag}`, tag }))));
const inverted = value => value < 0 ? -1 : Number(!value);
const alternatives = ({ kind = '', operator = '', yes = false, no = false, left = false, right = false } = {}) => {
    if (kind !== 'logical') return { positive: yes, negative: no };

    return operator === '&&' ? { positive: right, negative: left } : { positive: left, negative: right };
};
const later = ({ execution = false, location: { range: [start = -1] = [] } = {} } = {},
    { execution: earlier = false, location: { range: [, end = -1] = [] } = {} } = {}) => execution === earlier && start >= 0 && end >= 0 && start >= end;
const task = (expression, context, gate = 1) => ({ expression, context, gate,
    point: `value:${indexOf(expression)}:${indexOf(context)}`,
    key: `${statementOf(expression) ? 'statement' : 'value'}:${indexOf(expression)}:${indexOf(context)}:${gate}` });
const functionTask = (model, context) => ({ model, context, gate: 1, key: `function:${indexOf(model)}:${indexOf(context)}` });
const conditionKey = (expression, context, kind) => `${kind}:${categoryOf(expression)}:${indexOf(expression)}:${indexOf(context)}`;

export const createDemand = ({ functions = [], root = {}, moduleRoots = [], decisions = {}, absence = {}, unknown = {}, invocationSources = new Map(),
    capabilityRegions = new Map(), capabilityPrefixes = new Map(),
    lexicalExecutions = new Set(), captureInputs = new WeakSet(), limit = Infinity } = {}) => {
    // Required decision functions are checked below before closure capture; no fallback can supply them.
    const { and, or, not } = decisions;

    if (typeof and !== 'function' || typeof or !== 'function' || typeof not !== 'function') throw new TypeError('Expected Boolean decision operations');

    const origins = new Map();
    const conditionInputs = new WeakMap();
    const valueOrigins = new WeakMap();
    const producerLocations = new WeakMap();
    const producerFor = (expression) => {
        const module = Reflect.get(expression, 'module') ?? '';
        const location = Reflect.get(expression, 'location') ?? {};

        return producerLocations.get(expression) || put(producerLocations, expression, Object.freeze({ module, location }));
    };
    const valueGate = (gate, options = {}) => decisions.project(gate, key => kindOf(origins.get(key)) !== 'completion', { ...options, key: 'value-conditions' });
    const invocationOrigins = new WeakMap();
    const invocationAt = (owner, context) => {
        const { boundary = -1, depth = 0 } = owner;
        const { boundary: selected = -1, depth: level = 0 } = context;

        if (boundary !== selected || depth <= level) return false;

        const cacheFor = current => invocationOrigins.get(current) || put(invocationOrigins, current, new WeakMap());

        traverse(owner, { enter: (current) => {
            const { origin: { caller = false } = {} } = current;

            return cacheFor(current).has(context) || !caller || caller === context ? [] : [caller];
        }, leave: (current) => {
            const { origin: { caller = false, invocation: called = false } = {} } = current;
            const cache = cacheFor(current);

            if (cache.has(context)) return;

            put(cache, context, caller === context ? called : caller && cacheFor(caller).get(context));
        } });

        return cacheFor(owner).get(context);
    };
    const precedes = ({ expression: origin = {}, context: owner = false } = {}, expression, context, completing = false) => {
        if (owner === context) return !later(origin, expression);

        if (!owner) return true;

        const invocation = invocationAt(owner, context);

        if (!invocation) return true;

        const { execution = false, location: { range: [start = -1, end = -1] = [] } = {} } = invocation;
        const position = completing ? end : start;

        return !later({ execution, location: { range: [position, position] } }, expression);
    };
    const ownerGate = (value, gate) => {
        const origin = valueOrigins.get(value);

        if (!origin) return gate;

        const { expression = {}, context = {} } = origin;

        return decisions.project(valueGate(gate), (key) => {
            return precedes(origins.get(key), expression, context);
        }, { key: `owner:${indexOf(expression)}:${indexOf(context)}`, local: true });
    };
    const valueModel = createValues({ unknown, decisions, limit }, valueGate, ownerGate);
    const { unknownValue = {} } = valueModel;
    const { owner: unknownSource = false } = unknownValue;
    const promiseValue = normalValue({ owner: unknownSource, promise: 'known', truth: 1, absence: 'present' });
    const absentValue = normalValue(absence);
    const outcomes = createOutcomes({ decisions, values: valueModel, absent: absentValue });
    const settlements = createSettlements({ values: valueModel, outcomes, decisions });
    const { empty = {}, continuation = {} } = outcomes;
    const values = new Map();
    const contexts = new Map();
    const invocationContexts = new Map();
    const invocations = new WeakMap();
    const completedInvocation = Symbol('completed invocation');
    const invocationContext = Symbol('invocation context');
    const generic = new Map();
    const capabilityContexts = new Map();
    const standalone = new Map();
    const regionContexts = new WeakMap();
    const authored = new Map();
    const proxies = new WeakMap();
    const expressionOwners = new WeakMap();
    const sources = new WeakMap([[unknownSource, unknownValue]]);
    const recordLayers = new WeakMap();
    const copiedSnapshots = new WeakMap();
    const fallbacks = new WeakMap();
    const summaries = new WeakMap();
    const invocationProofs = new Map();
    const callableRequirements = new Map();
    const valueConsumptions = new Map();
    const capabilityWrites = new Map();
    const syntaxGuards = new Map();
    const unsupportedGuards = new Set();
    const closureCreations = new Map();
    const captureProofs = new Map();
    const memberProofs = new Map();
    const modelContexts = new WeakMap();
    const localInvocations = new WeakMap();
    const memberQueries = new Map();
    const propertyKeys = new WeakMap();
    const promiseQueries = new Map();
    const valueSites = new WeakMap();
    const initializerValues = new WeakMap();
    const bindingFrames = new WeakSet();
    const caughtValues = new WeakMap();
    const environments = createEnvironments(lexicalExecutions);
    const { templateFor = false } = environments;

    if (typeof templateFor !== 'function') throw new TypeError('Expected the lexical template lookup');

    const valueOwners = new WeakMap();
    const settlementSources = new WeakMap();
    const nativeOwners = new Map();
    const nativeOwner = family => nativeOwners.get(family) || put(nativeOwners, family, createOwner({ evidence: familyEvidence({ name: family }) }));
    const emptyCopySource = createOwner({ evidence: record() });
    const recordSourceFor = (value, observation, selection) => {
        const { memberOwner = unknownSource, plain = false, borrowed = false, origin: { constant = false, inputs = [] } = {} } = valueModel.evidenceFor(value, selection);
        const { families = [], incomplete = true } = readFamily({ owner: memberOwner, ...observation });
        // These primitives have no own enumerable properties. Their absence
        // from a copy is known, not an unresolved overwriting writer.
        const empty = (!incomplete && !!families.length && families.every(name => ['number', 'boolean', 'nullish', 'bigint', 'symbol'].includes(name))) ||
            (constant && Reflect.get(constant, 'value') === '');

        return { source: empty ? emptyCopySource : memberOwner, plain: empty || plain, guarded: Boolean(inputs.length), borrowed, families, incomplete };
    };
    const executionModels = new Map([...functions, ...moduleRoots].map(model => [executionOf(model), model]));
    const moduleExecutions = new Set(moduleRoots.map(executionOf));
    const modules = new Map(moduleRoots.map((model) => {
        const { module = '' } = model;

        return [module, model];
    }));
    const ownerForValue = (value, observation) => {
        if (valueOwners.has(value)) return valueOwners.get(value);

        const { owner: source = false } = valueModel.evidenceFor(value, () => notify(observation, 'value-ownership'));
        const existing = sources.get(source);
        const owner = !existing || existing === value ? source : createOwner({ evidence: reference({ owner: source }) });

        put(sources, owner, value);

        return put(valueOwners, value, owner);
    };
    // A field copy retires nested ownership, not the copied value's identity,
    // truth, absence, or callable contract. Agreement supplies the projected
    // owner and its source; only this session can recover its execution facets.
    const copiedFieldValue = ({ owner = false, source = owner, projection = '' } = {}) => {
        const value = sources.get(source);

        if (!value) return sources.get(owner);

        const selected = projection === 'family' ? valueModel.retire(value) : value;

        if (source !== owner) put(sources, owner, selected);

        return selected;
    };
    const createContext = ({ model = false, arguments: args = false, transferred = [], defaults = false, origin = {}, bodyOnly = false } = {}) => {
        // An empty origin describes a root query. An invocation supplies its
        // caller and source point together; neither becomes a synthetic context.
        const { caller: { boundary = contexts.size, depth = -1 } = {} } = origin;

        const { lexical = false, orderedEntry = false } = model ? model : {};
        const { caller = false } = origin;
        const { entrySensitive: inherited = false } = caller ? caller : {};
        const { entrySensitive: captured = false } = lexical ? lexical : {};
        const template = templateFor(model);
        const context = Object.freeze({ index: contexts.size, model, lexical, arguments: args, transferred, defaults, origin, boundary, depth: depth + 1,
            bodyOnly, entrySensitive: orderedEntry || inherited || captured });

        if (template) retain(modelContexts.get(template) || put(modelContexts, template, new Set()), context);

        return context;
    };
    const contextFor = (execution, scope = generic) => {
        if (scope.has(execution)) return scope.get(execution);

        const context = createContext({ model: executionModels.get(execution) || (executionOf(root) === execution && root), bodyOnly: scope === capabilityContexts });

        put(contexts, `boundary:${contexts.size}`, context);

        return put(scope, execution, context);
    };
    const condition = (expression, context, kind, point = '', input = false) => {
        const name = conditionKey(expression, context, point ? `${kind}:${point}` : kind);
        const inputs = input && (conditionInputs.get(input) || put(conditionInputs, input, new Map()));
        const key = inputs ? inputs.get(name) || put(inputs, name, Symbol(name)) : name;
        const selected = decisions.variable(key);

        put(origins, decisions.variables.get(key), { expression, context, kind });

        return selected;
    };
    const revisionsFor = (capability, context, expression, visit) => {
        const entries = capabilityWrites.get(`${indexOf(capability)}:${indexOf(context)}`) || new Map();

        return [...entries].filter(([write = {}] = []) => {
            if (typeof visit === 'function') visit('capability-revision');

            return later(expression, write);
        });
    };
    const callableAt = (capability, context, expression, visit) => {
        const initial = condition(capability, context, 'callable');
        const { mutable = false } = capability;

        return mutable ? revisionsFor(capability, context, expression, visit).reduce((prior, [write = {}, reached = 0] = []) => (
            or(and(prior, not(reached)), and(reached, condition(write, context, 'callable')))
        ), initial) : initial;
    };
    const admittedAt = (capability, context, expression, visit) => {
        const { mutable = false } = capability;
        const entries = syntaxGuards.get(`${indexOf(capability)}:${indexOf(context)}`);

        if (!mutable) return entries || 0;

        return [...(entries || [])].reduce((prior, [tested = {}, gate = 0] = []) => {
            const invalidated = revisionsFor(capability, context, expression, visit)
                .filter(([write = {}] = []) => later(write, tested)).reduce((prior, [, reached = 0] = []) => or(prior, reached), 0);

            return or(prior, and(gate, not(invalidated)));
        }, 0);
    };
    const admitSyntax = ({ index = -1, mutable = false } = {}, context, expression, gate) => {
        const key = `${index}:${indexOf(context)}`;

        if (!mutable) return put(syntaxGuards, key, or(syntaxGuards.get(key) || 0, gate));

        const entries = syntaxGuards.get(key) || put(syntaxGuards, key, new Map());

        return put(entries, expression, or(entries.get(expression) || 0, gate));
    };
    const shapeTests = new Map();
    const shapeTestKey = ({ identity = false, identityContext = false } = {}) => identity && identityContext &&
        conditionKey(identity, identityContext, 'family:tag:Object');
    const shapeTestsFor = value => [...(shapeTests.get(shapeTestKey(value)) || new Map()).values()];
    const familyCondition = (value, family, context, acquire = false) => {
        const { identity = false, identityContext = false } = value;

        if (!identity) return false;

        const { capability = false } = identity;
        const callable = family === 'function' && capability;
        const subject = callable || identity;
        const kind = callable ? 'callable' : `family:${family}`;
        const origin = identityContext || context;

        const key = conditionKey(subject, origin, kind);
        const tested = acquire || decisions.variables.has(key) ? condition(subject, origin, kind) : false;

        if (acquire && family === 'tag:Object') {
            const inputs = shapeTests.get(key) || put(shapeTests, key, new Map());

            put(inputs, value, Object.freeze({ input: value, tested }));
        }

        return tested;
    };
    // A positive runtime test belongs to a selected use. Its decision is already
    // owned by the stable value identity; no mutable refinement registry or
    // caller-derived fact is installed on the producer.
    const refine = (value, context, gate, onVisit) => {
        if (!value || gate < 2) return value;

        const { identity = false } = value;

        if (!identity) return value;

        return guardFamilies.reduce((selected, { family = '', test = '', tag = '' } = {}) => {
            const tested = familyCondition(value, test, context);

            return tested && and(gate, tested) ? valueModel.refine(selected, family, nativeOwner(family), gate, tested, tag, onVisit) : selected;
        }, value);
    };
    const sourceValue = (expression, context) => {
        const { truth = -1, absence: missing = 'unknown', callable = false } = expression;
        const truthGate = truth >= 0 ? truth : condition(expression, context, 'truth');
        const nullishGate = missing === 'unknown' ? and(not(truthGate), condition(expression, context, 'nullish')) : Number(['null', 'undefined'].includes(missing));

        return normalValue({ ...expression, callable: callable && environments.close(callable, context), truthGate, nullishGate, producer: producerFor(expression) });
    };
    const truthValue = ({ truth = -1, truthGate = 0 } = {}) => normalValue({ owner: nativeOwner('boolean'), truth, truthGate,
        absence: 'present', promise: 'none' });
    const familyValue = (family, expression, context) => {
        const truth = family === 'array' || family === 'object' || family === 'function' || family === 'regexp' ? 1 : -1;
        const value = sourceValue({ ...expression, owner: nativeOwner(family), truth, absence: 'present', promise: 'none' }, context);
        const undefinedGate = family === 'nullish' ? condition(expression, context, 'undefined') : 0;

        return family === 'nullish' ? normalValue({ ...value, truth: 0, truthGate: 0, absence: 'unknown', nullishGate: 1,
            undefinedGate, nullGate: not(undefinedGate) }) : value;
    };
    const nativeLengthValue = ({ constant = false } = {}, expression, context, { slots = false, standardPrototype = false } = {}) => {
        const text = constant && Reflect.get(constant, 'value');
        const textLength = typeof text === 'string' ? text.length : false;
        const count = textLength === false && slots && standardPrototype ? slots.length : textLength;

        const exact = typeof count === 'number';

        return sourceValue({ ...expression, owner: nativeOwner('number'), constant: exact ? Object.freeze({ value: count }) : false,
            truth: exact ? Number(Boolean(count)) : -1, absence: 'present', promise: 'none' }, context);
    };
    const testedValue = (value, expression = {}, context, visit, input = false) => {
        const { capabilityTest = false } = expression;

        if (!value || !capabilityTest) return value;

        const { capability = false, positive = true, syntaxOnly = false, unsupported = false } = capabilityTest;

        if (!capability) return value;

        if (unsupported) {
            retain(unsupportedGuards, `${indexOf(capability)}:${indexOf(context)}`);

            return value;
        }

        if (syntaxOnly) {
            const { truthGate = 0 } = value;

            // A documented guard syntax can satisfy its local invocation policy.
            // It cannot equate an opaque predicate's result with a producer fact.
            admitSyntax(capability, context, expression, truthGate);

            return value;
        }

        const callable = callableAt(capability, context, expression, visit);
        // Keep known inputs and absence correlated with the predicate result.
        // Only unresolved contributions use this invocation's callable gate;
        // a generic gate alone would reopen known false optional-method paths.
        const matched = input ? valueModel.typeGate(input, 'function', callable, visit) : callable;

        return normalValue({ ...value, truthGate: positive ? matched : not(matched) });
    };
    const evaluate = (root, observation = {}) => {
        const pending = [root];
        const active = new Set();
        const entered = new Set();
        const stages = new Map();
        const work = new Map([['steps', 0]]);
        const tick = (kind) => {
            const count = work.get('steps') + 1;

            if (count > limit) throw new RangeError('Analysis demand limit exceeded');

            put(work, 'steps', count);

            notify(observation, kind);
        };
        const selection = () => tick('value-selection');
        const consumeCallable = (value, expression, context, gate, direct = true) => {
            const identityCases = valueModel.casesFor(value, 'origin', selection);

            identityCases.forEach(({ origin = {}, gate: selected = 0 } = {}) => {
                const { identity: { capability = false } = {}, identityContext = false } = origin;
                const { invocation = false } = expression;
                const { absenceQuestion = false } = capability ? capability : {};
                const { model = false } = identityContext ? identityContext : {};

                if (!absenceQuestion || !identityContext || generic.get(executionOf(model || {})) !== identityContext ||
                    (direct && invocation === capability)) return;

                const reach = and(gate, selected);

                if (!reach) return;

                const local = direct && invocation && decisions.variables.has(conditionKey(invocation, context, 'callable'))
                    ? callableAt(invocation, context, expression, tick) : 0;
                const result = familyCondition(value, 'function', context) || 0;
                const callable = or(or(familyCondition(origin, 'function', context) || 0, local), result);
                const key = `${indexOf(capability)}:${indexOf(identityContext)}`;
                const entries = valueConsumptions.get(key) || put(valueConsumptions, key, new Map());
                const use = `${indexOf(expression)}:${indexOf(context)}`;
                const guarded = !and(reach, not(callable));

                put(entries, use, (entries.get(use) ?? true) && guarded);
                tick('value-consumption');
            });
        };
        const projection = () => tick('flow-projection');
        const selectTask = (expression, context, gate = 1) => {
            // Completion forgetting is shared across expressions. Only the
            // remaining value conditions depend on the selected source origin.
            const selected = statementOf(expression) ? gate : decisions.project(valueGate(gate, { onVisit: projection }), (key) => {
                return precedes(origins.get(key), expression, context, true);
            }, { key: `expression:${indexOf(expression)}:${indexOf(context)}`, onVisit: projection, local: true });

            return { ...task(expression, context, selected), requested: gate };
        };
        // Read restores the requested reach after evaluating a shared task.
        // A following task selected under its predecessor can use follow.
        const read = (selected) => {
            const { gate = 1, requested = gate } = selected;
            const entry = values.get(keyOf(selected));

            return requested === gate ? entry : outcomes.restrict(entry, requested, selection);
        };
        const need = selected => values.has(keyOf(selected)) ? [] : [selected];
        const opaque = (expression, context, value = false, { input = false, point = '', kind = input ? 'settlement' : 'completion' } = {}) => {
            // An adopted input's outcome remains a value choice in settlement
            // records. It is not a transient execution condition to project out.
            const normal = condition(expression, context, kind, point, input);

            return outcomes.outcome({ normal, thrown: not(normal), uncertain: not(normal), effects: 1,
                value: testedValue(value || sourceValue({ ...unknown, ...expression }, context), expression, context, tick) });
        };
        const unsupported = (expression, context, normal = 0) => outcomes.outcome({ normal, returned: 1, thrown: 1, uncertain: 1, effects: 1, unresolved: true,
            result: sourceValue({ ...unknown, ...expression }, context) });
        const resolve = (value, expression, context, gate = 1, adopt = false) => settlements.resolve(valueModel.restrict(value, gate, selection),
            `${categoryOf(expression)}:${indexOf(expression)}:${indexOf(context)}`, (input, point = '') => {
                const { location = {} } = expression;
                const owner = settlementSources.get(expression) || put(settlementSources, expression, unknownOwner({ code: 'unresolved-settlement', location }));

                return opaque({ ...expression, owner }, context, false, { input, point });
            }, observation, { adopt });
        const promised = (settlement, expression, context, { invocation = false, borrowed = false, protocolUnknown = false } = {}) => {
            const { normal = 0, thrown = 0, uncertain = 0, value: fulfilled = false, error = false, effects = 0, calls = false } = settlement;
            const projection = `promise:${indexOf(expression)}:${indexOf(context)}`;
            const settlementGate = gate => invocation ? decisions.project(valueGate(gate), (key) => {
                const { context: owner = false, kind = '' } = origins.get(key) ?? {};

                return kind !== 'settlement' || !owner || invocationAt(owner, context) !== expression;
            }, { key: projection, local: true }) : valueGate(gate);
            // A native promise settles once. Inner execution conditions can be
            // forgotten or re-evaluated by later queries, but every observer of
            // this invocation must select the same fulfillment/rejection side.
            // Reuse an already exclusive value choice through forwarding.
            const competing = normal && thrown && and(settlementGate(normal), settlementGate(thrown));
            const choice = competing ? condition(expression, context, 'settlement') : 1;
            const projected = value => valueModel.projectConditions(value, settlementGate, projection, selection);
            const selected = competing ? outcomes.outcome({ ...settlement, normal: and(settlementGate(normal), choice), thrown: and(settlementGate(thrown), not(choice)),
                uncertain: and(settlementGate(uncertain), not(choice)), value: valueModel.restrict(projected(fulfilled), choice, selection),
                error: valueModel.restrict(projected(error), not(choice), selection) }) : settlement;
            const { thrown: rejected = 0 } = selected;
            const value = normalValue({ ...promiseValue, promiseIdentity: projection, promiseOrigin: Object.freeze({ expression, context }),
                producer: producerFor(expression), suspensionSafe: true, borrowed, protocolUnknown,
                settlement: outcomes.outcome({ ...selected,
                    rejections: thrown && Object.freeze({ source: projection, gate: rejected }),
                    returns: false, sites: false, calls: false }) });

            return outcomes.outcome({ value, normal: 1, effects, calls });
        };
        // Native promise identity includes its settlement, even when the
        // payload is opaque. Every adopter shares this caller-created result.
        // Creation is keyed by invocation, not the guard of a consuming query.
        const unknownPromise = (expression, context) => promised(opaque(expression, context, false, { kind: 'settlement' }), expression, context);
        const then = (first, next) => {
            const waiting = need(first);

            return waiting.length ? { dependencies: waiting } : next(read(first));
        };
        const functionStep = ({ model = {}, context = {}, key = '' } = {}) => {
            const { supported = false, capabilitySupported = false, flow = {}, initialization = false, parameterInitialization = [],
                bodyLocation = {}, promiseResult = false, imports = [], entry: entryFlow = false, orderedEntry = false } = model;
            const { bodyOnly = false, arguments: inputs = false } = context;

            if (!supported && !(bodyOnly && capabilitySupported)) return { value: outcomes.invoked(unsupported(model, context), bodyLocation, selection) };

            if (orderedEntry && !bodyOnly) retain(bindingFrames, context);

            if (!entered.has(key)) {
                retain(active, templateFor(model));
                retain(entered, key);
                tick('function-context');
            }

            const dependencies = imports.filter(dependency => !active.has(dependency)).map(dependency => functionTask(dependency, contextFor(executionOf(dependency))));
            const missing = dependencies.flatMap(need);

            if (missing.length) return { dependencies: missing };

            const imported = dependencies.map(read).reduce((left, right) => outcomes.sequence(left, right, selection), continuation);
            const cyclic = imports.some(dependency => active.has(dependency));
            const entryTask = entryFlow && !bodyOnly && task(entryFlow, context, normalOf(imported));
            const entryWaiting = entryTask ? need(entryTask) : [];

            if (entryWaiting.length) return { dependencies: entryWaiting };

            const entry = entryTask ? outcomes.sequence(imported, read(entryTask), selection) : imported;
            const body = task(flow, context, normalOf(entry));
            const waiting = need(body);

            if (waiting.length) return { dependencies: waiting };

            const { unresolved = false } = entry;
            const completedBody = read(body);
            const { unresolved: incomplete = false } = completedBody;
            const initialized = imports.length || entryTask ? outcomes.outcome({ ...outcomes.sequence(entry, completedBody, selection),
                unresolved: cyclic || unresolved || incomplete }) : completedBody;
            const inertInitialization = orderedEntry || inputs && parameterInitialization.length && parameterInitialization.every(({ inert = false, kind = '', fallback = '' } = {}, index) => {
                if (entryFlow && kind === 'Identifier') return true;

                if (!inert) return false;

                if (!['ObjectPattern', 'ArrayPattern'].includes(kind)) return true;

                const input = inputs.at(index) || absentValue;
                const { absence = 'unknown' } = input;
                const { plain = false, standardPrototype = false, slots = false } = valueModel.evidenceFor(input, selection);

                if (absence === 'undefined') return fallback === (kind === 'ObjectPattern' ? 'ObjectExpression' : 'ArrayExpression');

                return kind === 'ObjectPattern' ? plain : Boolean(standardPrototype && slots);
            });
            const completed = initialization && !inertInitialization ? outcomes.sequence(opaque(model, context, absentValue), initialized, selection) : initialized;

            forget(active, templateFor(model));

            const invocation = outcomes.invoked(completed, bodyLocation, selection);
            const invoked = shapeTests.size ? outcomes.outcome({ ...invocation,
                value: valueModel.normalizeShape(valueOf(invocation), shapeTestsFor, selection) }) : invocation;
            const { returns = false } = invoked;
            const result = promiseResult ? outcomes.sequence(invoked, resolve(valueOf(invoked), model, context, 1, true), selection) : invoked;
            const sites = promiseResult ? outcomes.mapReturns(returns, value => valueOf(resolve(value, model, context, 1, true)), projection) : returns;

            return { value: outcomes.outcome({ ...result, returns: sites }) };
        };
        const sourceStep = ({ expression = {}, context = {}, gate = 1 } = {}) => {
            const value = sourceValue(expression, context);

            const { inert = false, closure = false } = expression;

            if (closure) {
                const key = `${indexOf(closure)}:${indexOf(context)}`;

                put(closureCreations, key, or(closureCreations.get(key) || 0, gate));
                tick('closure-creation');
            }

            return { value: inert ? outcomes.complete(value) : opaque(expression, context, value) };
        };
        const arrayValue = (slots, standardPrototype) => normalValue({ owner: nativeOwner('array'), slots, standardPrototype,
            nativeTag: standardPrototype ? 'Array' : '', promise: 'none', truth: 1, absence: 'present' });
        const parameterStep = ({ expression = {}, context = {} } = {}) => {
            const { position = -1, fallback = false, rest = false } = expression;
            const { arguments: inputs = false, defaults = false } = context;

            if (rest) return { value: outcomes.complete(arrayValue(inputs ? Object.freeze(inputs.slice(position)) : false, true)) };

            if (!inputs && defaults && fallback) return then(selectTask(fallback, context), value => ({ value }));

            // A generic formal owns an identity, never a caller's value family.
            if (!inputs) return { value: outcomes.complete(sourceValue({ ...unknown, ...expression, identity: expression, identityContext: context }, context)) };

            const input = inputs.at(position) || absentValue;

            if (!fallback) return { value: outcomes.complete(input) };

            const { value: supplied = false, omittedGate = 0 } = valueModel.project(input, 'defined', selection);

            if (!omittedGate) return { value: outcomes.complete(input) };

            return then(selectTask(fallback, context, omittedGate), replacement => ({
                value: outcomes.join(supplied ? outcomes.complete(supplied) : empty, replacement)
            }));
        };
        const parameterEntryStep = ({ expression: { target = {} } = {}, context = {}, gate = 1 } = {}) => {
            const { arguments: inputs = false, defaults = false } = context;
            const { fallback = false } = target;

            return then(selectTask(target, context, gate), (entry) => {
                if (inputs || defaults || !fallback) return { value: entry };

                const input = valueOf(entry);
                const { value: supplied = false, omittedGate = 0 } = valueModel.project(input, 'defined', selection);

                if (!omittedGate) return { value: entry };

                return then(selectTask(fallback, context, omittedGate), replacement => ({
                    value: outcomes.join(supplied ? outcomes.complete(supplied) : empty, replacement)
                }));
            });
        };
        const { fieldValue, fieldFrom } = createRecordFields({ valueModel, decisions, recordLayers, absentValue, unknown, observation },
            sourceValue, copiedFieldValue, condition, selection);

        if (typeof fieldValue !== 'function' || typeof fieldFrom !== 'function') throw new TypeError('Expected shared field selection');

        const retireCopiedFields = createCopyRetirement({ valueModel, recordLayers, cache: copiedSnapshots }, selection);
        const lifetimeGate = (value, mode) => and(valueModel.typeGate(value, '', 0, selection, mode),
            not(valueModel.typeGate(value, 'unsafe', 0, selection, mode)));

        const keyCases = (value) => {
            if (value && propertyKeys.has(value)) return propertyKeys.get(value);

            const { constant = false, absence = 'unknown', reach = 0 } = value;
            const { known: scalarKnown = false, name: scalarName = '' } = constant ? primitivePropertyName(Reflect.get(constant, 'value'))
                : { known: absence === 'undefined', name: 'undefined' };

            if (value && scalarKnown) return put(propertyKeys, value, Object.freeze([
                { known: true, name: scalarName, gate: reach }, { known: false, gate: not(reach) }
            ]));

            const constants = valueModel.casesFor(value, 'constant', selection).map(({ constant = false, gate = 0 } = {}) => ({
                ...primitivePropertyName(Reflect.get(constant, 'value')), gate
            }));
            const absent = valueModel.casesFor(value, 'absence', selection).filter(({ absence = '' } = {}) => absence === 'undefined')
                .map(({ gate = 0 } = {}) => ({ known: true, name: 'undefined', gate }));
            const names = new Map();

            [...constants, ...absent].filter(({ known = false } = {}) => known).forEach(({ name = '', gate = 0 } = {}) => {
                put(names, name, or(names.get(name) || 0, gate));
            });
            const known = [...names].map(([name = '', gate = 0] = []) => ({ known: true, name, gate }));
            const covered = known.reduce((result, { gate = 0 } = {}) => or(result, gate), 0);
            const entries = Object.freeze([...known, { known: false, gate: not(covered) }]);

            return value ? put(propertyKeys, value, entries) : entries;
        };
        const withPropertyKey = ({ expression = {}, context = {}, gate = 1 } = {}, prefix, consume) => {
            const { propertyKey = false } = expression;

            if (!propertyKey) return consume(expression, prefix);

            return then(selectTask(propertyKey, context, and(gate, normalOf(prefix))), (entry) => {
                const started = outcomes.outcome({ ...outcomes.follow(prefix, entry), value: valueOf(prefix) });

                if (!normalOf(started)) return { value: started };

                const plans = keyCases(valueOf(entry)).filter(({ gate = 0 } = {}) => and(gate, normalOf(started)))
                    .map(({ gate = 0, ...key } = {}) => consume({ ...expression, ...key, propertyKey: false },
                        outcomes.restrict(started, gate, selection)));
                const waiting = plans.flatMap(({ dependencies = [] } = {}) => dependencies);

                return waiting.length ? { dependencies: waiting } : { value: plans.reduce((result, { value = empty } = {}) => outcomes.join(result, value), empty) };
            });
        };
        const selectionStep = (current = {}) => {
            const { expression = {}, context = {}, gate = 1 } = current;
            const { target = {}, slot = -1, fallback = false, formal = false } = expression;
            const { defaults = false } = context;

            return then(selectTask(target, context, gate), (entry) => {
                if (!normalOf(entry)) return { value: entry };

                return withPropertyKey(current, entry, (expression, entry) => {
                    const { known = true } = expression;

                    if (!known) return { value: outcomes.sequence(entry, opaque(expression, context), selection) };

                    const { memberOwner: owner = false } = valueModel.evidenceFor(valueOf(entry), selection);
                    const { families = [], incomplete = false } = readFamily({ owner, ...observation });

                    if (!incomplete && families.length === 1 && families.at(0) === 'nullish') return { value: outcomes.thrown(entry) };

                    const { cases = [], value: selected = false } = slot < 0 ? fieldFrom(valueOf(entry), expression, context)
                        : { value: valueModel.selectSlot(valueOf(entry), slot, absentValue, () => sourceValue({ ...unknown, ...expression }, context), selection) };
                    const { value: supplied = false, omittedGate = 0 } = valueModel.project(selected, 'defined', selection);

                    const absentPath = formal && defaults && incomplete && !families.length && cases.every(({ state = '' } = {}) => state === 'unknown');

                    if (!fallback || (!omittedGate && !absentPath)) return { value: outcomes.sequence(entry, outcomes.complete(selected), selection) };

                    const omitted = absentPath ? gate : and(gate, omittedGate);

                    return then(selectTask(fallback, context, omitted), replacement => ({ value: outcomes.sequence(entry,
                        absentPath ? replacement : outcomes.join(supplied ? outcomes.complete(supplied) : empty, replacement), selection) }));
                });
            });
        };
        const initializedValue = (expression, context, gate) => {
            const { target = false, execution = false, immutable = false } = expression;
            const { model = false } = context;
            const foreign = model && execution !== executionOf(model);
            const owner = foreign ? environments.contextFor(context, execution) : context;
            const initialized = initializerValues.get(target);
            const snapshot = initialized && owner && initialized.get(owner);
            const { value: retained = false, reach = 0 } = snapshot ?? {};
            const unresolved = () => sourceValue({ ...unknown, ...expression }, context);

            // A later guard selects the stored result. It cannot execute its
            // initializer again with newly restricted argument records.
            if (retained) {
                const missing = and(gate, not(reach));

                return missing ? valueModel.joined([retained, valueModel.restrict(unresolved(), missing, selection)]) : retained;
            }

            const frame = model && keyOf(functionTask(model, context));
            const executing = frame && (entered.has(frame) || values.has(frame));

            return (foreign && owner) || (!immutable && (foreign || executing)) ? unresolved() : false;
        };
        const linkStep = ({ expression = {}, context = {}, gate = 1 } = {}) => {
            const { target = false, transfer = false } = expression;
            const retained = initializedValue(expression, context, gate);
            const complete = (value = unknownValue) => ({ value: outcomes.complete(transfer ? valueModel.escape(value, selection, { protocol: true }) : value) });

            if (retained) return complete(retained);

            return then(selectTask(target, context, gate), entry => complete(valueOf(entry) || unknownValue));
        };
        const useStep = ({ expression = {}, context = {}, gate = 1 } = {}) => {
            const { target = {}, transfer = false, initialized = false, entryBound = false } = expression;
            const retained = initialized && initializedValue(expression, context, gate);
            const complete = entry => ({ value: transfer ? outcomes.outcome({ ...entry, value: valueModel.escape(valueOf(entry), selection) }) : entry });

            if (retained) return complete(outcomes.complete(retained));

            if (entryBound) return complete(outcomes.complete(sourceValue({ ...unknown, ...expression }, context)));

            return then(selectTask(target, context, gate), complete);
        };
        const sequenceStep = ({ expression: { left = {}, right = {} } = {}, context = {}, gate = 1 } = {}) => then(selectTask(left, context, gate), (initial) => {
            if (!normalOf(initial)) return { value: initial };

            return then(selectTask(right, context, and(gate, normalOf(initial))), following => ({ value: outcomes.follow(initial, following) }));
        });
        const branchStep = ({ expression = {}, context = {}, gate = 1 } = {}) => {
            const { kind = '', test = false, left = false, operator = '', yesLocation = {}, noLocation = {} } = expression;
            const tested = test || left;

            return then(selectTask(tested, context, gate), (initial) => {
                if (!normalOf(initial)) return { value: initial };

                const { value = {} } = initial;
                const { truthGate = 0, nullishGate = 0 } = value;
                const choice = operator === '??' ? not(nullishGate) : truthGate;
                const { positive = false, negative = false } = alternatives(expression);

                const atSite = (entry, { kind: selectedKind = '', operator: selectedOperator = '' } = {}, location) => (
                    kind === 'conditional' ? outcomes.located(entry, [{ location, operator: selectedKind === 'logical' ? selectedOperator : '' }]) : entry
                );

                if (positive === negative) return then(selectTask(positive, context, normalOf(initial)), entry => ({
                    value: outcomes.follow(initial, kind === 'conditional' ? outcomes.located(entry, [
                        { location: yesLocation, gate: choice }, { location: noLocation, gate: not(choice) }
                    ]) : entry)
                }));

                const choices = [
                    { expression: positive, gate: and(normalOf(initial), choice), mode: operator === '??' ? 'present' : 'truthy', location: yesLocation },
                    { expression: negative, gate: and(normalOf(initial), not(choice)), mode: 'falsey', location: noLocation }
                ].filter(({ gate: selected = 0 } = {}) => selected);
                const tasks = choices.map(({ expression: selected = {}, gate: selectedGate = 1 } = {}) => selectTask(selected, context, selectedGate));
                const waiting = tasks.filter(selected => !values.has(keyOf(selected)));

                if (waiting.length) return { dependencies: waiting };

                const branches = choices.map(({ expression: selected = {}, gate: selectedGate = 1, mode = '', location = {} } = {}, index) => {
                    if (kind !== 'logical' || selected !== left) return atSite(read(tasks.at(index)), selected, location);

                    const { value: projected = false } = valueModel.project(value, mode, selection, selectedGate);

                    // Value projection forgets completion conditions. Keep the
                    // selected branch's full reach on the completed expression.
                    return outcomes.restrict(outcomes.complete(projected), selectedGate, selection);
                });
                const combined = branches.reduce((left, right) => outcomes.join(left, right), empty);
                const normalized = shapeTests.size ? outcomes.outcome({ ...combined,
                    value: valueModel.normalizeShape(valueOf(combined), shapeTestsFor, selection) }) : combined;

                return { value: outcomes.follow(initial, kind === 'logical' ? outcomes.outcome({ ...normalized, sites: false }) : normalized) };
            });
        };
        const promiseConstruction = (value, expression, context) => {
            const { owner = false } = valueModel.evidenceFor(value, selection);
            const { families = [], incomplete = false } = readFamily({ owner, ...observation });

            if (!incomplete && families.length && !families.includes('function')) return outcomes.thrown(continuation);

            const pending = unknownPromise(expression, context);

            return !incomplete && families.length && families.every(family => family === 'function')
                ? pending : opaque(expression, context, valueOf(pending));
        };
        const invokeStep = ({ expression = {}, context = {}, gate = 1, key = '', point = '', site = '' } = {}, { prefix = {}, arguments: inputs = [] } = {}) => {
            const { function: template = {}, kind = '', execute: allowed = true, guardInputEffects = false,
                argumentFresh = [], argumentStable = [], argumentTransfer = [], argumentMetadata = [], module: callerModule = '', lookup = false } = expression;
            const callee = kind === 'call' ? environments.close(template, context) : template;
            const { functionModel = false, module: calleeModule = '' } = callee;
            const dependency = functionModel && callerModule !== calleeModule && modules.get(calleeModule);
            const initializing = dependency && active.has(dependency);
            // A source signature survives an unavailable import route. Only
            // result execution needs the acquired callable at that route.
            const acquired = kind === 'call' && lookup;
            const initialization = dependency && !initializing && functionTask(dependency, contextFor(executionOf(dependency)));
            const acquisition = acquired && selectTask(lookup, context);
            const waiting = [...(initialization ? need(initialization) : []), ...(acquisition ? need(acquisition) : [])];

            if (waiting.length) return { dependencies: waiting };

            const available = initialization ? read(initialization) : continuation;
            const { unresolved = false } = available;
            const selected = acquisition ? read(acquisition) : available;
            const { unresolved: uninitialized = false } = selected;
            const identities = acquired ? valueModel.casesFor(valueOf(selected), 'callable', selection) : [];
            const resolved = identities.length && identities.every(({ callable = false } = {}) => callable && templateFor(callable) === templateFor(callee));
            const resultReady = !acquired || (resolved && !uninitialized && Boolean(normalOf(selected)));
            const affectedInputs = guardInputEffects && effectsOf(prefix);
            const execute = allowed && !initializing && !unresolved && Boolean(normalOf(available));
            const { promiseResult = false, intrinsicPromise = false } = callee;
            const { signature = false, localReader = 0 } = callee;
            const recursive = active.has(templateFor(callee));

            if (signature && localReader && execute && resultReady && !recursive) {
                const callers = localInvocations.get(templateFor(callee)) || put(localInvocations, templateFor(callee), new WeakMap());
                const sites = callers.get(context) || put(callers, context, new Map());
                const reached = and(gate, normalOf(prefix));

                put(sites, expression, or(sites.get(expression) || 0, reached));
            }

            // Captured formals may become initialized between source occurrences.
            // Keep occurrence reuse while withholding completed pure-call reuse
            // for frames whose execution depends on that entry environment.
            const { entrySensitive = false } = context;
            const reusable = !entrySensitive && !affectedInputs && !promiseResult && signature && execute && resultReady && !recursive;
            const previous = reusable && inputs.reduce((entries, value) => entries && entries.get(value), invocations.get(callee));
            const completed = previous && previous.get(completedInvocation);
            const occurrence = !completed && signature && execute && !recursive && `${point || key}:${normalOf(prefix)}:${effectsOf(prefix)}`;
            // Path conditions can request the same source invocation twice.
            // Equal input records at that occurrence share its execution;
            // separate calls and collection iterations retain distinct points.
            const targets = occurrence && (invocationContexts.get(occurrence) || put(invocationContexts, occurrence, new Map()));
            const local = targets && inputs.reduce((entries, value) => entries.get(value) || put(entries, value, new Map()),
                targets.get(callee) || put(targets, callee, new Map()));
            const shared = (local && local.get(invocationContext)) || completed;

            if (shared && !contexts.has(key)) put(contexts, key, shared);

            if (signature && execute && !recursive && !contexts.has(key)) put(contexts, key, createContext({
                model: callee, transferred: promiseResult ? [] : argumentTransfer, arguments: Object.freeze(inputs.map((value, index) => {
                    // A fresh container is not exposed by another argument, but
                    // its shared children may have been changed by that effect.
                    if (affectedInputs) return argumentFresh.at(index) ? retireCopiedFields(value) : valueModel.retire(value, { protocol: true });

                    if (argumentFresh.at(index)) return value;

                    const { borrowed = false } = valueModel.evidenceFor(value, selection);

                    if (argumentTransfer.at(index) && !borrowed) return value;

                    if (promiseResult && argumentStable.at(index) && !borrowed) return value;

                    return promiseResult ? valueModel.retire(value) : valueModel.borrowWithin(value,
                        { ...argumentMetadata.at(index), module: callerModule }, selection, observation);
                })),
                origin: Object.freeze({ caller: context, invocation: expression })
            }));

            if (local && !local.has(invocationContext)) put(local, invocationContext, contexts.get(key));

            const { location = {}, name = '', protocol = false } = expression;
            const call = signature && Object.freeze({ signature, protocol, eligible: true,
                descriptor: Object.freeze({ location, callee: name || 'Function', site: indexOf(expression), filename: callerModule }),
                argumentsList: Object.freeze(inputs.map((value, index) => Object.freeze({ location, ...argumentMetadata.at(index), owner: ownerForValue(value, observation) }))) });
            const admitted = entry => outcomes.sequence(prefix, call ? outcomes.called(entry, { key, site, call }) : entry, selection);

            if (!execute || recursive) return { value: admitted(promiseResult ? unknownPromise(expression, context) : opaque(expression, context)) };

            if (intrinsicPromise) return { value: admitted(promiseConstruction(inputs.at(0) || absentValue, expression, context)) };

            if (!contexts.has(key)) put(contexts, key, createContext({ model: callee, arguments: Object.freeze(inputs),
                origin: Object.freeze({ caller: context, invocation: expression }) }));

            return then(functionTask(callee, contexts.get(key)), (entry) => {
                // Authored caller inputs still constrain their source-owned
                // consumers. An unavailable route cannot publish that body's
                // value as an initialized import result or reusable pure call.
                if (!resultReady) {
                    const { calls = false } = entry;
                    const unavailable = promiseResult ? unknownPromise(expression, context) : opaque(expression, context);

                    return { value: admitted(outcomes.outcome({ ...unavailable, calls })) };
                }

                const { normal = 0, thrown = 0, uncertain = 0, effects = 0, unresolved = false } = entry;
                const result = valueOf(entry);
                const { constant = false } = result ? result : {};
                const pure = reusable && !completed && normal === 1 && !thrown && !uncertain && !effects && !unresolved;
                const { origin = false, owner = false } = pure && result && !constant ? valueModel.evidenceFor(result, selection) : {};
                const unchanged = origin && inputs.some((input) => {
                    const { origin: supplied = false } = valueModel.evidenceFor(input, selection);

                    return origin === supplied;
                });
                const { families = [], incomplete = true } = owner && !unchanged ? readFamily({ owner, ...observation }) : {};
                const primitive = !incomplete && families.length && families.every(family => ['number', 'string', 'boolean', 'nullish'].includes(family));

                if (pure && (constant || unchanged || primitive)) {
                    const cache = inputs.reduce((entries, value) => entries.get(value) || put(entries, value, new Map()),
                        invocations.get(callee) || put(invocations, callee, new Map()));

                    put(cache, completedInvocation, contexts.get(key));
                }

                return { value: admitted(promiseResult ? promised(entry, expression, context, { invocation: true }) : outcomes.outcome({ ...entry, returns: false, sites: false,
                    value: result ? testedValue(normalValue({ ...result, owner: false, input: result, inputs: [] }), expression, context, tick, inputs.at(0)) : false })) };
            });
        };
        const argumentsStep = ({ expression = {}, context = {}, gate = 1, key = '' } = {}, prefix, invoke) => {
            if (typeof invoke !== 'function') throw new TypeError('Expected invocation continuation');

            const { arguments: args = [], argumentOwned = [] } = expression;
            const state = stages.get(key) || put(stages, key, { position: 0, prefix, arguments: [], effects: 0 });
            const { position = 0, prefix: completed = {}, arguments: inputs = [], effects = 0 } = state;

            if (!normalOf(completed)) return { value: completed };

            const { spreadLayout = false } = expression;

            if (position >= args.length && spreadLayout && effects) {
                return { value: outcomes.sequence(completed, opaque(expression, context), selection) };
            }

            if (position >= args.length) return invoke(state);

            return then(selectTask(args.at(position), context, and(gate, normalOf(completed))), (entry) => {
                const value = valueOf(entry);

                append(inputs, argumentOwned.at(position) === false ? valueModel.retire(value) : value);
                put(stages, key, { position: position + 1, prefix: outcomes.follow(completed, entry), arguments: inputs, effects: or(effects, effectsOf(entry)) });

                return { dependencies: [] };
            });
        };
        const arrayStep = ({ expression = {}, context = {}, gate = 1, key = '' } = {}) => {
            const { arguments: args = [], argumentOwned = [], argumentStable = [], holes = [], spreads = [], standardPrototype = false } = expression;
            const state = stages.get(key) || put(stages, key, { position: 0, prefix: continuation, slots: [], fixed: true });
            const { position = 0, prefix = {}, slots = [], fixed = false } = state;

            if (!normalOf(prefix)) return { value: prefix };

            if (position >= args.length) return { value: outcomes.sequence(prefix, outcomes.complete(normalValue({
                ...arrayValue(fixed ? Object.freeze(slots) : false, standardPrototype), producer: producerFor(expression)
            })), selection) };

            return then(selectTask(args.at(position), context, and(gate, normalOf(prefix))), (entry) => {
                const value = argumentOwned.at(position) === false ? valueModel.retire(valueOf(entry)) : valueOf(entry);
                const spread = spreads.at(position);
                const { slots: supplied = false, standardPrototype: native = false, borrowed = false } = valueModel.evidenceFor(value || unknownValue, selection);
                const iterable = spread && native && supplied;
                const copied = iterable ? supplied.map(value => borrowed ? valueModel.borrow(value || absentValue) : value || absentValue) : [];
                const stable = value && argumentStable.at(position) ? normalValue({ ...value, suspensionSafe: !borrowed }) : value;
                const selected = spread ? copied : [holes.at(position) ? false : stable];

                selected.forEach(value => append(slots, value));
                const evaluated = spread && !iterable ? outcomes.sequence(entry, opaque(expression, context), selection) : entry;

                put(stages, key, { position: position + 1, prefix: outcomes.follow(prefix, evaluated), slots, fixed: fixed && (!spread || Boolean(iterable)) });

                return { dependencies: [] };
            });
        };
        const callStep = current => argumentsStep(current, continuation, state => invokeStep(current, state));
        const awaitStep = ({ expression = {}, context = {}, gate = 1 } = {}) => {
            const { argument = {} } = expression;

            return then(selectTask(argument, context, gate), entry => ({
                value: outcomes.sequence(entry, resolve(valueOf(entry), expression, context, gate), selection)
            }));
        };
        const unaryStep = ({ expression = {}, context = {}, gate = 1 } = {}) => {
            const { argument = {}, operator = '', owner = false } = expression;

            return then(selectTask(argument, context, gate), (entry) => {
                if (!normalOf(entry)) return { value: entry };

                const { value: input = {} } = entry;
                const { truth = -1, truthGate = 0, absence = 'unknown' } = input;
                const { owner: source = false } = valueModel.evidenceFor(input, selection);
                const { families = [], incomplete = false } = readFamily({ owner: source, ...observation });
                const family = !incomplete && families.length === 1 ? families.at(0) : '';
                const type = ['array', 'regexp', 'object'].includes(family) || absence === 'null' ? 'object' : family;
                const knownType = absence === 'undefined' ? 'undefined' : type;
                const constant = operator === 'typeof' && knownType && knownType !== 'nullish' ? Object.freeze({ value: knownType }) : false;

                if (operator === 'void') return { value: outcomes.sequence(entry, outcomes.complete(absentValue), selection) };

                if (['+', '-'].includes(operator) && !['string', 'number', 'boolean', 'nullish'].includes(family)) return { value: outcomes.sequence(entry, opaque(expression, context), selection) };

                if (['+', '-'].includes(operator)) {
                    const { constant = false } = input;
                    const number = constant && Reflect.get(constant, 'value');
                    const computed = typeof number === 'number' ? Object.freeze({ value: operator === '-' ? -number : number }) : false;
                    const truth = computed ? Number(Boolean(Reflect.get(computed, 'value'))) : -1;

                    const value = sourceValue({ ...expression, owner: nativeOwner('number'), constant: computed, truth, absence: 'present', promise: 'none' }, context);

                    return { value: outcomes.sequence(entry, outcomes.complete(value), selection) };
                }

                const value = normalValue({ owner, constant, typeOf: operator === 'typeof' ? input : false, absence: 'present', truth: operator === 'typeof' ? 1 : inverted(truth),
                    truthGate: operator === 'typeof' ? 1 : not(truthGate) });

                return { value: outcomes.sequence(entry, outcomes.complete(value), selection) };
            });
        };
        const arithmeticStep = ({ expression = {}, context = {}, gate = 1 } = {}) => {
            const { left = {}, right = {}, operator = '' } = expression;

            return then(selectTask(left, context, gate), (first) => {
                if (!normalOf(first)) return { value: first };

                return then(selectTask(right, context, and(gate, normalOf(first))), (second) => {
                    const prefix = outcomes.follow(first, second);
                    const families = [first, second].map((entry) => {
                        const { owner = unknownSource } = valueModel.evidenceFor(valueOf(entry) || unknownValue, selection);
                        const { families = [], incomplete = true } = readFamily({ owner, ...observation });

                        return !incomplete && families.length === 1 ? families.at(0) : '';
                    });
                    const primitive = families.every(family => ['string', 'number', 'boolean', 'nullish'].includes(family));
                    const numeric = primitive ? 'number' : '';
                    const family = operator === '+' && families.includes('string') ? 'string' : numeric;
                    const value = family ? familyValue(family, expression, context) : false;

                    return { value: outcomes.sequence(prefix, primitive ? outcomes.complete(value) : opaque(expression, context, value), selection) };
                });
            });
        };
        const templateStep = ({ expression = {}, context = {}, gate = 1, key = '' } = {}) => {
            const { arguments: args = [] } = expression;
            const state = stages.get(key) || put(stages, key, { position: 0, prefix: continuation });
            const { position = 0, prefix = {} } = state;

            if (!normalOf(prefix)) return { value: prefix };

            if (position >= args.length) return { value: outcomes.sequence(prefix, outcomes.complete(familyValue('string', expression, context)), selection) };

            return then(selectTask(args.at(position), context, and(gate, normalOf(prefix))), (entry) => {
                const { owner = unknownSource } = valueModel.evidenceFor(valueOf(entry) || unknownValue, selection);
                const { families = [], incomplete = true } = readFamily({ owner, ...observation });
                const inert = !incomplete && families.length && families.every(family => ['string', 'number', 'boolean', 'nullish'].includes(family));
                const normal = inert ? 1 : condition(expression, context, 'completion', `template-coercion:${position}`);
                const coercion = outcomes.outcome({ value: absentValue, normal, thrown: not(normal), uncertain: not(normal), effects: Number(!inert) });

                put(stages, key, { position: position + 1, prefix: outcomes.sequence(outcomes.follow(prefix, entry), coercion, selection) });

                return { dependencies: [] };
            });
        };
        const moduleValueStep = ({ expression = {}, context = {} } = {}) => {
            const { provider = false, target = {}, access = false } = expression;
            const model = executionModels.get(provider);

            if (!model || active.has(model)) return { value: opaque(expression, context) };

            const providerContext = contextFor(provider);

            return then(functionTask(model, providerContext), (entry) => {
                // Module evaluation can fail or have effects, but its completion
                // is not a return path of the function reading an export.
                const initialized = outcomes.outcome({ ...entry, returns: false, sites: false });

                if (!normalOf(initialized)) return { value: initialized };

                const { unresolved = false } = initialized;

                if (unresolved) return { value: outcomes.sequence(initialized, opaque(expression, context), selection) };

                return then(selectTask(target, access ? context : providerContext, normalOf(initialized)), (entry) => {
                    // An access only gates the reader's existing value. Actual
                    // value transport retires shared mutable payload ownership.
                    const value = access ? valueOf(entry) : valueModel.retire(valueOf(entry), { protocol: true });

                    return { value: outcomes.follow(initialized, outcomes.outcome({ ...entry, value })) };
                });
            });
        };
        const booleanStep = ({ expression = {}, context = {}, gate = 1 } = {}) => {
            const { left = {}, right = {}, inert = false, operator = '', capabilityTest: { capability: { result: localResult = false } = {} } = {} } = expression;

            return then(selectTask(left, context, gate), (first) => {
                if (!normalOf(first)) return { value: first };

                return then(selectTask(right, context, and(gate, normalOf(first))), (second) => {
                    const prefix = outcomes.follow(first, second);
                    const a = valueOf(first);
                    const b = valueOf(second);
                    const { constant: firstConstant = false, typeOf: firstType = false, objectTagOf: firstTag = false,
                        absence: firstAbsence = 'unknown', nullishGate: firstNullish = 0 } = a;
                    const { constant: secondConstant = false, typeOf: secondType = false, objectTagOf: secondTag = false,
                        absence: secondAbsence = 'unknown', nullishGate: secondNullish = 0 } = b;
                    const exact = firstConstant && secondConstant && ['===', '!=='].includes(operator);
                    const truth = exact ? Number((operator === '===') === (Reflect.get(firstConstant, 'value') === Reflect.get(secondConstant, 'value'))) : -1;
                    const base = testedValue(sourceValue({ ...expression, truth, absence: 'present' }, context), expression, context, tick);
                    const subject = firstType || secondType;
                    const compared = firstType ? secondConstant : firstConstant;
                    const typeName = compared && Reflect.get(compared, 'value');
                    const typeTest = subject && typeof typeName === 'string' && ['===', '!=='].includes(operator);
                    const absentOperand = ['null', 'undefined'].includes(firstAbsence) || ['null', 'undefined'].includes(secondAbsence);
                    const nullishTest = ['==', '!='].includes(operator) && absentOperand;
                    const { truthGate = 0 } = base;
                    // A returned value can retain its producer identity while
                    // this guard owns a distinct local binding capability.
                    // Known families still select their actual type below.
                    const unknownMatch = !(typeName === 'function' && localResult) && typeTest && typeofNames.has(typeName) &&
                        familyCondition(subject, typeName === 'object' ? 'typeof-object' : typeName, context, true) || (operator === '===' ? truthGate : not(truthGate));
                    const selectedNullish = ['null', 'undefined'].includes(firstAbsence) ? secondNullish : firstNullish;
                    const tested = nullishTest ? normalValue({ ...base, truthGate: operator === '==' ? selectedNullish : not(selectedNullish) }) : base;
                    const matches = typeTest ? valueModel.typeGate(subject, typeName, unknownMatch, selection) : truthGate;
                    const typeValue = typeTest ? normalValue({ ...base, truthGate: operator === '===' ? matches : not(matches) }) : tested;
                    const tagSubject = firstTag || secondTag;
                    const tagConstant = firstTag ? secondConstant : firstConstant;
                    const tagText = tagConstant && Reflect.get(tagConstant, 'value');
                    const tagName = typeof tagText === 'string' && /^\[object [A-Za-z]+\]$/u.test(tagText) ? tagText.slice(8, -1) : '';
                    const tagTest = tagSubject && tagName && ['===', '!=='].includes(operator);
                    const tagFamily = objectTags.get(tagName);
                    const tagUnknown = tagTest && tagFamily && familyCondition(tagSubject, `tag:${tagName}`, context, true) ||
                        (operator === '===' ? truthGate : not(truthGate));
                    const tagMatch = tagTest ? valueModel.typeGate(tagSubject, tagName, tagUnknown, selection, 'tag') : truthGate;
                    const fixed = firstConstant || secondConstant;
                    const text = fixed && Reflect.get(fixed, 'value');
                    // Family exclusion does not require a literal-producing arm.
                    // Typeof and native-tag guards already own stronger proofs.
                    const literalTest = !exact && !typeTest && !tagTest && typeof text === 'string' && ['===', '!=='].includes(operator);
                    const literalValue = firstConstant ? b : a;
                    const match = () => valueModel.typeGate(literalValue, text, operator === '===' ? truthGate : not(truthGate), selection, 'literal');
                    const tagged = tagTest ? normalValue({ ...base, truthGate: operator === '===' ? tagMatch : not(tagMatch) }) : typeValue;
                    const value = literalTest ? normalValue({ ...base, truthGate: operator === '===' ? match() : not(match()) }) : tagged;

                    return { value: outcomes.sequence(prefix, inert || nullishTest ? outcomes.complete(value) : opaque(expression, context, value), selection) };
                });
            });
        };
        // Each copy maps the existing source contributions once. Later writers
        // share the previous record as a lazy base for demanded fields.
        const copyRecord = (value, { base = false, baseValue = false, excluded = [], ...shape } = {}, evidence = recordSourceFor(value, observation, selection)) => {
            const { source = unknownSource, guarded = false, borrowed = false } = evidence;
            const copy = (source) => {
                const owner = createOwner({ evidence: record({ source, base, excluded, retire: borrowed }) });
                const projection = recordLayers.has(source) ? source : createOwner({ evidence: record({ source }) });

                put(recordLayers, owner, { source: normalValue({ owner: projection }), base: baseValue, excluded, retire: borrowed });

                return normalValue({ ...shape, owner });
            };

            return guarded ? valueModel.selectSource(value, ({ memberOwner = unknownSource } = {}) => copy(memberOwner), () => copy(unknownSource), selection, { fresh: true }) : copy(source);
        };
        const recordFieldStep = ({ expression = {}, context = {}, gate = 1, key = '' } = {},
            { position = 0, prefix = {}, fields = [], open = false, base = false } = {}) => {
            const { entries = [], trusted = false } = expression;
            const { name: staticName = '', known: staticKnown = false, data = false, spread = false, value = {}, key: computed = false } = entries.at(position);
            const keyTask = computed && selectTask(computed, context, and(gate, normalOf(prefix)));
            const waiting = keyTask ? need(keyTask) : [];

            if (waiting.length) return { dependencies: waiting };

            const evaluatedKey = keyTask ? outcomes.follow(prefix, read(keyTask)) : prefix;
            const names = keyTask ? keyCases(valueOf(read(keyTask))).filter(({ gate = 0 } = {}) => and(gate, normalOf(evaluatedKey))) : [];
            const started = names.some(({ known = false } = {}) => !known)
                ? outcomes.sequence(evaluatedKey, opaque(expression, context), selection) : evaluatedKey;
            const [{ known = staticKnown, name = staticName } = {}] = names.length === 1 ? names : [];
            const resolved = names.length > 1 ? { known: false, name: '' } : { known, name };
            const { known: resolvedKnown = false, name: resolvedName = '' } = staticKnown ? { known: true, name: staticName } : resolved;

            if (!normalOf(started)) return { value: started };

            return then(selectTask(value, context, and(gate, normalOf(started))), (entry) => {
                const result = data ? valueModel.escape(valueOf(entry) || unknownValue, selection) : unknownValue;
                const owner = ownerForValue(result, observation);

                if (!resolvedKnown) {
                    const input = valueOf(entry) || unknownValue;
                    const evidence = recordSourceFor(input, observation, selection);
                    const writes = fields.map(({ name = '', owner = false } = {}) => ({ name, owner: trusted ? owner : unknownSource }));
                    const previous = (value) => {
                        const base = value && ownerForValue(value, observation);
                        const owner = createOwner({ evidence: record({ base, open, fields: writes }) });

                        if (value) put(recordLayers, owner, { base: value, fields: new Set(writes.map(({ name = '' } = {}) => name)) });

                        return normalValue({ owner });
                    };
                    const prior = previous(base);
                    const priorOwner = ownerForValue(prior, observation);
                    const alternatives = names.length ? names : [{ known: false, gate: 1 }];
                    const copied = spread && trusted ? copyRecord(input, { base: priorOwner, baseValue: prior }, evidence)
                        : valueModel.joined(alternatives.map(({ known = false, name = '', gate = 1 } = {}) => {
                            const branchOwner = createOwner({ evidence: record(known
                                ? { base: priorOwner, fields: [{ name, owner: trusted ? owner : unknownSource }] } : { source: unknownSource, base: priorOwner }) });
                            const branch = normalValue({ owner: branchOwner });

                            if (known) put(recordLayers, branchOwner, { base: prior, fields: new Set([name]) });

                            return valueModel.restrict(branch, gate, selection);
                        }));
                    const inert = spread && lifetimeGate(input, 'copy-inert');
                    const copiedReads = spread && inert !== 1 ? outcomes.join(outcomes.restrict(continuation, inert, selection),
                        outcomes.restrict(opaque(expression, context), not(inert), selection)) : continuation;
                    const evaluated = outcomes.sequence(entry, copiedReads, selection);

                    put(stages, key, { position: position + 1, prefix: outcomes.follow(started, evaluated), fields: [], open: false, base: copied });

                    return { dependencies: [] };
                }

                append(fields, { name: resolvedName, owner });

                put(stages, key, { position: position + 1, prefix: outcomes.follow(started, entry), fields, open, base });

                return { dependencies: [] };
            });
        };
        const recordStep = (current = {}) => {
            const { expression = {}, key = '' } = current;
            const { entries = [], trusted = false, standardPrototype = false, open: extensible = false, openDefault = false } = expression;
            const state = stages.get(key) || put(stages, key, { position: 0, prefix: continuation, fields: [], open: !trusted || extensible });
            const { position = 0, prefix = {}, fields = [], open = false, base = false } = state;

            if (!normalOf(prefix)) return { value: prefix };

            if (position < entries.length) return recordFieldStep(current, state);

            const shape = { producer: producerFor(expression), promise: 'none', standardPrototype, nativeTag: (!open || openDefault) && trusted && standardPrototype ? 'Object' : '',
                plain: trusted && standardPrototype, emptyDefault: openDefault, emptyRecord: !entries.length && !open, truth: 1, absence: 'present' };
            const writes = fields.map(({ name = '', owner = false } = {}) => ({ name, owner: trusted ? owner : unknownSource }));
            const complete = ({ owner: prior = false } = {}) => {
                const owner = createOwner({ evidence: record({ open, base: prior, fields: writes }) });
                const value = normalValue({ ...shape, owner });

                put(sources, owner, value);

                if (base) put(recordLayers, owner, { base, fields: new Set(writes.map(({ name = '' } = {}) => name)) });

                return value;
            };
            const value = base ? valueModel.selectSource(base, complete, () => complete({ owner: unknownSource }), selection) : complete();

            return { value: outcomes.sequence(prefix, outcomes.complete(value), selection) };
        };
        const recordRestStep = ({ expression = {}, context = {}, gate = 1 } = {}) => {
            const { target = {}, excluded = [], excludedKeys = [] } = expression;

            return then(selectTask(target, context, gate), (entry) => {
                if (!normalOf(entry)) return { value: entry };

                const tasks = new Map(excludedKeys.flatMap((key, position) => key ? [[position, selectTask(key, context, and(gate, normalOf(entry)))]] : []));
                const waiting = [...tasks.values()].flatMap(need);

                if (waiting.length) return { dependencies: waiting };

                const names = excluded.map((name, position) => {
                    const task = tasks.get(position);

                    if (!task) return [{ known: true, name }];

                    return keyCases(valueOf(read(task))).filter(({ gate = 0 } = {}) => and(gate, normalOf(entry)));
                });
                const resolved = names.flatMap((entries) => {
                    const [{ known = false, name = '' } = {}] = entries;

                    return entries.length === 1 && known ? [name] : [];
                });

                if (resolved.length !== names.length) return { value: outcomes.sequence(entry, opaque(expression, context), selection) };

                const omitted = names.length ? resolved : excluded;
                const input = valueOf(entry) || unknownValue;
                const evidence = recordSourceFor(input, observation, selection);
                const { plain = false, families = [], incomplete = true } = evidence;

                if (!incomplete && families.length === 1 && families.at(0) === 'nullish') return { value: outcomes.thrown(entry) };

                const { standardPrototype = false } = expression;
                const value = copyRecord(input, { excluded: omitted, plain: standardPrototype, standardPrototype,
                    truth: 1, absence: 'present', producer: producerFor(expression) }, evidence);

                return { value: outcomes.sequence(entry, plain ? outcomes.complete(value) : opaque(expression, context, value), selection) };
            });
        };
        const memberStep = (current = {}) => {
            const { expression = {}, context = {}, gate = 1 } = current;
            const { target = {} } = expression;

            return then(selectTask(target, context, gate), (entry) => {
                if (!normalOf(entry)) return { value: entry };

                return withPropertyKey(current, entry, (expression, entry) => {
                    const { name = '', known = true, computed = false, supported = false, promiseFactory = false, promiseMethod = '',
                        nativeFactory = false, nativeNamespace = '' } = expression;

                    if (!known || !supported) return { value: outcomes.sequence(entry, opaque(expression, context), selection) };

                    if (nativeNamespace) return { value: outcomes.sequence(entry, outcomes.complete(normalValue({ owner: nativeOwner(nativeNamespace),
                        promise: 'none', truth: 1, absence: 'present' })), selection) };

                    if (promiseFactory) return { value: outcomes.sequence(entry, outcomes.complete(normalValue({ owner: unknownSource,
                        callable: Object.freeze({ nativePromise: promiseMethod, lookup: expression, receiverBound: true }), promise: 'none', truth: 1, absence: 'present' })), selection) };

                    if (nativeFactory) return { value: outcomes.sequence(entry, outcomes.complete(normalValue({ owner: unknownSource,
                        callable: Object.freeze({ ...nativeFactory, lookup: expression }), promise: 'none', truth: 1, absence: 'present' })), selection) };

                    const input = valueOf(entry) || unknownValue;
                    const receiver = valueModel.evidenceFor(input, selection);
                    const { owner: valueOwner = false, memberOwner: owner = false, standardPrototype = false, plain = false, emptyDefault = false, producers = false } = receiver;
                    const family = readFamily({ ...observation, owner: name === 'length' ? valueOwner : owner });
                    const { families = [], incomplete = false } = family;
                    const dataFamily = nativePropertyFamily({ name, ...family });
                    const { cases = [], value: field = false, missing = cases.some(({ state = '' } = {}) => state === 'absent') } = dataFamily
                        ? { value: nativeLengthValue(input, expression, context, receiver) } : fieldFrom(input, expression, context);
                    const { name: expected = '' } = operationRequirements.get(name) ?? {};
                    const position = computed && /^(0|[1-9]\d*)$/u.test(name) && Number(name) < 2 ** 32 - 1 ? Number(name) : -1;
                    const nativePosition = position >= 0;
                    const unresolved = () => sourceValue({ ...unknown, ...expression }, context);
                    const readSelected = (entry = {}) => {
                        const { memberOwner: source = false, slots = false, standardPrototype = false } = entry;

                        if (nativePosition && slots && standardPrototype) return slots.at(position) || absentValue;

                        const result = name === 'length' ? nativePropertyFamily({ name, ...readFamily({ ...observation, owner: source }) }) : '';

                        if (result) return nativeLengthValue(entry, expression, context, entry);

                        return fieldValue(readField({ ...observation, owner: source, name }).cases, expression, context);
                    };
                    const selected = !dataFamily && (nativePosition || name === 'length')
                        ? valueModel.selectSource(input, readSelected, unresolved, selection) : field;
                    const nativeGate = !dataFamily && name === 'length' ? or(valueModel.typeGate(input, 'array', 0, selection, 'family'),
                        valueModel.typeGate(input, 'string', 0, selection, 'family')) : 0;
                    const retainedGate = nativeGate && and(nativeGate, not(valueModel.typeGate(selected, 'number', 0, selection, 'family')));
                    const projected = retainedGate ? valueModel.joined([valueModel.restrict(selected, not(retainedGate), selection),
                        valueModel.restrict(familyValue('number', expression, context), retainedGate, selection)]) : selected;
                    const absent = Boolean(missing);
                    const conflicts = expected ? families.filter(family => family !== expected && (family !== 'object' || absent || emptyDefault)) : [];
                    const { receiver: declaredReceiver = '' } = operations.get(name) ?? {};
                    const stringSlice = name === 'slice' && families.length === 1 && families.at(0) === 'string';
                    const nativeReceiver = stringSlice ? 'string' : declaredReceiver;
                    const native = Boolean(nativeReceiver && (nativeReceiver === 'string' || standardPrototype) &&
                    families.length === 1 && families.at(0) === nativeReceiver && !incomplete && !cases.some(({ state = '' } = {}) => state === 'present'));
                    const missingNative = Boolean(expected && !incomplete && families.length && conflicts.length === families.length &&
                    !cases.some(({ state = '' } = {}) => state === 'present'));
                    const nonnative = missingNative ? absentValue : projected;
                    const callable = native && Object.freeze(stringSlice ? { factory: 'string', receiverBound: true, lookup: expression }
                        : { native: name, lookup: expression, receiver: input });
                    const value = native ? normalValue({ ...unknownValue, callable, absence: 'present', truth: 1 }) : nonnative;

                    const proof = Object.freeze({ name, missing: absent && !objectPrototypeMembers.has(name), conflicts: Object.freeze(conflicts), expected, native, producers,
                        incomplete: incomplete || cases.some(({ state = '' } = {}) => state === 'unknown'), family });
                    const collected = memberProofs.get(`${indexOf(expression)}:${indexOf(context)}`) ||
                    put(memberProofs, `${indexOf(expression)}:${indexOf(context)}`, new Set());

                    retain(collected, proof);

                    return { value: outcomes.sequence(entry, native || dataFamily || (nativePosition && standardPrototype && families.length === 1 && families.at(0) === 'array' && !incomplete) ||
                    (plain && cases.every(({ state = '' } = {}) => state === 'present' || (state === 'absent' && standardPrototype)))
                        ? outcomes.complete(value) : opaque(expression, context, value), selection) };
                });
            });
        };
        const requireCallable = ({ value = {}, gate = 1, key = '', expression = {}, context = {}, path = 'callee', location = {} } = {}) => {
            if (!gate) return;

            const selected = valueModel.restrict(value, gate, selection);
            const { owner = false } = valueModel.evidenceFor(selected, selection);
            const fact = readFamily({ owner, ...observation });
            const { families = [] } = fact;

            if (!families.some(family => family !== 'function')) return;

            const ownerKey = `${indexOf(expression)}:${indexOf(context)}`;
            const requirements = callableRequirements.get(ownerKey) || put(callableRequirements, ownerKey, new Map());

            put(requirements, `${key}:${path}`, { path, location, fact, task: key });
        };
        // Native collection protocols schedule ordinary invocations. Slots and
        // accumulator values belong to this caller, never the generic callback.
        const collectionStep = (current, { prefix = {}, arguments: inputs = [], effects: argumentEffects = 0 } = {}, method, receiver) => {
            const { expression = {}, context = {}, key = '', point = '', site = '' } = current;
            const { evaluation = '', reverse = false } = operations.get(method) ?? {};
            const reducing = evaluation === 'reduce';
            const direction = reverse ? -1 : 1;
            const { slots = false, standardPrototype = false } = valueModel.evidenceFor(receiver, selection);
            const callback = inputs.at(0) || absentValue;
            consumeCallable(callback, expression, context, normalOf(prefix), false);
            const { owner = false } = valueModel.evidenceFor(callback, selection);
            const callableCases = valueModel.casesFor(callback, 'callable', selection);
            const { families = [], incomplete = false } = readFamily({ owner, ...observation });
            const { argumentMetadata: [metadata = {}] = [], location: callLocation = {} } = expression;
            const { location = callLocation } = metadata;

            requireCallable({ value: callback, gate: normalOf(prefix), key: site || key, expression, context, path: `${method}.callback`, location });

            const rejectAsyncCallback = () => {
                const ownerKey = `${indexOf(expression)}:${indexOf(context)}`;
                const requirements = callableRequirements.get(ownerKey) || put(callableRequirements, ownerKey, new Map());

                put(requirements, `${site || key}:forEach.async`, { kind: 'asyncCallback', path: 'forEach.callback', location, task: site || key });
            };

            if (method === 'forEach' && callableCases.some(({ callable: { asynchronous = false } = {} } = {}) => asynchronous)) rejectAsyncCallback();

            const fallback = () => {
                const family = nativeResultFamily.get(method);
                const result = family ? familyValue(family, expression, context) : false;
                const value = method === 'forEach' ? absentValue : result;

                return { value: outcomes.sequence(prefix, opaque(expression, context, value), selection) };
            };

            // A generic callback summary is independent of any chosen element
            // or accumulator. Equal seed/result families establish an inductive
            // normal-result invariant without enumerating unknown positions.
            const summarizeReduction = () => {
                if (!reducing || inputs.length < 2 || !callableCases.length ||
                    callableCases.some(({ callable = false } = {}) => {
                        const { functionModel = false } = callable ? callable : {};

                        return !functionModel || active.has(templateFor(callable));
                    })) return fallback();

                const summaries = callableCases.map(({ callable = {} } = {}) => functionTask(callable, contextFor(executionOf(callable))));
                const waiting = summaries.flatMap(need);

                if (waiting.length) return { dependencies: waiting };

                const seed = inputs.at(1);
                const allAsync = callableCases.every(({ callable: { promiseResult = false } = {} } = {}) => promiseResult);
                const allSync = callableCases.every(({ callable: { promiseResult = false } = {} } = {}) => !promiseResult);
                const seedValue = allAsync ? valueOf(resolve(seed, expression, context)) : seed;
                const candidates = [seedValue, ...summaries.map(selected => valueOf(read(selected)))];
                const families = candidates.map((value) => {
                    if (!value) return '';

                    const { owner = false } = valueModel.evidenceFor(value, selection);
                    const { families = [], incomplete = true } = readFamily({ owner, ...observation });

                    return !incomplete && families.length === 1 ? families.at(0) : '';
                });
                const [family = ''] = families;

                if ((!allAsync && !allSync) || !family || families.some(actual => actual !== family)) return fallback();

                const value = familyValue(family, expression, context);
                const result = allAsync ? valueModel.joined([seed, valueOf(promised(opaque(expression, context, value), expression, context))]) : value;

                return { value: outcomes.sequence(prefix, opaque(expression, context, result), selection) };
            };

            if (!incomplete && families.length && !families.includes('function')) return { value: outcomes.sequence(prefix, outcomes.thrown(continuation), selection) };

            if (!slots || !standardPrototype || argumentEffects) return summarizeReduction();

            const seeded = inputs.length > 1;
            const edge = reverse ? slots.findLastIndex(Boolean) : slots.findIndex(Boolean);
            const start = reducing && !seeded ? edge : -1;

            if (reducing && !seeded && start < 0) return { value: outcomes.sequence(prefix, outcomes.thrown(continuation), selection) };

            const seed = seeded ? inputs.at(1) : slots.at(start);
            const initial = reducing ? seed : absentValue;
            const initialPosition = reverse ? slots.length - 1 : 0;
            const first = reducing && !seeded ? start + direction : initialPosition;
            const state = stages.get(key) || put(stages, key, { position: first, prefix, result: initial, produced: [], fixed: true, finished: empty });
            const { position = 0, prefix: completed = {}, result = false, produced = [], fixed = false, finished = empty } = state;
            const finish = value => ({ value: outcomes.join(finished, outcomes.sequence(completed, outcomes.complete(value), selection)) });

            if (!normalOf(completed)) return { value: outcomes.join(finished, completed) };

            const ended = position < 0 || position >= slots.length;

            if (ended && reducing) return finish(result);

            if (ended && ['some', 'every'].includes(evaluation)) return finish(normalValue({ owner: nativeOwner('boolean'),
                constant: Object.freeze({ value: evaluation === 'every' }), truth: Number(evaluation === 'every'), absence: 'present', promise: 'none' }));

            if (ended && evaluation === 'findIndex') return finish(normalValue({ owner: nativeOwner('number'),
                constant: Object.freeze({ value: -1 }), truth: 1, absence: 'present', promise: 'none' }));

            if (ended) return finish(['map', 'flatMap', 'filter'].includes(evaluation) ? arrayValue(fixed ? Object.freeze(produced) : false, standardPrototype) : absentValue);

            const item = slots.at(position);

            if (!item && method === 'map') append(produced, false);

            if (!item && !['find', 'findIndex'].includes(evaluation)) {
                put(stages, key, { ...state, position: position + direction });

                return { dependencies: [] };
            }

            const ordinal = normalValue({ owner: nativeOwner('number'), constant: Object.freeze({ value: position }), truth: Number(Boolean(position)), absence: 'present', promise: 'none' });
            const argumentsList = [...(reducing ? [result] : []), item || absentValue, ordinal, receiver];
            const plans = callableCases.map(({ callable = false, gate: chosen = 1 } = {}, index) => {
                const reach = and(normalOf(completed), chosen);

                if (!reach) return { value: empty };

                const { functionModel = false, truthOf = false } = callable ? callable : {};

                if (truthOf) return { value: outcomes.restrict(outcomes.complete(truthValue(argumentsList.at(0))), reach, selection) };

                if (!functionModel) return { value: outcomes.restrict(opaque(expression, context), reach, selection) };

                return invokeStep({ ...current, key: `${key}:item:${position}:${index}`, point: `${point || key}:item:${position}:${index}`, site: site || key,
                    expression: { ...expression, function: callable, protocol: method, name: `${method}.callback`,
                        argumentMetadata: argumentsList.map(() => producerFor(expression)), argumentFresh: [],
                        argumentStable: argumentsList.map(({ suspensionSafe = false } = {}) => suspensionSafe) } },
                { prefix: outcomes.restrict(continuation, reach, selection), arguments: argumentsList.map(value => valueModel.restrict(value, reach, selection)) });
            });
            const waiting = plans.flatMap(({ dependencies = [] } = {}) => dependencies);

            if (waiting.length) return { dependencies: waiting };

            if (plans.some(({ value = false } = {}) => !value)) return { dependencies: [] };

            const called = plans.map(({ value = {} } = {}) => value).reduce((left, right) => outcomes.join(left, right), empty);
            const next = outcomes.sequence(outcomes.sequence(completed, called, selection), continuation, selection);
            const selected = valueOf(called) || unknownValue;
            const { truthGate = 0 } = selected;
            const { effects = 0 } = called;

            const { promises = [] } = valueModel.evidenceFor(selected, selection);

            if (method === 'forEach' && promises.includes('known')) rejectAsyncCallback();

            const observedItem = effects ? valueModel.retire(item || absentValue) : item || absentValue;
            const exits = ['some', 'every', 'find', 'findIndex'].includes(evaluation);
            const exitGate = evaluation === 'every' ? not(truthGate) : truthGate;
            const matched = evaluation === 'findIndex' ? ordinal : observedItem;
            const found = ['some', 'every'].includes(evaluation) ? normalValue({ owner: nativeOwner('boolean'),
                constant: Object.freeze({ value: evaluation === 'some' }), truth: Number(evaluation === 'some'), absence: 'present', promise: 'none' })
                : matched;
            const stopped = exits ? outcomes.sequence(outcomes.restrict(next, exitGate, selection), outcomes.complete(found), selection) : empty;
            const continued = exits ? outcomes.restrict(next, not(exitGate), selection) : next;
            const nextPosition = position + direction;
            const retired = effects && normalOf(continued) && nextPosition >= 0 && nextPosition < slots.length;
            const summary = retired ? summarizeReduction() : {};
            const { dependencies = [], value: unknownResult = empty } = summary;

            if (dependencies.length) return { dependencies };

            const unknownTail = retired ? outcomes.sequence(outcomes.restrict(continued, effects, selection), unknownResult, selection) : empty;
            const remaining = retired ? outcomes.restrict(continued, not(effects), selection) : continued;

            if (method === 'map') append(produced, effects ? valueModel.retire(selected) : selected);

            const flattened = method === 'flatMap' && valueModel.evidenceFor(selected, selection);
            const { slots: nested = false, owner: flattenedOwner = false } = flattened ? flattened : {};
            const { families: flattenedFamilies = [], incomplete: uncertainFlattening = false } = flattenedOwner ? readFamily({ owner: flattenedOwner, ...observation }) : {};
            const scalar = flattenedFamilies.length && !uncertainFlattening && flattenedFamilies.every(family => family !== 'array');

            if (method === 'flatMap' && nested) nested.filter(Boolean).forEach(value => append(produced, effects ? valueModel.retire(value) : value));

            if (method === 'flatMap' && scalar) append(produced, effects ? valueModel.retire(selected) : selected);

            if (method === 'filter' && truthGate) append(produced, observedItem);

            put(stages, key, { position: nextPosition, prefix: remaining,
                result: selected, produced, fixed: fixed && !effects && (method !== 'flatMap' || Boolean(nested) || scalar) && (method !== 'filter' || !truthGate || truthGate === 1),
                finished: outcomes.join(outcomes.join(finished, unknownTail), stopped) });

            return { dependencies: [] };
        };
        const protocolStep = (current = {}, { prefix = {}, arguments: inputs = [] } = {}, native, receiver) => {
            const { expression = {}, context = {}, key = '', site = '' } = current;
            const receivers = valueModel.casesFor(receiver, 'callable', selection);
            const operand = inputs.at(1) || absentValue;
            const { slots = false, standardPrototype = false } = valueModel.evidenceFor(operand, selection);
            const { absence = 'unknown' } = operand;
            const arraylike = slots && standardPrototype ? slots.map(value => value || absentValue) : false;
            const applied = ['null', 'undefined'].includes(absence) ? [] : arraylike;
            const supplied = native === 'call' ? inputs.slice(1) : applied;

            if (!supplied || !receivers.length) return { value: outcomes.sequence(prefix, opaque(expression, context), selection) };

            const plans = receivers.map(({ callable = false, gate: receiverGate = 1 } = {}, position) => {
                const { functionModel = false } = callable ? callable : {};
                const reached = outcomes.restrict(prefix, receiverGate, selection);

                if (!functionModel) return { value: outcomes.sequence(reached, opaque(expression, context), selection) };

                const { argumentMetadata = [], argumentFresh = [] } = expression;

                return invokeStep({ ...current, key: `${key}:protocol:${position}`, site,
                    expression: { ...expression, function: callable,
                        argumentMetadata: native === 'call' ? argumentMetadata.slice(1) : [],
                        argumentFresh: native === 'call' ? argumentFresh.slice(1) : [] } },
                { prefix: reached, arguments: supplied.map(value => valueModel.restrict(value, receiverGate, selection)) });
            });
            const dependencies = plans.flatMap(({ dependencies = [] } = {}) => dependencies);

            if (dependencies.length) return { dependencies };

            if (plans.some(({ value = false } = {}) => !value)) return { dependencies: [] };

            return { value: plans.map(({ value = {} } = {}) => value).reduce((left, right) => outcomes.join(left, right), empty) };
        };
        const aggregateValue = (input, { key = '', settled = false, fresh = false, stable = false, expression = {}, context = {} } = {}) => {
            const { borrowed = false } = valueModel.evidenceFor(input, selection);
            const owned = fresh || (stable && !borrowed);
            const unresolved = () => promised(opaque(expression, context, familyValue('array', expression, context)), expression, context).value;
            const read = ({ owner = false, slots = false, standardPrototype = false, producer: { module = '', location: { range: [start = -1, end = -1] = [] } = {} } = {} } = {}) => {
                if (!slots || !standardPrototype) {
                    const { families = [], incomplete = true } = readFamily({ owner, ...observation });
                    const noniterable = !incomplete && families.length && families.every(family => ['number', 'boolean', 'nullish'].includes(family));

                    return noniterable ? promised(outcomes.thrown(continuation), expression, context).value : unresolved();
                }

                const { module: origin = '', location: { range: [from = -1, to = -1] = [] } = {} } = expression;
                // A literal produced inside the call has no surviving array alias.
                const local = start >= from && end <= to && start >= 0 && end >= start && module === origin;
                const payloads = slots.map((value) => {
                    const { suspensionSafe = false } = value ? value : {};

                    return (owned || local) && suspensionSafe ? value : valueModel.retire(value);
                });
                const settlement = settlements.aggregate(payloads, key, (input, point = '') => opaque(expression, context, false, { input, point }), {
                    absent: absentValue, unknown: unknownValue, settled, array: slots => arrayValue(slots, true),
                    record: (status, value) => normalValue({ owner: createOwner({ evidence: record({ fields: [
                        { name: 'status', owner: ownerForValue(normalValue({ owner: nativeOwner('string'), constant: Object.freeze({ value: status }),
                            truth: 1, absence: 'present', promise: 'none' }), observation) },
                        { name: status === 'fulfilled' ? 'value' : 'reason', owner: ownerForValue(value, observation) }
                    ] }) }), plain: true, standardPrototype: true, truth: 1, absence: 'present', promise: 'none' })
                }, observation);

                return promised(settlement, expression, context).value;
            };
            const value = valueModel.selectSource(input, read, unresolved, selection);
            const { effects = 0 } = settlements.resolve(value, key, (input, point = '') => opaque(expression, context, false, { input, point }), observation);

            return outcomes.outcome({ value, normal: 1, effects });
        };
        const memberCallStep = (current = {}) => {
            const { expression = {}, context = {}, gate = 1, key = '' } = current;
            const { callee = {}, argumentFresh = [], argumentStable = [], argumentMetadata = [], module = '', construct = false } = expression;

            return then(selectTask(callee, context, gate), (selected) => {
                if (!normalOf(selected)) return { value: selected };

                const callableCases = valueModel.casesFor(valueOf(selected), 'callable', selection);

                return argumentsStep(current, selected, (state) => {
                    const { prefix: completed = {}, arguments: available = [], effects: argumentEffects = 0 } = state;

                    // Construction evaluates its reference and arguments in
                    // order; an unknown constructor does not lend call semantics.
                    if (construct) return { value: outcomes.sequence(completed, opaque(expression, context), selection) };

                    const { location = {} } = expression;
                    const operations = memberProofs.get(`${indexOf(callee)}:${indexOf(context)}`) || [];
                    const receiverConflict = [...operations].some(({ conflicts = [] } = {}) => conflicts.length);

                    // Existing receiver obligations own those contradictions;
                    // a failed native lookup is not another
                    // independent callee contract at the same use.
                    if (!receiverConflict) requireCallable({ value: valueOf(selected), gate: normalOf(completed), key, expression, context, location });

                    consumeCallable(valueOf(selected), expression, context, normalOf(completed));

                    const plans = callableCases.map(({ callable = false, gate: chosen = 1 } = {}, index) => {
                        const reach = and(normalOf(completed), chosen);

                        if (!reach) return { value: empty };

                        const branch = { ...state, prefix: outcomes.restrict(completed, chosen, selection), arguments: available.map(value => valueModel.restrict(value, chosen, selection)) };
                        const { prefix = {}, arguments: inputs = [] } = branch;

                        if (!callable) {
                            return { value: outcomes.sequence(prefix, opaque(expression, context), selection) };
                        }

                        const { functionModel = false, native = '', lookup = false, receiver = false, nativePromise = false,
                            factory = '', predicate = '', truthOf = false, objectTag = false, stringify = false, receiverBound = false } = callable;
                        const alternative = `${key}:callee:${index}`;

                        if (functionModel) {
                            return invokeStep({ ...current, key: alternative, site: key, expression: { ...expression, function: callable } }, branch);
                        }

                        // A native method's family contract belongs to its
                        // receiver-bearing call. Extracting the callable does
                        // not preserve the receiver that established it.
                        if ((native || receiverBound) && lookup !== callee) return { value: outcomes.sequence(prefix, opaque(expression, context), selection) };

                        if (stringify && inputs.length > 1) return { value: outcomes.sequence(prefix, opaque(expression, context, unknownValue), selection) };

                        if (stringify) {
                            const input = inputs.at(0) || absentValue;
                            const text = familyValue('string', expression, context);
                            const resultFor = (value) => {
                                const { absence = 'unknown', constant = false } = value;

                                if (absence === 'undefined') return absentValue;

                                const { owner = false, memberOwner = false, plain = false, standardPrototype = false } = valueModel.evidenceFor(value, selection);
                                const { families = [], incomplete = true } = readFamily({ owner, ...observation });
                                const scalar = !incomplete && families.length && families.every(family => ['string', 'number', 'boolean'].includes(family));

                                if (scalar || (constant && Reflect.get(constant, 'value') === null)) return text;

                                if (!plain || !standardPrototype) return false;

                                const { cases = [] } = readField({ owner: memberOwner, name: 'toJSON', ...observation });

                                return cases.length && cases.every(({ state = '' } = {}) => state === 'absent') ? text : false;
                            };
                            const known = resultFor(input);
                            const selected = known || valueModel.selectSource(input, value => resultFor(value) || unknownValue, () => unknownValue, selection);
                            const primitive = !known ? ['string', 'number', 'boolean'].reduce((gate, family) => (
                                or(gate, valueModel.typeGate(input, family, 0, selection, 'family'))
                            ), 0) : 0;
                            const retained = primitive && and(primitive, not(valueModel.typeGate(selected, 'string', 0, selection, 'family')));
                            const value = retained ? valueModel.joined([valueModel.restrict(selected, not(retained), selection),
                                valueModel.restrict(text, retained, selection)]) : selected;

                            return { value: outcomes.sequence(prefix, opaque(expression, context, value), selection) };
                        }

                        if (objectTag) {
                            const input = inputs.at(0) || absentValue;
                            const harmless = valueModel.typeGate(input, '', 0, selection, 'tag-inert');
                            const value = normalValue({ owner: nativeOwner('string'), objectTagOf: input, absence: 'present', truth: 1, promise: 'none' });
                            const produced = outcomes.join(outcomes.restrict(outcomes.complete(value), harmless, selection),
                                outcomes.restrict(opaque(expression, context, value), not(harmless), selection));

                            return { value: outcomes.sequence(prefix, produced, selection) };
                        }

                        if (['call', 'apply'].includes(native)) return protocolStep({ ...current, key: alternative, site: key }, branch, native, receiver);

                        if (collectionMethods.has(native)) return collectionStep({ ...current, key: alternative, site: key }, branch, native, receiver);

                        if (native === 'split') {
                            const ordinaryInput = (input, position) => {
                                const { standardPrototype = false } = valueModel.evidenceFor(input, selection);
                                const regexp = !position && standardPrototype ? valueModel.typeGate(input, 'regexp', 0, selection, 'family') : 0;
                                const allowed = ['string', 'number', 'boolean', 'bigint', 'nullish'].reduce((gate, family) => (
                                    or(gate, valueModel.typeGate(input, family, 0, selection, 'family'))
                                ), regexp);

                                return !and(normalOf(prefix), not(allowed));
                            };
                            const ordinary = inputs.slice(0, 2).every(ordinaryInput);
                            const value = ordinary ? normalValue({ ...familyValue('array', expression, context), standardPrototype: true }) : unknownValue;

                            return { value: outcomes.sequence(prefix, ordinary && !argumentEffects ? outcomes.complete(value) : opaque(expression, context, value), selection) };
                        }

                        const { constant = false } = inputs.at(0) ?? {};
                        const position = inputs.length ? constant && Reflect.get(constant, 'value') : 0;

                        if (native === 'at' && Number.isSafeInteger(position) && !argumentEffects) {
                            const value = valueModel.selectSlot(receiver, position, absentValue, () => sourceValue({ ...unknown, ...expression }, context), selection);

                            return { value: outcomes.sequence(prefix, outcomes.complete(value), selection) };
                        }

                        if (truthOf) return { value: outcomes.sequence(prefix, outcomes.complete(truthValue(inputs.at(0) || absentValue)), selection) };

                        if (predicate) {
                            const input = inputs.at(0) || absentValue;
                            const unknownMatch = familyCondition(input, predicate, context, true) || condition(expression, context, 'truth');
                            const truthGate = valueModel.typeGate(input, predicate, unknownMatch, selection, 'family');
                            const value = normalValue({ owner: nativeOwner('boolean'), absence: 'present', promise: 'none', truthGate });

                            return { value: outcomes.sequence(prefix, opaque(expression, context, value), selection) };
                        }

                        if (nativePromise === 'reject') {
                            const input = inputs.at(0) || absentValue;
                            const { borrowed = false } = valueModel.evidenceFor(input, selection);
                            const stable = argumentFresh.at(0) || (argumentStable.at(0) && !borrowed);
                            const selected = stable ? input : valueModel.retire(input);

                            return { value: outcomes.sequence(prefix, promised(outcomes.thrown(outcomes.complete(selected)), expression, context), selection) };
                        }

                        if (nativePromise === 'resolve') {
                            const input = inputs.at(0) || absentValue;
                            const { borrowed = false } = valueModel.evidenceFor(input, selection);
                            const stable = argumentFresh.at(0) || (argumentStable.at(0) && !borrowed);
                            const selected = stable ? input : valueModel.retire(input);

                            // Resolve returns an intact native input itself, creates
                            // a fresh envelope for a nonpromise, and may alias an
                            // opaque input. Keep those ownership cases guarded.
                            const intact = valueModel.typeGate(selected, '', 0, selection, 'protocol');
                            const ordinary = valueModel.typeGate(selected, 'none', 0, selection, 'promise');
                            const exposed = not(or(intact, ordinary));
                            const preserved = stable ? selected : valueModel.borrowWithin(selected,
                                { ...argumentMetadata.at(0), module }, selection, observation);
                            const existing = outcomes.restrict(outcomes.complete(preserved), intact, selection);
                            const fresh = ordinary ? promised(resolve(selected, expression, context, ordinary), expression, context) : empty;
                            const possible = exposed ? outcomes.sequence(opaque(expression, context, false, { point: 'resolve:constructor' }),
                                promised(resolve(selected, expression, context, exposed), expression, context, { protocolUnknown: true, borrowed: true }), selection) : empty;
                            const result = outcomes.join(existing, outcomes.join(outcomes.restrict(fresh, ordinary, selection),
                                outcomes.restrict(possible, exposed, selection)));

                            return { value: outcomes.sequence(prefix, result, selection) };
                        }

                        if (nativePromise && !['all', 'allSettled'].includes(nativePromise)) {
                            return { value: outcomes.sequence(prefix, unknownPromise(expression, context), selection) };
                        }

                        const aggregate = ['all', 'allSettled'].includes(nativePromise);

                        if (aggregate) return { value: outcomes.sequence(prefix, aggregateValue(inputs.at(0) || absentValue, {
                            key: `${alternative}:${indexOf(context)}`, settled: nativePromise === 'allSettled', fresh: argumentFresh.at(0), stable: argumentStable.at(0),
                            expression, context
                        }), selection) };

                        const family = nativePromise ? 'array' : factory || nativeResultFamily.get(native);
                        const owner = family && nativeOwner(family);
                        const fallback = native === 'forEach' ? absentValue : false;
                        const value = owner ? normalValue({ ...familyValue(family, expression, context), standardPrototype: true }) : fallback;
                        const produced = ['trim', 'toLowerCase', 'toUpperCase'].includes(native) ? outcomes.complete(value) : opaque(expression, context, value);
                        const settled = nativePromise ? outcomes.sequence(produced, resolve(value, expression, context), selection) : produced;

                        return { value: outcomes.sequence(prefix, nativePromise ? promised(settled, expression, context) : produced, selection) };
                    });
                    const waiting = plans.flatMap(({ dependencies = [] } = {}) => dependencies);

                    if (waiting.length) return { dependencies: waiting };

                    const unfinished = plans.some(({ value = false } = {}) => !value);

                    if (unfinished) return { dependencies: [] };

                    const incomplete = callableCases.some(({ callable = false, gate: chosen = 1 } = {}) => (
                        and(normalOf(completed), chosen) && (!callable || !Object.hasOwn(callable, 'signature'))
                    ));

                    const unresolved = incomplete ? outcomes.called(empty, { key,
                        call: Object.freeze({ eligible: false, cause: Object.freeze({ reason: 'A callee alternative has no authored signature' }) }) }) : empty;

                    return { value: plans.map(({ value = {} } = {}) => value).reduce((left, right) => outcomes.join(left, right), unresolved) };
                });
            });
        };
        const lifetimeStep = ({ expression = {}, context = {}, gate = 1 } = {}) => {
            const { call = false, prior = false, ordered = false, discardResult = false, adopted = false, subject = false } = expression;
            const { model = false } = context;
            const execution = call && executionOf(call);
            const foreign = execution && (!model || execution !== executionOf(model));
            const owner = foreign && (environments.contextFor(context, execution) ||
                (moduleExecutions.has(execution) && contextFor(execution, standalone)));

            // A captured predecessor belongs to its lexical invocation. Module
            // sources may use their standalone context; an unrelated child can
            // never certify missing owner work or supply its argument facts.
            if (owner) return then(selectTask(expression, owner), entry => ({ value: entry }));

            const previous = prior && selectTask(prior, context, gate);
            const input = (adopted || subject) && selectTask(adopted || subject, context, gate);
            const waiting = [previous, input].filter(Boolean).flatMap(need);

            if (waiting.length) return { dependencies: waiting };

            const { truthGate: priorGate = 0 } = previous ? valueOf(read(previous)) : { truthGate: 1 };

            const source = input && valueOf(read(input));
            const { promiseIdentity = '' } = source ? valueModel.evidenceFor(source, selection) : {};
            const native = source ? lifetimeGate(source, 'protocol') : 0;

            if (adopted) return { value: outcomes.complete(normalValue({ owner: nativeOwner('boolean'), truthGate: and(native, priorGate), absence: 'present' })) };

            if (!priorGate || !call) return { value: outcomes.complete(normalValue({ owner: nativeOwner('boolean'), truth: 0, absence: 'present' })) };

            // Standalone source queries have no enclosing flow walk to evaluate
            // earlier operations. Demand the acquired predecessor before using
            // its outcome as lifetime evidence; cache absence is not retirement.
            // Execution-owned contexts keep their reached-site semantics below.
            const predecessor = standalone.get(executionOf(call)) === context && selectTask(call, context, gate);
            const missing = predecessor ? need(predecessor) : [];

            if (missing.length) return { dependencies: missing };

            const sites = valueSites.get(call);
            const recorded = sites && sites.get(context);
            const key = keyOf(predecessor || task(call, context));
            const keys = recorded ? [...recorded] : [key].filter(candidate => values.has(candidate));
            const executing = model && executionOf(call) === executionOf(model) && entered.has(keyOf(functionTask(model, context)));
            const preserved = (keys.length || (ordered && executing)) ? keys.reduce((preserved, key) => {
                const entry = outcomes.restrict(values.get(key), gate, selection);
                const { normal = 0, effects = 0, thrown = 0, uncertain = 0, unresolved = false } = entry;

                if (!normal && !effects && !thrown && !uncertain && !unresolved) return preserved;

                const value = valueOf(entry);
                const { promiseIdentity: returned = '' } = valueModel.evidenceFor(value, selection);
                const primitive = value => lifetimeGate(value, 'primitive');
                const envelope = subject && lifetimeGate(value, 'protocol');
                const settled = envelope ? resolve(value, call, context, envelope) : empty;
                const { normal: fulfilled = 0, thrown: rejected = 0, uncertain: opaque = 0, unresolved: pending = false,
                    value: payload = false, error = false } = settled;
                const delivered = pending ? 0 : and(envelope, and(not(opaque), and(or(not(fulfilled), primitive(payload)), or(not(rejected), primitive(error)))));
                // Temporary permission ends when adoption publishes its result.
                // Afterwards each guarded alternative must deliver primitives or
                // consume this same established native envelope.
                const preservedResult = discardResult ? 1 : or(primitive(value), or(delivered, promiseIdentity && promiseIdentity === returned ? native : 0));
                const invalid = [effects, thrown, uncertain, unresolved ? normal : and(normal, not(preservedResult))].reduce((left, right) => or(left, right), 0);

                return and(preserved, not(invalid));
            }, priorGate) : 0;

            return { value: outcomes.complete(normalValue({ owner: nativeOwner('boolean'), truthGate: preserved, absence: 'present' })) };
        };
        const assignmentStep = ({ expression = {}, context = {}, gate = 1 } = {}) => {
            const { target = {}, argument = {}, name = '' } = expression;

            return then(selectTask(target, context, gate), (receiver) => {
                if (!normalOf(receiver)) return { value: receiver };

                return then(selectTask(argument, context, and(gate, normalOf(receiver))), (right) => {
                    const prefix = outcomes.follow(receiver, right);
                    const { plain = false, memberOwner: owner = false } = valueModel.evidenceFor(valueOf(receiver), selection);
                    const { cases = [] } = readField({ owner, name, ...observation });
                    const written = plain && !effectsOf(right) && (cases.every(({ state = '' } = {}) => state === 'present') || !objectPrototypeMembers.has(name));
                    const input = valueOf(right) || unknownValue;
                    const value = normalValue({ ...input, owner: false, input, inputs: [], written });
                    const completed = written ? outcomes.outcome({ normal: 1, effects: 1, value }) : opaque(expression, context, value);

                    return { value: outcomes.sequence(prefix, completed, selection) };
                });
            });
        };
        const revisionStep = ({ expression = {}, context = {}, gate = 1 } = {}) => {
            const { argument = {}, revision = {} } = expression;

            return then(selectTask(argument, context, gate), (entry) => {
                if (!normalOf(entry)) return { value: entry };

                const key = `${indexOf(revision)}:${indexOf(context)}`;
                const writes = capabilityWrites.get(key) || put(capabilityWrites, key, new Map());

                // Guard demand already forgets opaque completion choices. Use
                // that same projection for successfully reached binding writes.
                put(writes, expression, or(writes.get(expression) || 0, valueGate(normalOf(entry))));
                // Acquire the version in execution order. Deferring variables
                // until a later join can make the decision graph exponential.
                condition(expression, context, 'callable');
                tick('capability-write');

                return { value: outcomes.outcome({ ...entry, effects: or(effectsOf(entry), normalOf(entry)) }) };
            });
        };
        const effectStep = ({ expression = {}, context = {}, gate = 1 } = {}) => {
            const { argument = {}, binding = false, nativePattern = false, objectPattern = false, formalPattern = false, initializes = false } = expression;

            return then(selectTask(argument, context, gate), (entry) => {
                if (normalOf(entry) && (initializes || captureInputs.has(argument))) {
                    const captured = initializerValues.get(argument) || put(initializerValues, argument, new WeakMap());
                    const { value: previous = false, reach = 0 } = captured.get(context) ?? {};

                    // Entry reach distinguishes a skipped declaration from an
                    // initializer's abrupt completion. Pattern descriptors can
                    // precede that initializer, so its failure is not a new input.
                    put(captured, context, { value: valueModel.joined([previous, valueOf(entry)]), reach: or(reach, valueGate(gate)) });
                }

                if (!binding || !normalOf(entry)) return { value: outcomes.outcome({ ...entry, value: false, returns: false }) };

                const { nullishGate = 0 } = valueOf(entry) ?? {};
                const failed = formalPattern ? nullishGate : 0;

                // Only unsupported source contributions retain an opaque binding
                // step. Initializer failure, effects and calls keep their order.
                const unresolved = nativePattern ? valueModel.selectSlots(valueOf(entry), () => false, () => absentValue, selection) : absentValue;
                const unproved = objectPattern ? valueModel.selectSource(valueOf(entry), ({ plain = false } = {}) => plain ? false : absentValue,
                    () => absentValue, selection) : unresolved;
                const { reach = 0 } = unproved ? unproved : {};
                const completion = reach ? outcomes.join(outcomes.restrict(opaque(expression, context, absentValue), reach, selection),
                    outcomes.restrict(continuation, not(reach), selection)) : continuation;

                const completed = formalPattern ? outcomes.join(outcomes.thrown(outcomes.outcome({ ...outcomes.restrict(entry, failed, selection), value: unknownValue })),
                    outcomes.sequence(outcomes.restrict(entry, not(failed), selection), completion, selection)) : outcomes.sequence(entry, completion, selection);

                return { value: outcomes.outcome({ ...completed, value: false, returns: false }) };
            });
        };
        const abruptStep = ({ expression = {}, context = {}, gate = 1 } = {}) => {
            const { argument = {}, kind = '', location = {} } = expression;
            const { kind: argumentKind = '', operator = '' } = argument;

            return then(selectTask(argument, context, gate), entry => ({
                value: kind === 'return' ? outcomes.returned(entry, location, argumentKind === 'logical' ? operator : '') : outcomes.thrown(entry)
            }));
        };
        const tryStep = ({ expression = {}, context = {}, gate = 1 } = {}) => {
            const { block = {}, handler = false, binding = false, finalizer = false } = expression;

            return then(selectTask(block, context, gate), (initial) => {
                // Opaque continuation still needs proof. Preserve that uncertainty
                // before routing possible failure through the handler; admitting
                // the handler cannot establish an unproved try-side return.
                // A call boundary already reached retains its own evidence.
                const uncertain = handler ? valueGate(uncertainOf(initial)) : 0;
                const { calls = false } = initial;
                const established = uncertain ? outcomes.outcome({ ...outcomes.restrict(initial, not(uncertain), selection), calls }) : initial;
                const thrown = or(thrownOf(established), and(gate, uncertain));
                const caught = handler && thrown ? selectTask(handler, context, and(gate, thrown)) : false;
                const waiting = caught ? need(caught) : [];

                if (caught && binding) {
                    const bindings = caughtValues.get(context) || put(caughtValues, context, new Map());
                    const { error = false } = established;
                    const { reach: payload = 0 } = error ? error : {};
                    const missing = and(valueGate(thrown), not(payload));
                    const supplied = valueModel.joined([error, valueModel.restrict(unknownValue, missing, selection)]);

                    put(bindings, binding, valueModel.joined([bindings.get(binding), supplied]));
                }

                if (waiting.length) return { dependencies: waiting };

                const protectedEntry = uncertain ? outcomes.join(established,
                    outcomes.restrict(unsupported(expression, context), and(gate, uncertain), selection)) : established;
                const handled = caught ? outcomes.caught(protectedEntry, read(caught), selection) : protectedEntry;
                const { normal = 0, returned = 0, thrown: failure = 0, broken = 0, continued = 0 } = handled;
                const reached = or(or(or(normal, returned), failure), or(broken, continued));

                if (!finalizer || !reached) return { value: handled };

                return then(selectTask(finalizer, context, and(gate, reached)), cleanup => ({ value: outcomes.finalized(handled, cleanup, selection) }));
            });
        };
        const doStep = ({ expression = {}, context = {}, gate = 1 } = {}) => {
            const { body = {}, test = {} } = expression;

            return then(selectTask(body, context, gate), (entry) => {
                const { normal = 0, broken = 0, continued = 0 } = entry;
                const exits = outcomes.outcome({ ...entry, normal: broken, broken: 0, continued: 0, value: false });
                const reachesTest = or(normal, continued);

                if (!reachesTest) return { value: exits };

                return then(selectTask(test, context, reachesTest), (tested) => {
                    const testedValue = valueOf(tested) || unknownValue;
                    const { truthGate = 0 } = testedValue;
                    const repeat = outcomes.restrict(unsupported(expression, context, 1), truthGate, selection);
                    const stopped = outcomes.restrict(continuation, not(truthGate), selection);
                    const tail = outcomes.sequence(tested, outcomes.join(stopped, repeat), selection);

                    return { value: outcomes.join(exits, outcomes.restrict(tail, reachesTest, selection)) };
                });
            });
        };
        const handlers = new Map([
            ['source', sourceStep], ['opaque', ({ expression = {}, context = {}, gate = 1 } = {}) => {
                const { prefix = false } = expression;

                return prefix ? then(selectTask(prefix, context, gate), entry => ({ value: outcomes.sequence(entry, opaque(expression, context), selection) }))
                    : { value: opaque(expression, context) };
            }],
            ['capture', ({ expression = {}, context = {}, gate = 1 } = {}) => {
                const { provider = false, position = -1, staticRecord = false, target = {} } = expression;
                const owner = environments.contextFor(context, provider);
                const { kind = '', target: initializer = false, entryBound = false } = target;
                const unresolved = () => outcomes.complete(sourceValue({ ...unknown, ...expression }, context));

                if (!owner && staticRecord) return then(selectTask(target, context), entry => ({ value: outcomes.complete(valueOf(entry)) }));

                if (!owner) return { value: unresolved() };

                if (kind === 'link') {
                    const values = captureInputs.has(initializer) && initializerValues.get(initializer);
                    const { value = false } = (values && values.get(owner)) ?? {};

                    return { value: value ? outcomes.complete(valueModel.escape(value, selection, { protocol: !invocationAt(context, owner) })) : unresolved() };
                }

                const { transferred = [] } = owner;

                const complete = value => ({ value: outcomes.complete(position >= 0 && transferred.at(position) ? value
                    : valueModel.escape(value, selection, { protocol: !invocationAt(context, owner) })) });

                // A premature capture must not evaluate a future default or
                // cache an unavailable parent binding task as its final value.
                if (entryBound) {
                    const captured = initializerValues.get(initializer);
                    const snapshot = captured && captured.get(owner);
                    const { value = false, reach = 0 } = snapshot ?? {};
                    const available = and(gate, reach);
                    const missing = and(gate, not(reach));
                    const initialized = value ? outcomes.restrict(complete(value).value, available, selection) : empty;
                    const absent = outcomes.complete(sourceValue({ ...unknown, ...expression }, context));
                    const unavailable = bindingFrames.has(owner) ? outcomes.thrown(absent) : absent;

                    return { value: outcomes.join(initialized, outcomes.restrict(unavailable, missing, selection)) };
                }

                return then(selectTask(target, owner), entry => complete(valueOf(entry)));
            }],
            ['caught', ({ expression = {}, context = {} } = {}) => {
                const { handler = false } = expression;
                const values = caughtValues.get(context);
                const value = values && values.get(handler);

                return { value: outcomes.complete(value || sourceValue({ ...unknown, ...expression }, context)) };
            }],
            ['parameter', parameterStep], ['parameter-entry', parameterEntryStep], ['selection', selectionStep], ['link', linkStep], ['module-value', moduleValueStep], ['sequence', sequenceStep],
            ['conditional', branchStep], ['logical', branchStep], ['branch', branchStep],
            ['call', callStep], ['await', awaitStep], ['unary', unaryStep], ['arithmetic', arithmeticStep], ['template', templateStep], ['boolean', booleanStep],
            ['effect', effectStep], ['return', abruptStep], ['throw', abruptStep], ['try', tryStep],
            ['lifetime', lifetimeStep], ['assignment', assignmentStep], ['revision', revisionStep], ['do', doStep],
            ['jump', ({ expression: { continued = false } = {} } = {}) => ({ value: outcomes.outcome({ broken: Number(!continued), continued: Number(continued) }) })],
            ['assigned', ({ expression = {}, context = {}, gate = 1 } = {}) => {
                const { target = {} } = expression;

                return then(selectTask(target, context, gate), (entry) => {
                    const { written = false } = valueOf(entry) ?? {};

                    return { value: written ? outcomes.complete(valueOf(entry)) : opaque(expression, context) };
                });
            }],
            ['array', arrayStep], ['record', recordStep], ['record-rest', recordRestStep], ['member', memberStep], ['member-call', memberCallStep],
            ['spread', ({ expression = {}, context = {}, gate = 1 } = {}) => {
                const { argument = {} } = expression;

                return then(selectTask(argument, context, gate), entry => ({ value: outcomes.sequence(entry, opaque(expression, context), selection) }));
            }],
            ['use', useStep],
            ['unowned', ({ expression: { target = {}, lifetime = false, protocolSafe = false, protocolLifetime = false } = {}, context = {}, gate = 1 } = {}) => (
                then(selectTask(target, context, gate), (entry) => {
                    const value = valueOf(entry) || unknownValue;
                    const preserve = (proof = {}, protocol = {}) => {
                        const proven = valueOf(proof);
                        const { truthGate = 0 } = proven ? proven : {};
                        const established = valueOf(protocol);
                        const { truthGate: protocolGate = Number(protocolSafe && !protocolLifetime) } = established ? established : {};
                        const retired = valueModel.restrict(value, not(truthGate), selection);
                        const selected = valueModel.joined([valueModel.restrict(value, truthGate, selection),
                            valueModel.retire(valueModel.restrict(retired, protocolGate, selection)),
                            valueModel.retire(valueModel.restrict(retired, not(protocolGate), selection), { protocol: true })]);

                        return { value: outcomes.outcome({ ...entry, value: selected }) };
                    };

                    const after = proof => protocolLifetime ? then(selectTask(protocolLifetime, context, gate), protocol => preserve(proof, protocol)) : preserve(proof);

                    return lifetime ? then(selectTask(lifetime, context, gate), after) : after({});
                })
            )],
            ['copied-source', ({ expression: { target = {}, lifetimes = [] } = {}, context = {}, gate = 1 } = {}) => then(selectTask(target, context, gate), (entry) => {
                const proofs = lifetimes.map(({ proof = {}, deep = false } = {}) => ({ task: selectTask(proof, context, gate), deep }));
                const waiting = proofs.flatMap(({ task = {} } = {}) => need(task));

                if (waiting.length) return { dependencies: waiting };

                const intact = mode => proofs.filter(({ deep = false } = {}) => deep === mode).reduce((gate, { task = {} } = {}) => {
                    const proven = valueOf(read(task));
                    const { truthGate = 0 } = proven ? proven : {};

                    return and(gate, truthGate);
                }, 1);
                const shallow = intact(false);
                const deep = intact(true);
                const value = valueOf(entry) || unknownValue;

                return { value: outcomes.outcome({ ...entry, value: valueModel.joined([
                    valueModel.restrict(value, and(shallow, deep), selection),
                    retireCopiedFields(valueModel.restrict(value, and(not(shallow), deep), selection)),
                    valueModel.retire(valueModel.restrict(value, not(deep), selection), { protocol: true })
                ]) }) };
            })],
            ['continue', () => ({ value: continuation })], ['unsupported', ({ expression = {}, context = {} } = {}) => ({ value: unsupported(expression, context, 1) })]
        ]);
        const step = (current) => {
            const { model = false, expression = {}, context = {}, gate = 1 } = current;
            const { observations = [], closures = [] } = expression;

            closures.forEach((closure) => {
                const key = `${indexOf(closure)}:${indexOf(context)}`;

                put(closureCreations, key, or(closureCreations.get(key) || 0, gate));
                tick('closure-creation');
            });

            [expression, ...observations].forEach((observed) => {
                const { capabilities: subjects = [] } = observed;

                subjects.forEach((capability) => {
                    if (!gate) return;

                    const proofKey = `${indexOf(observed)}:${indexOf(context)}:${indexOf(capability)}`;
                    const previous = invocationProofs.get(proofKey);
                    const { guarded = true, executable = true } = previous ?? {};
                    const localSyntax = admittedAt(capability, context, observed, tick);
                    const callable = callableAt(capability, context, observed, tick);
                    const established = !and(gate, not(or(callable, localSyntax)));

                    // An enclosing opaque expression supplies an over-approximation
                    // of reach. It can prove dominance, never an unsafe invocation.
                    if (observed !== expression && !established) return;

                    const nextGuarded = guarded && established;
                    const nextExecutable = executable && !and(gate, not(callable));

                    if (previous && guarded === nextGuarded && executable === nextExecutable) return;

                    put(invocationProofs, proofKey, { guarded: nextGuarded, executable: nextExecutable });
                    tick('capability-use');
                });
            });

            return model ? functionStep(current) : handlers.get(kindOf(expression))(current);
        };

        // eslint-disable-next-line resilient/prefer-prototype-methods -- Ordered outcome demand uses a private frontier and publishes completed results only after observers succeed.
        while (pending.length) {
            const current = takeLast(pending);
            const key = keyOf(current);

            if (values.has(key)) continue;

            tick(statementOf(expressionOf(current)) ? 'flow-contribution' : 'value-demand');
            const { dependencies = [], value = false } = step(current);

            if (!value) {
                append(pending, current);
                dependencies.toReversed().forEach(child => append(pending, child));

                continue;
            }

            const { expression = false, context = {}, gate = 1 } = current;
            const produced = valueOf(value);
            const { identity = false } = produced ? produced : {};
            // Parameters and patterns capture a value once. Later reads reuse
            // that invocation's identity; ordinary member reads do not gain it.
            const { kind = '' } = expression ? expression : {};
            const { inputs = [], input = false } = produced ? produced : {};
            const { inputs: alternatives = [] } = input ? input : {};
            const joined = inputs.length || alternatives.length;
            const bound = produced && (['parameter', 'selection'].includes(kind) || (kind === 'link' && joined)) && !identity
                ? normalValue({ ...produced, identity: expression, identityContext: context }) : produced;
            const result = refine(bound, context, gate, selection);

            if (result && !valueOrigins.has(result) && expression) put(valueOrigins, result, current);

            const refined = result === valueOf(value) ? value : outcomes.outcome({ ...value, value: result });

            put(values, key, outcomes.restrict(refined, gate, selection));
            const { guarded = false } = expression ? expression : {};

            if (guarded) {
                const contexts = valueSites.get(expression) || put(valueSites, expression, new WeakMap());

                retain(contexts.get(context) || put(contexts, context, new Set()), key);
            }
        }

        return values.get(keyOf(root));
    };
    const useKeys = (expression, observation) => {
        const execution = executionOf(expression);
        const context = contextFor(execution);
        const model = executionModels.get(execution) || (executionOf(root) === execution && root);
        const { guarded = false } = expression;

        if (model && guarded) evaluate(functionTask(model, context), observation);

        const sites = valueSites.get(expression);
        const recorded = guarded && sites && sites.get(context);
        const { supported = false } = model ? model : {};

        if (recorded) return [...recorded];

        if (guarded && supported) return [];

        const selected = task(expression, contextFor(execution, standalone));

        evaluate(selected, observation);

        return [keyOf(selected)];
    };
    const atUse = (expression, observation) => {
        const keys = useKeys(expression, observation);

        return keys.length ? keys.map(key => values.get(key)).reduce((left, right) => outcomes.join(left, right), empty)
            : outcomes.outcome({ value: unknownValue, normal: 1, thrown: 1, unresolved: true });
    };
    const staticInputs = ({ kind = '', target = {}, familyOnly = false } = {}) => {
        const { familyOnly: targetFamily = false } = target;

        return (kind === 'link' && familyOnly) || (kind === 'unowned' && targetFamily) ? [target] : [];
    };
    const ownerFor = (expression) => {
        traverse(expression, { enter: current => expressionOwners.has(current) ? [] : staticInputs(current), leave: (current) => {
            if (expressionOwners.has(current)) return;

            const { kind = '', owner = false } = current;
            const [target = false] = staticInputs(current);
            const alias = target && expressionOwners.get(target);
            const independent = kind === 'source' ? owner : alias && (kind === 'unowned' || !proxies.has(alias)) && alias;

            if (kind === 'source') put(sources, owner, normalValue(current));

            if (independent) {
                put(expressionOwners, current, independent);

                return;
            }

            // Source-value consumers share an isolated boundary. Immutable
            // aliases reuse their source owner without an extra proxy or index.
            const selected = task(current, contextFor(executionOf(current), standalone));
            const proxy = createOwner({ evidence: unresolved({ reason: 'Undemanded source relationship' }) });

            put(proxies, proxy, selected);
            put(expressionOwners, current, proxy);
        } });

        return expressionOwners.get(expression);
    };
    const ensure = (owner, observation = {}, field = {}) => {
        copiedFieldValue(field);

        if (sources.has(owner)) return sources.get(owner);

        if (!proxies.has(owner)) return unknownValue;

        const selected = proxies.get(owner);
        const entry = atUse(expressionOf(selected), observation);
        const value = valueOf(entry) || unknownValue;
        const published = `published:${keyOf(selected)}`;

        if (values.has(published)) return values.get(published);

        const { owner: source = false, identity = false, identityContext = false } = valueModel.evidenceFor(value, () => {
            notify(observation, 'value-ownership');
        });
        const { identity: original = false, identityContext: originalContext = false } = value;

        replaceEvidence({ owner, evidence: reference({ owner: source }) });

        return put(values, published, identity === original && identityContext === originalContext ? value : normalValue({ ...value, identity, identityContext }));
    };
    const slotOwners = new WeakMap();
    const slotOwner = (owner, position, observation = {}) => {
        const input = ensure(owner, observation);
        const slots = slotOwners.get(input) || put(slotOwners, input, new Map());

        if (slots.has(position)) return slots.get(position);

        const value = valueModel.selectSlot(input, position, absentValue, () => unknownValue, () => notify(observation, 'value-selection'));

        return put(slots, position, ownerForValue(value, observation));
    };
    const defaulted = (owner, fallback, observation = {}) => {
        const actual = ensure(owner, observation);
        const replacement = fallbacks.get(fallback) || put(fallbacks, fallback, normalValue({ owner: fallback }));
        const selected = valueModel.replace(actual, 'defined', replacement, () => {
            notify(observation, 'value-selection');
        });

        return selected === actual ? { ...actual, owner } : { ...selected, owner: ownerForValue(selected, observation) };
    };
    const functionValue = (model, observation = {}) => {
        const entry = evaluate(functionTask(model, contextFor(executionOf(model))), observation);

        if (summaries.has(entry)) return summaries.get(entry);

        const returns = outcomes.describe(entry, () => {
            notify(observation, 'flow-result');
        });

        const own = (value) => {
            const { nullGate = 0, undefinedGate = 0 } = value;

            return { ...value, absences: Object.freeze([
                ...(nullGate ? ['null'] : []), ...(undefinedGate ? ['undefined'] : [])
            ]), ...valueModel.evidenceFor(value, () => {
                notify(observation, 'value-ownership');
            }) };
        };

        const { unresolved = false, thrown = 0 } = entry;

        return put(summaries, entry, Object.freeze({ ...own(valueOf(entry) || unknownValue), normal: unresolved ? 'unknown' : Boolean(normalOf(entry)),
            thrown: unresolved ? 'unknown' : Boolean(thrown), returns: Object.freeze(returns.map(({ value = {}, ...site } = {}) => Object.freeze({ ...site, value: own(value) }))) }));
    };

    const completionFor = (owner, observation = {}) => {
        if (!proxies.has(owner)) return Object.freeze({ normal: 'unknown', thrown: 'unknown' });

        const { normal = 0, thrown = 0, unresolved = false } = atUse(expressionOf(proxies.get(owner)), observation);

        return Object.freeze({ normal: unresolved ? 'unknown' : Boolean(normal), thrown: unresolved ? 'unknown' : Boolean(thrown) });
    };

    const parentOf = ({ parentExecution = false } = {}) => {
        if (executionOf(root) === parentExecution) return root;

        return executionModels.get(parentExecution);
    };
    // The same acquired flow and outcome evaluator can ask about body uses
    // after parameter initialization. This context never supplies source-value
    // or return contracts, which retain their opaque initializer boundary.
    const capabilityContextFor = ({ execution = false, supported = false, capabilitySupported = false } = {}) => (
        contextFor(execution, !supported && capabilitySupported ? capabilityContexts : generic)
    );
    const guardedCapture = (model, capability, observation, executableOnly) => {
        const keyFor = current => `${indexOf(current)}:${indexOf(capability)}:${executableOnly}`;

        traverse(model, {
            enter: current => current === root || captureProofs.has(keyFor(current)) ? [] : [parentOf(current)].filter(Boolean),
            leave: (current) => {
                if (current === root) return;

                const key = keyFor(current);

                if (captureProofs.has(key)) return;

                const parent = parentOf(current);
                const { mutable = false, execution: declaration = false } = capability;
                const inherited = parent && captureProofs.get(keyFor(parent));

                // Descendant closures retain the same immutable binding. An
                // established ancestor guard already covers every execution
                // in which the descendant can be created or invoked.
                if (!mutable && inherited === 'agreement') {
                    put(captureProofs, key, 'agreement');
                    notify(observation, 'capture-proof');

                    return;
                }

                const context = capabilityContextFor(parent);
                // A mutable capture also depends on writes after creation.
                // Only immutable bindings can stop at the creation prefix.
                const { localReader = false } = current;
                const prefix = !mutable && !localReader && capabilityPrefixes.get(current);

                const completed = parent && evaluate(prefix ? task(prefix, context) : functionTask(parent, context), observation);
                const { unresolved = true } = completed ? completed : {};

                const created = closureCreations.get(`${indexOf(current)}:${indexOf(context)}`) || 0;
                const creation = { ...current, execution: executionOf(parent) };
                const visit = kind => notify(observation, kind);
                const admitted = executableOnly ? 0 : admittedAt(capability, context, creation, visit);
                const callable = or(callableAt(capability, context, creation, visit), admitted);
                const writes = capabilityWrites.get(`${indexOf(capability)}:${indexOf(context)}`) || new Map();
                const changed = mutable && [...writes].some(([write = {}, reached = 0] = []) => later(write, creation) && and(created, reached));

                const callers = localInvocations.get(current);
                const local = !mutable && localReader && callers && callers.get(context);
                const invocationGuard = !unresolved && local && local.size === localReader && [...local].every(([invocation = {}, gate = 0] = []) => {
                    const admitted = executableOnly ? 0 : admittedAt(capability, context, invocation, visit);
                    const callable = or(callableAt(capability, context, invocation, visit), admitted);

                    return !and(gate, not(callable));
                });
                const guarded = !changed && (!and(created, not(callable)) || inherited === 'agreement' || invocationGuard);

                // A generic intermediate body cannot establish that its own
                // creation was reached. Preserve that missing ancestor proof;
                // a local guard can still establish agreement independently.
                const missingAncestor = inherited === 'unknown' && executionOf(parent) !== declaration;
                const unguarded = missingAncestor ? 'unknown' : 'contradiction';
                const status = guarded ? 'agreement' : unguarded;

                put(captureProofs, key, created ? status : 'unknown');
                notify(observation, 'capture-proof');
            }
        });

        return captureProofs.get(keyFor(model));
    };
    const regionProofFor = (expression, model, capability, observation) => {
        const { mutable = false } = capability;
        const region = !mutable && capabilityRegions.get(expression);

        if (!region) return {};

        // An immutable binding can establish a local branch proof on any loop
        // iteration. Its outcome never supplies loop or function completion.
        const local = regionContexts.get(region) || put(regionContexts, region, createContext({ model, bodyOnly: true }));

        put(contexts, `region:${indexOf(region)}`, local);
        evaluate(task(region, local), observation);

        return invocationProofs.get(`${indexOf(expression)}:${indexOf(local)}:${indexOf(capability)}`) || {};
    };
    const checkCapability = ({ expression = {}, capability = false, observation = {}, executableOnly = false } = {}) => {
        const { execution = false } = expression;
        const model = executionModels.get(execution);
        const { supported = false, capabilitySupported = false, promiseResult = false } = model ?? {};

        if (!capability || !(supported || capabilitySupported)) return Object.freeze({ status: 'unknown', reason: 'Invocation requires stable identity and supported completion evidence' });

        const context = capabilityContextFor(model);
        const { execution: declaration = false, mutable = false } = capability;
        const parent = declaration !== execution && !mutable && parentOf(model);

        // An immutable callable guarded before closure creation stays callable
        // throughout that closure. This proof needs the creation boundary,
        // not every branch of a generic execution of the closure's body.
        if (parent && guardedCapture(model, capability, observation, executableOnly) === 'agreement') {
            return Object.freeze({ status: 'agreement', reason: 'Stable capability guarded at closure creation or every closed local invocation' });
        }

        const prefix = capabilityPrefixes.get(expression);

        evaluate(prefix ? task(prefix, context) : functionTask(model, context), observation);
        const proof = invocationProofs.get(`${indexOf(expression)}:${indexOf(context)}:${indexOf(capability)}`);

        const { guarded: localGuard = false, executable: localExecutable = false } = proof ? {} : regionProofFor(expression, model, capability, observation);

        if (executableOnly ? localExecutable : localGuard) return Object.freeze({ status: 'agreement', reason: 'Stable capability guarded within the acquired branch' });

        if (!proof) return Object.freeze({ status: 'unknown', reason: 'Invocation was not reached by supported completion evaluation' });

        const { guarded: admitted = false, executable = false } = proof;
        const guarded = executableOnly ? executable : admitted;

        if (!guarded && unsupportedGuards.has(`${indexOf(capability)}:${indexOf(context)}`)) return Object.freeze({
            status: 'unknown', reason: 'A resolved predicate body is outside callable guard proof'
        });

        if (declaration !== execution && mutable && promiseResult) return Object.freeze({ status: 'unknown', reason: 'Mutable capture across asynchronous execution requires suspension evidence' });

        if (!guarded && declaration !== execution) {
            const status = guardedCapture(model, capability, observation, executableOnly);

            const missing = mutable ? 'Captured invocation has no callable guard that survives binding writes' : 'Captured invocation has no guard at closure creation';
            const reason = status === 'contradiction' ? missing : 'Captured invocation requires closure creation evidence';

            return Object.freeze({ status, reason: status === 'agreement' ? 'Stable capability guarded at closure creation or every closed local invocation' : reason });
        }

        return Object.freeze({ status: guarded ? 'agreement' : 'contradiction', reason: guarded ? 'Dominating callable guard' : 'Invocation has no dominating callable guard' });
    };
    const checkInvocation = (expression, observation = {}) => {
        const { invocation = false } = expression;

        return checkCapability({ expression, capability: invocation, observation });
    };

    const authoredContext = (model, observation) => {
        const { hasDefaults = false } = model;

        if (!hasDefaults) return false;

        const context = authored.get(model) || put(authored, model, createContext({ model, defaults: true }));

        put(contexts, `authored:${indexOf(model)}`, context);
        evaluate(functionTask(model, context), observation);

        return context;
    };
    const sourceBoundaries = new WeakMap();
    const sourcesFor = (model, observation) => {
        if (sourceBoundaries.has(model)) return sourceBoundaries.get(model);

        const visited = new Set();
        const boundaries = new Set();

        traverse(model, { enter: (current) => {
            if (visited.has(current)) return [];

            retain(visited, current);
            const callers = [...(invocationSources.get(current) || [])].map(execution => executionModels.get(execution) || (executionOf(root) === execution && root)).filter(Boolean);

            return [...callers, parentOf(current)].filter(Boolean).filter(candidate => !visited.has(candidate));
        }, leave: (current) => {
            const context = contextFor(executionOf(current));

            evaluate(functionTask(current, context), observation);
            retain(boundaries, indexOf(context));
            const absent = authoredContext(current, observation);

            if (absent) retain(boundaries, indexOf(absent));
        } });

        return put(sourceBoundaries, model, { boundaries });
    };
    const contextsForUse = (expression, observation) => {
        const execution = executionOf(expression);
        const model = executionModels.get(execution) || (executionOf(root) === execution && root);
        // eslint-disable-next-line resilient/prefer-safe-destructuring-defaults -- Source discovery owns this required cache record; a default would conceal an internal failure.
        const { boundaries, contexts: previous = false, size: previousSize = -1 } = sourcesFor(model, observation);
        const available = modelContexts.get(model);
        const size = available ? available.size : 0;

        if (previous && previousSize === size) return previous;

        notify(observation, 'source-context-selection');
        const selected = [...(available || [])].filter(({ boundary = -1 } = {}) => boundaries.has(boundary));

        put(sourceBoundaries, model, { boundaries, contexts: selected, size });

        return selected;
    };
    const useValues = new WeakMap();
    const useValue = (expression, site = expression, observation = {}) => {
        const source = ownerFor(expression);

        if (!proxies.has(source)) return source;

        const cached = useValues.get(expression) || put(useValues, expression, new WeakMap());

        if (cached.has(site)) return cached.get(site);

        const entries = contextsForUse(site, observation).flatMap((context) => {
            const { guarded = false } = site;
            const recorded = valueSites.get(site);
            const keys = recorded && recorded.get(context);

            if (guarded && !keys) return [];

            const reached = keys ? [...keys].map(key => values.get(key)) : [evaluate(task(site, context), observation)];

            return reached.filter(normalOf).map(entry => expression === site ? valueOf(entry)
                : valueOf(evaluate(task(expression, context, normalOf(entry)), observation)));
        });
        // Source agreements consume each reached producer, not a flow value
        // joining truth/absence decisions across separate invocation contexts.
        const owners = [...new Set(entries.map(value => ownerForValue(value, observation)))];
        const owner = owners.length > 1 ? createOwner({ evidence: producer({ owners }) }) : owners.at(0) || unknownSource;

        return put(cached, site, owner);
    };
    const checkMember = (queried, observation = {}) => {
        const { kind = '', target = queried } = queried;
        const expression = kind === 'copied-source' ? target : queried;
        const execution = executionOf(expression);
        const context = contextFor(execution);
        const key = `${indexOf(expression)}:${indexOf(context)}`;

        if (memberQueries.has(key)) return memberQueries.get(key);

        const contexts = contextsForUse(expression, observation);
        const proofs = [...(memberProofs.get(key) || [])];
        const operations = contexts.flatMap(context => (
            [...(memberProofs.get(`${indexOf(expression)}:${indexOf(context)}`) || [])]
        ));
        const [{ expected = '' } = {}] = operations;
        const conflicts = [...new Set(operations.flatMap(({ conflicts = [] } = {}) => conflicts))].toSorted();
        const producers = new Map();
        const visited = new Set();

        operations.forEach(({ producers: root = false } = {}) => {
            if (!root) return;

            traverse(root, { enter: ({ source = false, owner = false, inputs = [] } = {}) => {
                const current = inputs;

                if (visited.has(current)) return [];

                retain(visited, current);

                if (!source) return inputs;

                const { families = [] } = readFamily({ owner, ...observation });

                if (families.some(family => conflicts.includes(family))) put(producers, JSON.stringify(source), source);

                return inputs;
            } });
        });
        const violations = [...new Set(operations.map(({ name = '' } = {}) => name))].flatMap((name) => {
            const matching = operations.filter(({ name: candidate = '' } = {}) => candidate === name);
            const [{ expected = '' } = {}] = matching;
            const conflicts = [...new Set(matching.flatMap(({ conflicts = [] } = {}) => conflicts))].toSorted();

            return conflicts.length ? [{ name, expected, conflicts: Object.freeze(conflicts) }] : [];
        });
        const names = [...new Set([...proofs, ...operations].map(({ name = '' } = {}) => name))];
        const result = Object.freeze({ ...(names.length === 1 ? { name: names.at(0) } : {}),
            missing: proofs.some(({ missing = false } = {}) => missing), violations: Object.freeze(violations),
            missingNames: Object.freeze([...new Set(proofs.filter(({ missing = false } = {}) => missing).map(({ name = '' } = {}) => name))]),
            conflicts: Object.freeze(conflicts), expected,
            producers: Object.freeze([...producers].toSorted(([a = ''] = [], [b = ''] = []) => a.localeCompare(b)).map(([, source = {}] = []) => source)),
            native: Boolean(proofs.length) && proofs.every(({ native = false } = {}) => native),
            incomplete: !proofs.length || proofs.some(({ incomplete = false } = {}) => incomplete),
            evidence: Object.freeze([...new Set(operations.map(({ family = false } = {}) => family))]) });

        notify(observation, 'member-query');

        return put(memberQueries, key, result);
    };
    const createdBy = ({ expression: created = false, context: owner = false } = {},
        { module = '', location: { range: [start = -1, end = -1] = [] } = {} } = {}, context) => {
        if (!created || !owner) return true;

        const site = owner === context ? created : invocationAt(owner, context);

        if (!site) return false;

        const { module: source = '', location: { range: [from = -1, to = -1] = [] } = {} } = site;

        if (start < 0 || end < start || from < 0 || to < from) return true;

        return module === source && from >= start && to <= end;
    };
    const checkPromise = (expression, observation = {}, boundary = expression) => {
        // Policy asks about the dropped expression independent of enclosing
        // reach. Its unconditional observations cannot enter a flow proof.
        const context = contextFor(executionOf(boundary), standalone);
        const selected = task(boundary, context);
        const key = `${keyOf(selected)}:${indexOf(expression)}`;

        if (promiseQueries.has(key)) return promiseQueries.get(key);

        const entry = values.get(keyOf(selected)) || evaluate(selected, observation);
        const { guarded = false } = expression;
        const sites = valueSites.get(expression);
        const recorded = guarded && sites && sites.get(context);
        const entries = boundary === expression ? [entry] : (guarded ? [...(recorded || [])] : [keyOf(task(expression, context))])
            .map(key => values.get(key)).filter(Boolean);
        const value = valueModel.joined(entries.map(valueOf));
        const { promises = [] } = value ? valueModel.evidenceFor(value, () => notify(observation, 'value-ownership')) : {};
        const visit = () => notify(observation, 'value-ownership');
        const contents = promises.includes('none');
        const known = promises.includes('known') || Boolean(contents && valueModel.typeGate(value, 'known', 0, visit, 'contents'));
        // Only known contents need the ownership facet. Invocation ancestry
        // includes named callbacks; missing origin/ranges supply no exemption.
        const dropped = promises.includes('known') || Boolean(contents && known && valueModel.typeGate(value, 'known', 0, visit, 'contents', {
            key, accepts: (origin, value) => createdBy(origin || valueOrigins.get(value), boundary, context)
        }));
        const incomplete = promises.includes('unknown') || Boolean(contents && valueModel.typeGate(value, 'unknown', 0, visit, 'contents'));
        const alternatives = [...new Set([...promises, ...(known ? ['known'] : []), ...(incomplete ? ['unknown'] : [])])];
        const result = Object.freeze({ known, dropped, incomplete, alternatives: Object.freeze(alternatives), normal: entries.some(normalOf) });

        notify(observation, 'promise-query');

        return put(promiseQueries, key, result);
    };

    const callsFor = (expression, observation = {}) => {
        const keys = useKeys(expression, observation);

        return outcomes.describeCalls(keys.map(key => ({ key, entry: values.get(key) })), kind => notify(observation, kind));
    };
    const callabilityFor = (expression, observation = {}) => {
        const { kind = '' } = expression;

        if (kind !== 'member-call') return [];

        const keys = new Set(useKeys(expression, observation));
        const isolated = contextFor(executionOf(expression), standalone);
        const contexts = new Set([isolated, ...contextsForUse(expression, observation)]);

        return [...contexts].flatMap(context => [...(callableRequirements.get(`${indexOf(expression)}:${indexOf(context)}`) || new Map()).values()]
            .filter(({ task = '' } = {}) => context !== isolated || keys.has(task)));
    };

    // Generic value origins cross record fields and closure returns using the
    // same owned value graph as forward evidence. Actual invocations cannot
    // discharge a declaration's contract: only its generic context is queried.
    const consumptionFor = (capability, observation = {}) => {
        const { execution = false } = capability ? capability : {};
        const model = executionModels.get(execution);

        if (!model) return Object.freeze({ invoked: false, guarded: false });

        const context = capabilityContextFor(model);

        evaluate(functionTask(model, context), observation);
        const entries = valueConsumptions.get(`${indexOf(capability)}:${indexOf(context)}`) || new Map();

        return Object.freeze({ invoked: !!entries.size, guarded: [...entries.values()].every(Boolean) });
    };

    return { ownerFor, useValue, ensure, defaulted, slotOwner, functionValue, completionFor, checkInvocation, checkCapability, checkMember, checkPromise, callsFor, callabilityFor, consumptionFor,
        counts: () => ({ contexts: contexts.size, values: values.size, decisions: decisions.count(), decisionWork: decisions.work() }) };
};
