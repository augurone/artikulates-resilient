import { createOwner, familyEvidence, producer, readFamily, readField, record, reference, replaceEvidence, unresolved } from 'eslint-plugin-resilient/agreement';

import { append, forget, put, retain, takeLast } from '../collections.js';
import { traverse } from '../traversal.js';
import { collectionMethods, nativeResultFamily, objectPrototypeMembers, objectTags, operationRequirements } from './native-members.js';
import { createOutcomes } from './outcomes.js';
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
    intrinsicExposures = new Map(), externalExecutions = new Set(), capabilityRegions = new Map(), limit = Infinity } = {}) => {
    // Required decision functions are checked below before closure capture; no fallback can supply them.
    const { and, or, not } = decisions;

    if (typeof and !== 'function' || typeof or !== 'function' || typeof not !== 'function') throw new TypeError('Expected Boolean decision operations');

    const origins = new Map();
    const valueOrigins = new WeakMap();
    const producerLocations = new WeakMap();
    const producerFor = (expression) => {
        const { module = '', location = {} } = expression;

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
        }, { key: `owner:${indexOf(expression)}:${indexOf(context)}` });
    };
    const valueModel = createValues({ unknown, decisions, limit }, valueGate, ownerGate);
    const { unknownValue = {} } = valueModel;
    const { owner: unknownSource = false } = unknownValue;
    const promiseValue = normalValue({ owner: unknownSource, promise: 'known', truth: 1, absence: 'present' });
    const absentValue = normalValue(absence);
    const outcomes = createOutcomes({ decisions, values: valueModel, absent: absentValue });
    const unknownPromise = outcomes.outcome({ value: promiseValue, normal: 1, effects: 1 });
    const settlements = createSettlements({ values: valueModel, outcomes });
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
    const fallbacks = new WeakMap();
    const summaries = new WeakMap();
    const invocationProofs = new Map();
    const capabilityWrites = new Map();
    const syntaxGuards = new Map();
    const unsupportedGuards = new Set();
    const closureCreations = new Map();
    const preparedFunctions = new WeakSet();
    const captureProofs = new Map();
    const memberProofs = new Map();
    const modelContexts = new WeakMap();
    const memberQueries = new Map();
    const promiseQueries = new Map();
    const valueSites = new WeakMap();
    const exposedContexts = new WeakMap();
    const exposingCalls = new Set([...intrinsicExposures.values()].flatMap(({ uses = [] } = {}) => uses.map(expressionOf)));
    const callbackOnly = new Set([...intrinsicExposures.values()].flatMap(({ uses = [] } = {}) => uses.filter(({ callbackOnly = false } = {}) => callbackOnly).map(expressionOf)));
    const expose = (expression, context) => {
        if (exposingCalls.has(expression)) retain(exposedContexts.get(expression) || put(exposedContexts, expression, new Set()), context);
    };
    const valueOwners = new WeakMap();
    const settlementSources = new WeakMap();
    const nativeOwners = new Map();
    const nativeOwner = family => nativeOwners.get(family) || put(nativeOwners, family, createOwner({ evidence: familyEvidence({ name: family }) }));
    const executionModels = new Map([...functions, ...moduleRoots].map(model => [executionOf(model), model]));
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
    const createContext = ({ model = false, arguments: args = false, defaults = false, origin = {}, bodyOnly = false, nativeAvailable = true } = {}) => {
        // An empty origin describes a root query. An invocation supplies its
        // caller and source point together; neither becomes a synthetic context.
        const { caller: { boundary = contexts.size, depth = -1 } = {} } = origin;

        const context = Object.freeze({ index: contexts.size, model, arguments: args, defaults, origin, boundary, depth: depth + 1, bodyOnly, nativeAvailable });

        if (model) retain(modelContexts.get(model) || put(modelContexts, model, new Set()), context);

        return context;
    };
    const contextFor = (execution, scope = generic) => {
        if (scope.has(execution)) return scope.get(execution);

        const context = createContext({ model: executionModels.get(execution) || (executionOf(root) === execution && root), bodyOnly: scope === capabilityContexts });

        put(contexts, `boundary:${contexts.size}`, context);

        return put(scope, execution, context);
    };
    const condition = (expression, context, kind) => {
        const key = conditionKey(expression, context, kind);
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
        const { truth = -1, absence: missing = 'unknown' } = expression;
        const truthGate = truth >= 0 ? truth : condition(expression, context, 'truth');
        const nullishGate = missing === 'unknown' ? and(not(truthGate), condition(expression, context, 'nullish')) : Number(['null', 'undefined'].includes(missing));

        return normalValue({ ...expression, truthGate, nullishGate, producer: producerFor(expression) });
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
        const projection = () => tick('flow-projection');
        const selectTask = (expression, context, gate = 1) => {
            // Completion forgetting is shared across expressions. Only the
            // remaining value conditions depend on the selected source origin.
            const selected = statementOf(expression) ? gate : decisions.project(valueGate(gate, { onVisit: projection }), (key) => {
                return precedes(origins.get(key), expression, context, true);
            }, { key: `expression:${indexOf(expression)}:${indexOf(context)}`, onVisit: projection });

            return { ...task(expression, context, selected), requested: gate };
        };
        const read = (selected) => {
            const { gate = 1, requested = gate } = selected;

            return outcomes.restrict(values.get(keyOf(selected)), requested, selection);
        };
        const need = selected => values.has(keyOf(selected)) ? [] : [selected];
        const opaque = (expression, context, value = false, exposing = true) => {
            if (exposing) expose(expression, context);

            const normal = condition(expression, context, 'completion');

            return outcomes.outcome({ normal, thrown: not(normal), uncertain: not(normal), effects: 1,
                value: testedValue(value || sourceValue({ ...unknown, ...expression }, context), expression, context, tick) });
        };
        const unsupported = (expression, context, normal = 0) => outcomes.outcome({ normal, returned: 1, thrown: 1, uncertain: 1, effects: 1, unresolved: true,
            result: sourceValue({ ...unknown, ...expression }, context) });
        const resolve = (value, expression, context, gate = 1) => settlements.resolve(valueModel.restrict(value, gate, selection),
            `${categoryOf(expression)}:${indexOf(expression)}:${indexOf(context)}`, () => {
                const { location = {} } = expression;
                const owner = settlementSources.get(expression) || put(settlementSources, expression, unknownOwner({ code: 'unresolved-settlement', location }));

                return opaque({ ...expression, owner }, context);
            }, observation);
        const promised = (settlement) => {
            const { effects = 0, calls = false } = settlement;
            const value = normalValue({ ...promiseValue, settlement: outcomes.outcome({ ...settlement, returns: false, sites: false, calls: false }) });

            return outcomes.outcome({ value, normal: 1, effects, calls });
        };
        const then = (first, next) => {
            const waiting = need(first);

            return waiting.length ? { dependencies: waiting } : next(read(first));
        };
        const functionStep = ({ model = {}, context = {}, key = '' } = {}) => {
            const { supported = false, capabilitySupported = false, flow = {}, initialization = false, bodyLocation = {}, promiseResult = false, imports = [] } = model;
            const { bodyOnly = false } = context;

            if (!supported && !(bodyOnly && capabilitySupported)) return { value: outcomes.invoked(unsupported(model, context), bodyLocation, selection) };

            if (!entered.has(key)) {
                retain(active, model);
                retain(entered, key);
                tick('function-context');
            }

            const dependencies = imports.filter(dependency => !active.has(dependency)).map(dependency => functionTask(dependency, contextFor(executionOf(dependency))));
            const missing = dependencies.flatMap(need);

            if (missing.length) return { dependencies: missing };

            const imported = dependencies.map(read).reduce((left, right) => outcomes.sequence(left, right, selection), continuation);
            const cyclic = imports.some(dependency => active.has(dependency));
            const body = task(flow, context, normalOf(imported));
            const waiting = need(body);

            if (waiting.length) return { dependencies: waiting };

            const { unresolved = false } = imported;
            const completedBody = read(body);
            const { unresolved: incomplete = false } = completedBody;
            const initialized = imports.length ? outcomes.outcome({ ...outcomes.sequence(imported, completedBody, selection),
                unresolved: cyclic || unresolved || incomplete }) : completedBody;
            const completed = initialization ? outcomes.sequence(opaque(model, context, absentValue), initialized, selection) : initialized;

            forget(active, model);

            const invocation = outcomes.invoked(completed, bodyLocation, selection);
            const invoked = shapeTests.size ? outcomes.outcome({ ...invocation,
                value: valueModel.normalizeShape(valueOf(invocation), shapeTestsFor, selection) }) : invocation;
            const { returns = false } = invoked;
            const result = promiseResult ? outcomes.sequence(invoked, resolve(valueOf(invoked), model, context), selection) : invoked;
            const sites = promiseResult ? outcomes.mapReturns(returns, value => valueOf(resolve(value, model, context)), projection) : returns;

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
            const { arguments: inputs = false, defaults = false, nativeAvailable = true } = context;

            if (rest) return { value: outcomes.complete(arrayValue(inputs ? Object.freeze(inputs.slice(position)) : false, nativeAvailable)) };

            if (!inputs && defaults && fallback) return then(selectTask(fallback, context), value => ({ value }));

            // A generic formal owns an identity, never a caller's value family.
            if (!inputs) return { value: outcomes.complete(sourceValue({ ...unknown, ...expression, identity: expression, identityContext: context }, context)) };

            const input = inputs.at(position) || absentValue;

            if (!fallback) return { value: outcomes.complete(input) };

            const { omitted = false } = valueModel.project(input, 'defined', selection);

            if (!omitted) return { value: outcomes.complete(input) };

            return then(selectTask(fallback, context), replacement => ({
                value: outcomes.complete(valueModel.replace(input, 'defined', valueOf(replacement), selection))
            }));
        };
        const fieldValue = (cases, expression, context) => {
            const { name = '' } = expression;
            const values = [...new Set(cases.map(({ state = '', owner = false } = {}) => {
                if (state === 'present') return sources.get(owner) || normalValue({ owner });

                return state === 'absent' && !objectPrototypeMembers.has(name) ? absentValue : sourceValue({ ...unknown, ...expression }, context);
            }))];

            if (values.length < 2) return valueModel.joined(values) || unknownValue;

            const remaining = new Map([['gate', 1]]);

            return valueModel.joined(values.map((value, index) => {
                const prior = remaining.get('gate');
                const choice = index === values.length - 1 ? 1 : condition(expression, context, `field-alternative:${index}`);

                put(remaining, 'gate', and(prior, not(choice)));

                return valueModel.restrict(value, and(prior, choice), selection);
            })) || unknownValue;
        };
        const selectionStep = ({ expression = {}, context = {}, gate = 1 } = {}) => {
            const { target = {}, name = '', slot = -1, fallback = false, formal = false } = expression;
            const { defaults = false } = context;

            return then(selectTask(target, context, gate), (entry) => {
                if (!normalOf(entry)) return { value: entry };

                const { memberOwner: owner = false, borrowed = false } = valueModel.evidenceFor(valueOf(entry), selection);
                const { families = [], incomplete = false } = readFamily({ owner, ...observation });

                if (!incomplete && families.length === 1 && families.at(0) === 'nullish') return { value: outcomes.thrown(entry) };

                const { cases = [] } = slot < 0 ? readField({ owner, name, ...observation }) : {};
                const field = slot < 0 ? fieldValue(cases, expression, context)
                    : valueModel.selectSlot(valueOf(entry), slot, absentValue, () => sourceValue({ ...unknown, ...expression }, context), selection);
                const selected = slot < 0 && borrowed ? valueModel.borrow(field) : field;
                const { omitted = false } = valueModel.project(selected, 'defined', selection);

                const absentPath = formal && defaults && incomplete && !families.length && cases.every(({ state = '' } = {}) => state === 'unknown');

                if (!fallback || (!omitted && !absentPath)) return { value: outcomes.sequence(entry, outcomes.complete(selected), selection) };

                return then(selectTask(fallback, context, gate), replacement => ({ value: outcomes.sequence(entry,
                    absentPath ? replacement
                        : outcomes.sequence(replacement, outcomes.complete(valueModel.replace(selected, 'defined', valueOf(replacement), selection)), selection), selection) }));
            });
        };
        const linkStep = ({ expression: { target = false, transfer = false } = {}, context = {}, gate = 1 } = {}) => then(selectTask(target, context, gate), (entry) => {
            const value = valueOf(entry) || unknownValue;

            return { value: outcomes.complete(transfer ? valueModel.escape(value, selection) : value) };
        });
        const sequenceStep = ({ expression: { left = {}, right = {} } = {}, context = {}, gate = 1 } = {}) => then(selectTask(left, context, gate), (initial) => {
            if (!normalOf(initial)) return { value: initial };

            return then(selectTask(right, context, and(gate, normalOf(initial))), following => ({ value: outcomes.sequence(initial, following, selection) }));
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
                    value: outcomes.sequence(initial, kind === 'conditional' ? outcomes.located(entry, [
                        { location: yesLocation, gate: choice }, { location: noLocation, gate: not(choice) }
                    ]) : entry, selection)
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

                    return outcomes.complete(projected);
                });
                const combined = branches.reduce((left, right) => outcomes.join(left, right), empty);
                const normalized = shapeTests.size ? outcomes.outcome({ ...combined,
                    value: valueModel.normalizeShape(valueOf(combined), shapeTestsFor, selection) }) : combined;

                return { value: outcomes.sequence(initial, kind === 'logical' ? outcomes.outcome({ ...normalized, sites: false }) : normalized, selection) };
            });
        };
        const promiseConstruction = (value, expression, context) => {
            const { owner = false } = valueModel.evidenceFor(value, selection);
            const { families = [], incomplete = false } = readFamily({ owner, ...observation });

            if (!incomplete && families.length && !families.includes('function')) return outcomes.thrown(continuation);

            return !incomplete && families.length && families.every(family => family === 'function')
                ? unknownPromise : opaque(expression, context, promiseValue);
        };
        const invokeStep = ({ expression = {}, context = {}, key = '', point = '', site = '' } = {}, { prefix = {}, arguments: inputs = [] } = {}) => {
            expose(expression, context);
            const { function: callee = {}, execute: allowed = true, requireInertPrefix = false, nativeAvailable: premise = true,
                argumentFresh = [], argumentMetadata = [], module: callerModule = '' } = expression;
            const { functionModel = false, module: calleeModule = '' } = callee;
            const dependency = functionModel && callerModule !== calleeModule && modules.get(calleeModule);
            const initializing = dependency && active.has(dependency);
            const initialization = dependency && !initializing && functionTask(dependency, contextFor(executionOf(dependency)));
            const waiting = initialization ? need(initialization) : [];

            if (waiting.length) return { dependencies: waiting };

            const available = initialization ? read(initialization) : continuation;
            const { unresolved = false } = available;
            // Compiler acquisition may lack an ambient native-dependency proof.
            // Retire that premise, not ordinary callable execution or families.
            const { nativeAvailable: inherited = true } = context;
            const nativeAvailable = inherited && premise && (!requireInertPrefix || !effectsOf(prefix));
            const execute = allowed && !initializing && !unresolved && Boolean(normalOf(available));
            const { promiseResult = false, intrinsicPromise = false } = callee;
            const { signature = false } = callee;
            const recursive = active.has(callee);
            const reusable = nativeAvailable && !promiseResult && signature && execute && !recursive;
            const previous = reusable && inputs.reduce((entries, value) => entries && entries.get(value), invocations.get(callee));
            const completed = previous && previous.get(completedInvocation);
            const occurrence = !completed && signature && execute && !recursive && `${point || key}:${nativeAvailable}:${normalOf(prefix)}:${effectsOf(prefix)}`;
            // Path conditions can request the same source invocation twice.
            // Equal input records at that occurrence share its execution;
            // separate calls and collection iterations retain distinct points.
            const targets = occurrence && (invocationContexts.get(occurrence) || put(invocationContexts, occurrence, new Map()));
            const local = targets && inputs.reduce((entries, value) => entries.get(value) || put(entries, value, new Map()),
                targets.get(callee) || put(targets, callee, new Map()));
            const shared = (local && local.get(invocationContext)) || completed;

            if (shared && !contexts.has(key)) put(contexts, key, shared);

            if (signature && execute && !recursive && !contexts.has(key)) put(contexts, key, createContext({
                model: callee, nativeAvailable, arguments: Object.freeze(inputs.map((value, index) => {
                    if (!nativeAvailable) return valueModel.retire(value);

                    if (argumentFresh.at(index)) return value;

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

            if (!execute || recursive) return { value: admitted(promiseResult ? unknownPromise : opaque(expression, context)) };

            if (intrinsicPromise) return { value: admitted(promiseConstruction(inputs.at(0) || absentValue, expression, context)) };

            if (!contexts.has(key)) put(contexts, key, createContext({ model: callee, nativeAvailable, arguments: Object.freeze(inputs),
                origin: Object.freeze({ caller: context, invocation: expression }) }));

            return then(functionTask(callee, contexts.get(key)), (entry) => {
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

                return { value: admitted(promiseResult ? promised(entry) : outcomes.outcome({ ...entry, returns: false, sites: false,
                    value: result ? testedValue(normalValue({ ...result, owner: false, input: result, inputs: [] }), expression, context, tick, inputs.at(0)) : false })) };
            });
        };
        const argumentsStep = ({ expression = {}, context = {}, gate = 1, key = '' } = {}, prefix, invoke) => {
            if (typeof invoke !== 'function') throw new TypeError('Expected invocation continuation');

            const { arguments: args = [], argumentOwned = [] } = expression;
            const state = stages.get(key) || put(stages, key, { position: 0, prefix, arguments: [], effects: 0 });
            const { position = 0, prefix: completed = {}, arguments: inputs = [], effects = 0 } = state;

            if (!normalOf(completed)) return { value: completed };

            if (position >= args.length) return invoke(state);

            return then(selectTask(args.at(position), context, and(gate, normalOf(completed))), (entry) => {
                const value = valueOf(entry);

                append(inputs, argumentOwned.at(position) === false ? valueModel.retire(value) : value);
                put(stages, key, { position: position + 1, prefix: outcomes.sequence(completed, entry, selection), arguments: inputs, effects: or(effects, effectsOf(entry)) });

                return { dependencies: [] };
            });
        };
        const arrayStep = current => argumentsStep(current, continuation, ({ prefix = {}, arguments: inputs = [] } = {}) => {
            const { expression = {}, context: { nativeAvailable = true } = {} } = current;
            const { holes = [], fixed = false, standardPrototype = false } = expression;
            const slots = fixed ? Object.freeze(inputs.map((value, index) => holes.at(index) ? false : value)) : false;

            return { value: outcomes.sequence(prefix, outcomes.complete(normalValue({ ...arrayValue(slots, standardPrototype && nativeAvailable), producer: producerFor(expression) })), selection) };
        });
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

                if (['+', '-'].includes(operator) && family !== 'number') return { value: outcomes.sequence(entry, opaque(expression, context), selection) };

                if (['+', '-'].includes(operator)) {
                    const owner = nativeOwner('number');
                    const { constant = false } = input;
                    const number = constant && Reflect.get(constant, 'value');
                    const computed = typeof number === 'number' ? Object.freeze({ value: operator === '-' ? -number : number }) : false;
                    const truth = computed ? Number(Boolean(Reflect.get(computed, 'value'))) : -1;

                    const value = sourceValue({ ...expression, owner, constant: computed, truth, absence: 'present', promise: 'none' }, context);

                    return { value: outcomes.sequence(entry, outcomes.complete(value), selection) };
                }

                const value = normalValue({ owner, constant, typeOf: operator === 'typeof' ? input : false, absence: 'present', truth: operator === 'typeof' ? 1 : inverted(truth),
                    truthGate: operator === 'typeof' ? 1 : not(truthGate) });

                return { value: outcomes.sequence(entry, outcomes.complete(value), selection) };
            });
        };
        const booleanStep = ({ expression = {}, context = {}, gate = 1 } = {}) => {
            const { left = {}, right = {}, inert = false, operator = '', capabilityTest: { capability: { result: localResult = false } = {} } = {} } = expression;

            return then(selectTask(left, context, gate), (first) => {
                if (!normalOf(first)) return { value: first };

                return then(selectTask(right, context, and(gate, normalOf(first))), (second) => {
                    const prefix = outcomes.sequence(first, second, selection);
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
                    const value = tagTest ? normalValue({ ...base, truthGate: operator === '===' ? tagMatch : not(tagMatch) }) : typeValue;

                    return { value: outcomes.sequence(prefix, inert || nullishTest ? outcomes.complete(value) : opaque(expression, context, value), selection) };
                });
            });
        };
        const recordFieldStep = ({ expression: { entries = [] } = {}, context = {}, gate = 1, key = '' } = {},
            { position = 0, prefix = {}, fields = [], open = false, barrier = -1 } = {}) => {
            const { name = '', known = false, data = false, value = {}, key: computed = false } = entries.at(position);
            const keyTask = computed && selectTask(computed, context, and(gate, normalOf(prefix)));
            const waiting = keyTask ? need(keyTask) : [];

            if (waiting.length) return { dependencies: waiting };

            const started = keyTask ? outcomes.sequence(prefix, read(keyTask), selection) : prefix;

            if (!normalOf(started)) return { value: started };

            return then(selectTask(value, context, and(gate, normalOf(started))), (entry) => {
                const result = data ? valueModel.escape(valueOf(entry) || unknownValue, selection) : unknownValue;
                const owner = ownerForValue(result, observation);

                if (known) append(fields, { name, owner, position });

                put(stages, key, { position: position + 1, prefix: outcomes.sequence(started, entry, selection), fields, open: open || !known, barrier: known ? barrier : position });

                return { dependencies: [] };
            });
        };
        const recordStep = (current = {}) => {
            const { expression = {}, key = '' } = current;
            const { entries = [], trusted = false, standardPrototype = false, open: extensible = false, openDefault = false } = expression;
            const state = stages.get(key) || put(stages, key, { position: 0, prefix: continuation, fields: [], open: !trusted || extensible, barrier: -1 });
            const { position = 0, prefix = {}, fields = [], open = false, barrier = -1 } = state;

            if (!normalOf(prefix)) return { value: prefix };

            if (position < entries.length) return recordFieldStep(current, state);

            const owner = createOwner({ evidence: record({ open, fields: fields.map(({ name = '', owner = false, position = -1 } = {}) => ({
                name, owner: trusted && position > barrier ? owner : unknownSource
            })) }) });
            const value = normalValue({ owner, producer: producerFor(expression), promise: 'none', standardPrototype, nativeTag: (!open || openDefault) && trusted && standardPrototype ? 'Object' : '',
                plain: trusted && standardPrototype, emptyDefault: openDefault, emptyRecord: !entries.length && !open, truth: 1, absence: 'present' });

            put(sources, owner, value);

            return { value: outcomes.sequence(prefix, outcomes.complete(value), selection) };
        };
        const memberStep = ({ expression = {}, context = {}, gate = 1 } = {}) => {
            const { target = {}, name = '', supported = false, invalidFamilies = [], promiseFactory = false, promiseMethod = '',
                nativeFactory = false, nativeNamespace = '' } = expression;

            return then(selectTask(target, context, gate), (entry) => {
                if (!normalOf(entry)) return { value: entry };

                const { nativeAvailable = true } = context;

                if (!supported || !nativeAvailable) return { value: outcomes.sequence(entry, opaque(expression, context), selection) };

                if (nativeNamespace) return { value: outcomes.sequence(entry, outcomes.complete(normalValue({ owner: nativeOwner(nativeNamespace),
                    promise: 'none', truth: 1, absence: 'present' })), selection) };

                if (promiseFactory) return { value: outcomes.sequence(entry, outcomes.complete(normalValue({ owner: unknownSource,
                    callable: Object.freeze({ nativePromise: promiseMethod }), promise: 'none', truth: 1, absence: 'present' })), selection) };

                if (nativeFactory) return { value: outcomes.sequence(entry, outcomes.complete(normalValue({ owner: unknownSource,
                    callable: Object.freeze({ ...nativeFactory, lookup: expression }), promise: 'none', truth: 1, absence: 'present' })), selection) };

                const input = valueOf(entry) || unknownValue;
                const { memberOwner: owner = false, standardPrototype = false, plain = false, emptyDefault = false, producers = false, borrowed = false } = valueModel.evidenceFor(input, selection);
                const family = readFamily({ ...observation, owner });
                const { families = [], incomplete = false } = family;
                const { cases = [] } = readField({ ...observation, owner, name });
                const { name: expected = '' } = operationRequirements.get(name) ?? {};
                const field = fieldValue(cases, expression, context);
                const selected = borrowed ? valueModel.borrow(field) : field;
                const absent = cases.some(({ state = '' } = {}) => state === 'absent');
                const conflicts = expected ? families.filter(family => family !== expected && (family !== 'object' || absent || emptyDefault)) : [];
                const native = Boolean(expected && (expected === 'string' || standardPrototype) && !invalidFamilies.includes(expected) && families.length === 1 && families.at(0) === expected &&
                    !incomplete && !cases.some(({ state = '' } = {}) => state === 'present'));
                const missingNative = Boolean(expected && !incomplete && families.length && conflicts.length === families.length &&
                    families.every(family => !invalidFamilies.includes(family)) && !cases.some(({ state = '' } = {}) => state === 'present'));
                const nonnative = missingNative ? absentValue : selected;
                const value = native ? normalValue({ ...unknownValue, callable: Object.freeze({ native: name, lookup: expression, receiver: input }), absence: 'present', truth: 1 }) : nonnative;

                const proof = Object.freeze({ missing: absent && !objectPrototypeMembers.has(name), conflicts: Object.freeze(conflicts), expected, native, producers,
                    incomplete: incomplete || families.some(family => invalidFamilies.includes(family)) || cases.some(({ state = '' } = {}) => state === 'unknown'), family });
                const collected = memberProofs.get(`${indexOf(expression)}:${indexOf(context)}`) ||
                    put(memberProofs, `${indexOf(expression)}:${indexOf(context)}`, new Set());

                retain(collected, proof);

                return { value: outcomes.sequence(entry, native || (plain && cases.every(({ state = '' } = {}) => state === 'present'))
                    ? outcomes.complete(value) : opaque(expression, context, value), selection) };
            });
        };
        // Native collection protocols schedule ordinary invocations. Slots and
        // accumulator values belong to this caller, never the generic callback.
        const collectionStep = (current, { prefix = {}, arguments: inputs = [], effects: argumentEffects = 0 } = {}, method, receiver) => {
            const { expression = {}, context = {}, key = '', point = '', site = '' } = current;
            const { slots = false, standardPrototype = false } = valueModel.evidenceFor(receiver, selection);
            const callback = inputs.at(0) || absentValue;
            const { owner = false, callableCases = [] } = valueModel.evidenceFor(callback, selection);
            const { families = [], incomplete = false } = readFamily({ owner, ...observation });
            const fallback = () => {
                const family = nativeResultFamily.get(method);
                const value = method === 'forEach' ? absentValue : family && normalValue({ owner: nativeOwner(family), promise: 'none', absence: 'present' });

                // Collection protocols invoke the callback; they never pass
                // that function object to it. Other argument positions escape.
                return { value: outcomes.sequence(prefix, opaque(expression, context, value, !callbackOnly.has(expression)), selection) };
            };

            if (!incomplete && families.length && !families.includes('function')) return { value: outcomes.sequence(prefix, outcomes.thrown(continuation), selection) };

            if (!slots || !standardPrototype || argumentEffects) return fallback();

            const seeded = inputs.length > 1;
            const start = method === 'reduce' && !seeded ? slots.findIndex(Boolean) : -1;

            if (method === 'reduce' && !seeded && start < 0) return { value: outcomes.sequence(prefix, outcomes.thrown(continuation), selection) };

            const seed = seeded ? inputs.at(1) : slots.at(start);
            const initial = method === 'reduce' ? seed : absentValue;
            const state = stages.get(key) || put(stages, key, { position: start + 1, prefix, result: initial, produced: [], fixed: true, finished: empty });
            const { position = 0, prefix: completed = {}, result = false, produced = [], fixed = false, finished = empty } = state;
            const finish = value => ({ value: outcomes.join(finished, outcomes.sequence(completed, outcomes.complete(value), selection)) });

            if (!normalOf(completed)) return { value: outcomes.join(finished, completed) };

            if (position >= slots.length && method === 'reduce') return finish(result);

            if (position >= slots.length && method === 'some') return finish(normalValue({ owner: nativeOwner('boolean'),
                constant: Object.freeze({ value: false }), truth: 0, absence: 'present', promise: 'none' }));

            if (position >= slots.length) return finish(['map', 'filter'].includes(method) ? arrayValue(fixed ? Object.freeze(produced) : false, standardPrototype) : absentValue);

            const item = slots.at(position);

            if (!item && method === 'map') append(produced, false);

            if (!item && method !== 'find') {
                put(stages, key, { ...state, position: position + 1 });

                return { dependencies: [] };
            }

            const ordinal = normalValue({ owner: nativeOwner('number'), constant: Object.freeze({ value: position }), truth: Number(Boolean(position)), absence: 'present', promise: 'none' });
            const argumentsList = [...(method === 'reduce' ? [result] : []), item || absentValue, ordinal, receiver];
            const plans = callableCases.map(({ callable = false, gate: chosen = 1 } = {}, index) => {
                const reach = and(normalOf(completed), chosen);

                if (!reach) return { value: empty };

                const { functionModel = false } = callable ? callable : {};

                if (!functionModel) return { value: outcomes.restrict(opaque(expression, context), reach, selection) };

                return invokeStep({ ...current, key: `${key}:item:${position}:${index}`, point: `${point || key}:item:${position}:${index}`, site: site || key,
                    expression: { ...expression, function: callable, protocol: method, name: `${method}.callback`, argumentMetadata: [] } },
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

            const observedItem = effects ? valueModel.retire(item || absentValue) : item || absentValue;
            const exits = ['some', 'find'].includes(method);
            const found = method === 'some' ? normalValue({ owner: nativeOwner('boolean'),
                constant: Object.freeze({ value: true }), truth: 1, absence: 'present', promise: 'none' }) : observedItem;
            const stopped = exits ? outcomes.sequence(outcomes.restrict(next, truthGate, selection), outcomes.complete(found), selection) : empty;
            const continued = exits ? outcomes.restrict(next, not(truthGate), selection) : next;
            const retired = effects && normalOf(continued) && position + 1 < slots.length;
            const { value: unknownResult = empty } = retired ? fallback() : {};
            const unknownTail = retired ? outcomes.sequence(outcomes.restrict(continued, effects, selection), unknownResult, selection) : empty;
            const remaining = retired ? outcomes.restrict(continued, not(effects), selection) : continued;

            if (method === 'map') append(produced, effects ? valueModel.retire(selected) : selected);

            if (method === 'filter' && truthGate) append(produced, observedItem);

            put(stages, key, { position: position + 1, prefix: remaining,
                result: selected, produced, fixed: fixed && !effects && (method !== 'filter' || !truthGate || truthGate === 1),
                finished: outcomes.join(outcomes.join(finished, unknownTail), stopped) });

            return { dependencies: [] };
        };
        const memberCallStep = (current = {}) => {
            const { expression = {}, context = {}, gate = 1, key = '' } = current;
            const { callee = {}, argumentFresh = [], invalidFamilies = [], construct = false } = expression;

            return then(selectTask(callee, context, gate), (selected) => {
                if (!normalOf(selected)) return { value: selected };

                const { callableCases = [] } = valueModel.evidenceFor(valueOf(selected), selection);

                return argumentsStep(current, selected, (state) => {
                    const { prefix: completed = {}, arguments: available = [] } = state;

                    // Construction evaluates its reference and arguments in
                    // order; an unknown constructor does not lend call semantics.
                    if (construct) return { value: outcomes.sequence(completed, opaque(expression, context), selection) };

                    const plans = callableCases.map(({ callable = false, gate: chosen = 1 } = {}, index) => {
                        const reach = and(normalOf(completed), chosen);

                        if (!reach) return { value: empty };

                        const branch = { ...state, prefix: outcomes.restrict(completed, chosen, selection), arguments: available.map(value => valueModel.restrict(value, chosen, selection)) };
                        const { prefix = {}, arguments: inputs = [] } = branch;

                        if (!callable) {
                            const { owner = false } = valueModel.evidenceFor(valueOf(selected), selection);
                            const { families = [], incomplete = true } = readFamily({ owner, ...observation });
                            const noncallable = !incomplete && families.length && !families.includes('function');

                            return { value: outcomes.sequence(prefix, opaque(expression, context, false, !noncallable), selection) };
                        }

                        const { functionModel = false, native = '', lookup = false, receiver = false, nativePromise = false,
                            factory = '', predicate = '', objectTag = false, receiverBound = false } = callable;
                        const alternative = `${key}:callee:${index}`;

                        if (functionModel) {
                            expose(expression, context);

                            return invokeStep({ ...current, key: alternative, site: key, expression: { ...expression, function: callable } }, branch);
                        }

                        // A native method's family contract belongs to its
                        // receiver-bearing call. Extracting the callable does
                        // not preserve the receiver that established it.
                        if ((native || receiverBound) && lookup !== callee) return { value: outcomes.sequence(prefix, opaque(expression, context), selection) };

                        if (objectTag) {
                            const input = inputs.at(0) || absentValue;
                            const harmless = valueModel.typeGate(input, '', 0, selection, 'tag-inert');
                            const value = normalValue({ owner: nativeOwner('string'), objectTagOf: input, absence: 'present', truth: 1, promise: 'none' });
                            const produced = outcomes.join(outcomes.restrict(outcomes.complete(value), harmless, selection),
                                outcomes.restrict(opaque(expression, context, value), not(harmless), selection));

                            return { value: outcomes.sequence(prefix, produced, selection) };
                        }

                        if (collectionMethods.has(native)) return collectionStep({ ...current, key: alternative, site: key }, branch, native, receiver);

                        if (predicate) {
                            const input = inputs.at(0) || absentValue;
                            const unknownMatch = familyCondition(input, predicate, context, true) || condition(expression, context, 'truth');
                            const truthGate = valueModel.typeGate(input, predicate, unknownMatch, selection, 'family');
                            const value = normalValue({ owner: nativeOwner('boolean'), absence: 'present', promise: 'none', truthGate });

                            return { value: outcomes.sequence(prefix, opaque(expression, context, value), selection) };
                        }

                        if (nativePromise === 'resolve') {
                            const input = inputs.at(0) || absentValue;
                            const selected = argumentFresh.at(0) ? input : valueModel.retire(input);

                            return { value: outcomes.sequence(prefix, promised(resolve(selected, expression, context)), selection) };
                        }

                        if (nativePromise === 'reject') return { value: outcomes.sequence(prefix, promised(outcomes.thrown(continuation)), selection) };

                        if (nativePromise && !['all', 'allSettled'].includes(nativePromise)) return { value: outcomes.sequence(prefix, unknownPromise, selection) };

                        const family = nativePromise ? 'array' : factory || nativeResultFamily.get(native);
                        const owner = family && nativeOwner(family);
                        const fallback = native === 'forEach' ? absentValue : false;
                        const value = owner ? normalValue({ owner, promise: 'none', absence: 'present',
                            standardPrototype: !invalidFamilies.some(invalid => ['all', family].includes(invalid)) }) : fallback;
                        const produced = ['trim', 'toLowerCase', 'toUpperCase'].includes(native) ? outcomes.complete(value) : opaque(expression, context, value);
                        const settled = nativePromise ? outcomes.sequence(produced, resolve(value, expression, context), selection) : produced;

                        return { value: outcomes.sequence(prefix, nativePromise ? promised(settled) : produced, selection) };
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
        const lifetimeStep = ({ expression: { call = false, prior = false, ordered = false, discardResult = false } = {}, context = {}, gate = 1 } = {}) => {
            const previous = prior && selectTask(prior, context, gate);
            const waiting = previous ? need(previous) : [];

            if (waiting.length) return { dependencies: waiting };

            const { truthGate: priorGate = 0 } = previous ? valueOf(read(previous)) : { truthGate: 1 };

            if (!priorGate || !call) return { value: outcomes.complete(normalValue({ owner: nativeOwner('boolean'), truth: 0, absence: 'present' })) };

            const sites = valueSites.get(call);
            const recorded = sites && sites.get(context);
            const key = keyOf(task(call, context));
            const keys = recorded ? [...recorded] : [key].filter(candidate => values.has(candidate));
            const { model = false } = context;
            const executing = model && entered.has(keyOf(functionTask(model, context)));
            const preserved = (keys.length || (ordered && executing)) ? keys.reduce((preserved, key) => {
                const entry = outcomes.restrict(values.get(key), gate, selection);
                const { normal = 0, effects = 0, thrown = 0, uncertain = 0, unresolved = false } = entry;

                if (!normal && !effects && !thrown && !uncertain && !unresolved) return preserved;

                const { owner = false } = valueModel.evidenceFor(valueOf(entry), selection);
                const { families = [], incomplete = false } = readFamily({ owner, ...observation });
                // A discarded completion has no result-value escape. Its effects,
                // failure and uncertainty retain the same lifetime meaning.
                const primitive = discardResult || (!incomplete && families.length && families.every(family => ['number', 'string', 'boolean', 'nullish'].includes(family)));

                const invalid = [effects, thrown, uncertain, (unresolved || !primitive) ? normal : 0].reduce((left, right) => or(left, right), 0);

                return and(preserved, not(invalid));
            }, priorGate) : 0;

            return { value: outcomes.complete(normalValue({ owner: nativeOwner('boolean'), truthGate: preserved, absence: 'present' })) };
        };
        const assignmentStep = ({ expression = {}, context = {}, gate = 1 } = {}) => {
            const { target = {}, argument = {}, name = '' } = expression;

            return then(selectTask(target, context, gate), (receiver) => {
                if (!normalOf(receiver)) return { value: receiver };

                return then(selectTask(argument, context, and(gate, normalOf(receiver))), (right) => {
                    const prefix = outcomes.sequence(receiver, right, selection);
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
            const { argument = {}, binding = false, nativePattern = false, formalPattern = false } = expression;

            return then(selectTask(argument, context, gate), (entry) => {
                if (!binding || !normalOf(entry)) return { value: outcomes.outcome({ ...entry, value: false, returns: false }) };

                const { nullishGate = 0 } = valueOf(entry) ?? {};
                const failed = formalPattern ? nullishGate : 0;

                // Only unsupported source contributions retain an opaque binding
                // step. Initializer failure, effects and calls keep their order.
                const unproved = nativePattern ? valueModel.selectSlots(valueOf(entry), () => false, () => absentValue, selection) : absentValue;
                const { reach = 0 } = unproved ? unproved : {};
                const completion = reach ? outcomes.join(outcomes.restrict(opaque(expression, context, absentValue), reach, selection),
                    outcomes.restrict(continuation, not(reach), selection)) : continuation;

                const completed = formalPattern ? outcomes.join(outcomes.thrown(outcomes.restrict(entry, failed, selection)),
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
            const { block = {}, handler = false, finalizer = false } = expression;

            return then(selectTask(block, context, gate), (initial) => {
                // Opaque failure invalidates only the conditions that can reach it.
                // Independent returns and explicit throws retain their evidence;
                // uncertainty cannot retract a call boundary already reached.
                const uncertain = handler ? valueGate(uncertainOf(initial)) : 0;
                const { calls = false } = initial;
                const established = uncertain ? outcomes.outcome({ ...outcomes.restrict(initial, not(uncertain), selection), calls }) : initial;
                const caught = handler && thrownOf(established) ? selectTask(handler, context, and(gate, thrownOf(established))) : false;
                const waiting = caught ? need(caught) : [];

                if (waiting.length) return { dependencies: waiting };

                const known = caught ? outcomes.caught(established, read(caught), selection) : established;
                const handled = uncertain ? outcomes.join(known, outcomes.restrict(unsupported(expression, context), and(gate, uncertain), selection)) : known;
                const { normal = 0, returned = 0, thrown = 0, broken = 0, continued = 0 } = handled;
                const reached = or(or(or(normal, returned), thrown), or(broken, continued));

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
            ['parameter', parameterStep], ['selection', selectionStep], ['link', linkStep], ['sequence', sequenceStep],
            ['conditional', branchStep], ['logical', branchStep], ['branch', branchStep],
            ['call', callStep], ['await', awaitStep], ['unary', unaryStep], ['boolean', booleanStep], ['effect', effectStep], ['return', abruptStep], ['throw', abruptStep], ['try', tryStep],
            ['lifetime', lifetimeStep], ['assignment', assignmentStep], ['revision', revisionStep], ['do', doStep],
            ['jump', ({ expression: { continued = false } = {} } = {}) => ({ value: outcomes.outcome({ broken: Number(!continued), continued: Number(continued) }) })],
            ['assigned', ({ expression = {}, context = {}, gate = 1 } = {}) => {
                const { target = {} } = expression;

                return then(selectTask(target, context, gate), (entry) => {
                    const { written = false } = valueOf(entry) ?? {};

                    return { value: written ? outcomes.complete(valueOf(entry)) : opaque(expression, context) };
                });
            }],
            ['array', arrayStep], ['record', recordStep], ['member', memberStep], ['member-call', memberCallStep],
            ['spread', ({ expression = {}, context = {}, gate = 1 } = {}) => {
                const { argument = {} } = expression;

                return then(selectTask(argument, context, gate), entry => ({ value: outcomes.sequence(entry, opaque(expression, context), selection) }));
            }],
            ['use', ({ expression: { target = {}, transfer = false } = {}, context = {}, gate = 1 } = {}) => then(selectTask(target, context, gate), entry => ({
                value: transfer ? outcomes.outcome({ ...entry, value: valueModel.escape(valueOf(entry), selection) }) : entry
            }))],
            ['unowned', ({ expression: { target = {}, lifetime = false } = {}, context = {}, gate = 1 } = {}) => then(selectTask(target, context, gate), (entry) => {
                const value = valueOf(entry) || unknownValue;
                const preserve = (proof = {}) => {
                    const proven = valueOf(proof);
                    const { truthGate = 0 } = proven ? proven : {};
                    const selected = valueModel.joined([valueModel.restrict(value, truthGate, selection),
                        valueModel.retire(valueModel.restrict(value, not(truthGate), selection))]);

                    return { value: outcomes.outcome({ ...entry, value: selected }) };
                };

                return lifetime ? then(selectTask(lifetime, context, gate), preserve) : preserve();
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
            const bound = produced && ['parameter', 'selection'].includes(kindOf(expression)) && !identity
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
    const ensure = (owner, observation = {}) => {
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
    const defaulted = (owner, fallback, observation = {}) => {
        const actual = ensure(owner, observation);
        const replacement = fallbacks.get(fallback) || put(fallbacks, fallback, normalValue({ owner: fallback }));
        const selected = valueModel.replace(actual, 'defined', replacement, () => {
            notify(observation, 'value-selection');
        });

        return selected === actual ? { ...actual, owner } : { ...selected, ...valueModel.evidenceFor(selected, () => {
            notify(observation, 'value-ownership');
        }) };
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
    const prepareFunction = (model, observation) => traverse(model, {
        enter: current => preparedFunctions.has(current) ? [] : [parentOf(current)].filter(Boolean),
        leave: (current) => {
            if (preparedFunctions.has(current)) return;

            evaluate(functionTask(current, capabilityContextFor(current)), observation);
            retain(preparedFunctions, current);
        }
    });
    const guardedCapture = (model, capability, observation, executableOnly) => {
        const keyFor = current => `${indexOf(current)}:${indexOf(capability)}:${executableOnly}`;

        traverse(model, {
            enter: current => current === root || captureProofs.has(keyFor(current)) ? [] : [parentOf(current)].filter(Boolean),
            leave: (current) => {
                if (current === root) return;

                const key = keyFor(current);

                if (captureProofs.has(key)) return;

                const parent = parentOf(current);
                const context = capabilityContextFor(parent);
                const created = closureCreations.get(`${indexOf(current)}:${indexOf(context)}`) || 0;
                const creation = { ...current, execution: executionOf(parent) };
                const visit = kind => notify(observation, kind);
                const admitted = executableOnly ? 0 : admittedAt(capability, context, creation, visit);
                const callable = or(callableAt(capability, context, creation, visit), admitted);
                const { mutable = false } = capability;
                const writes = capabilityWrites.get(`${indexOf(capability)}:${indexOf(context)}`) || new Map();
                const changed = mutable && [...writes].some(([write = {}, reached = 0] = []) => later(write, creation) && and(created, reached));

                const inherited = parent && captureProofs.get(keyFor(parent));
                const guarded = !changed && (!and(created, not(callable)) || inherited === 'agreement');

                const status = guarded ? 'agreement' : 'contradiction';

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

        prepareFunction(model, observation);
        const proof = invocationProofs.get(`${indexOf(expression)}:${indexOf(context)}:${indexOf(capability)}`);

        const { guarded: localGuard = false, executable: localExecutable = false } = proof ? {} : regionProofFor(expression, model, capability, observation);

        if (executableOnly ? localExecutable : localGuard) return Object.freeze({ status: 'agreement', reason: 'Stable capability guarded within the acquired branch' });

        if (!proof) return Object.freeze({ status: 'unknown', reason: 'Invocation was not reached by supported completion evaluation' });

        const { guarded: admitted = false, executable = false } = proof;
        const guarded = executableOnly ? executable : admitted;
        const { execution: declaration = false, mutable = false } = capability;

        if (!guarded && unsupportedGuards.has(`${indexOf(capability)}:${indexOf(context)}`)) return Object.freeze({
            status: 'unknown', reason: 'A resolved predicate body is outside callable guard proof'
        });

        if (declaration !== execution && mutable && promiseResult) return Object.freeze({ status: 'unknown', reason: 'Mutable capture across asynchronous execution requires suspension evidence' });

        if (!guarded && declaration !== execution) {
            const status = guardedCapture(model, capability, observation, executableOnly);

            const missing = mutable ? 'Captured invocation has no callable guard that survives binding writes' : 'Captured invocation has no guard at closure creation';
            const reason = status === 'contradiction' ? missing : 'Captured invocation requires closure creation evidence';

            return Object.freeze({ status, reason: status === 'agreement' ? 'Stable capability guarded before closure creation' : reason });
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

        return put(sourceBoundaries, model, boundaries);
    };
    const contextsForUse = (expression, observation) => {
        const execution = executionOf(expression);
        const model = executionModels.get(execution) || (executionOf(root) === execution && root);
        const boundaries = sourcesFor(model, observation);

        return [...(modelContexts.get(model) || [])].filter(({ boundary = -1 } = {}) => boundaries.has(boundary));
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
    const checkMember = (expression, observation = {}) => {
        const execution = executionOf(expression);
        const context = contextFor(execution);
        const key = `${indexOf(expression)}:${indexOf(context)}`;

        if (memberQueries.has(key)) return memberQueries.get(key);

        const contexts = contextsForUse(expression, observation);
        const boundaries = new Set(contexts.map(({ boundary = -1 } = {}) => boundary));
        moduleRoots.forEach(model => retain(boundaries, contextFor(executionOf(model)).boundary));
        const invalid = (family) => {
            const { unconditional = false, uses = [] } = intrinsicExposures.get(family) ?? {};

            return unconditional || uses.some(({ expression: call = {}, lookup = {}, execution = false, ordered = false, repeated = false } = {}) => {
                const invoked = [...(exposedContexts.get(call) || [])].some(({ boundary = -1, depth = 0 } = {}) => depth && boundaries.has(boundary));

                if (lookup === expression && !repeated && !invoked && !externalExecutions.has(execution)) return false;

                if (externalExecutions.has(execution)) return true;

                const model = executionModels.get(execution);
                const contexts = ordered ? exposedContexts.get(call) : modelContexts.get(model);

                return [...(contexts || [])].some(({ boundary = -1 } = {}) => boundaries.has(boundary));
            });
        };
        const proofs = [...(memberProofs.get(key) || [])];
        const operations = contexts.flatMap(context => (
            [...(memberProofs.get(`${indexOf(expression)}:${indexOf(context)}`) || [])]
        ));
        const [{ expected = '' } = {}] = operations;
        const conflicts = [...new Set(operations.flatMap(({ conflicts = [] } = {}) => (
            conflicts.filter(family => !intrinsicExposures.has(family) || !invalid(family))
        )))].toSorted();
        const producers = new Map();
        const visited = new Set();

        operations.forEach(({ producers: root = false } = {}) => {
            if (!root) return;

            traverse(root, { enter: ({ source = false, owner = false, inputs = [] } = {}) => {
                const current = inputs;

                if (visited.has(current)) return [];

                retain(visited, current);

                if (source && readFamily({ owner, ...observation }).families.some(family => conflicts.includes(family))) put(producers, JSON.stringify(source), source);

                return inputs;
            } });
        });
        const result = Object.freeze({ missing: proofs.some(({ missing = false } = {}) => missing),
            conflicts: Object.freeze(conflicts), expected,
            producers: Object.freeze([...producers].toSorted(([a = ''] = [], [b = ''] = []) => a.localeCompare(b)).map(([, source = {}] = []) => source)),
            native: Boolean(proofs.length) && proofs.every(({ native = false } = {}) => native),
            incomplete: !proofs.length || proofs.some(({ incomplete = false } = {}) => incomplete),
            evidence: Object.freeze([...new Set(operations.map(({ family = false } = {}) => family))]) });

        notify(observation, 'member-query');

        return put(memberQueries, key, result);
    };
    const checkPromise = (expression, observation = {}) => {
        // Policy asks about the dropped expression independent of enclosing
        // reach. Its unconditional observations cannot enter a flow proof.
        const context = contextFor(executionOf(expression), standalone);
        const selected = task(expression, context);
        const key = keyOf(selected);

        if (promiseQueries.has(key)) return promiseQueries.get(key);

        const entry = evaluate(selected, observation);
        const value = valueOf(entry);
        const { promises = [] } = value ? valueModel.evidenceFor(value, () => notify(observation, 'value-ownership')) : {};
        const result = Object.freeze({ known: promises.includes('known'), incomplete: promises.includes('unknown'), alternatives: Object.freeze(promises),
            normal: Boolean(normalOf(entry)) });

        notify(observation, 'promise-query');

        return put(promiseQueries, key, result);
    };

    const callsFor = (expression, observation = {}) => {
        const keys = useKeys(expression, observation);

        return outcomes.describeCalls(keys.map(key => ({ key, entry: values.get(key) })), kind => notify(observation, kind));
    };

    return { ownerFor, useValue, ensure, defaulted, functionValue, completionFor, checkInvocation, checkCapability, checkMember, checkPromise, callsFor,
        counts: () => ({ contexts: contexts.size, values: values.size, decisions: decisions.count(), decisionWork: decisions.work() }) };
};
