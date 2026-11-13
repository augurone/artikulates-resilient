import { absent, createOwner, fromESTree } from 'eslint-plugin-resilient/agreement';

import { append, put, retain } from '../collections.js';
import { propertyName, prototypeDefinition } from '../estree-properties.js';
import { traverse } from '../traversal.js';
import { acquireArity } from './arity.js';
import { completeCallable } from './callables.js';
import { argumentMetadata } from './calls.js';
import { acquireCapabilities } from './capabilities.js';
import { createDecisions } from './decisions.js';
import { acquireFlow } from './flow.js';
import { intrinsicAbsence } from './initializers.js';
import { locationOf } from './locations.js';
import { acquireMemberBoundaries } from './member-boundaries.js';
import { intrinsicFamilies, nativeFunctions, nativeNamespaces, promiseFactories } from './native-members.js';
import { acquirePatterns, formalSlot } from './patterns.js';
import { ownsRecordFields } from './records.js';
import { acquireSignature } from './signatures.js';
import { unknownOwner } from './uncertainty.js';
import { acquireUses } from './uses.js';

const parameterOf = ({ index = -1, fallback = false, origin = {} } = {}) => {
    const { type = '' } = origin;

    return { position: index, fallback, origin, rest: type === 'RestElement' };
};
const nativePromiseConstructor = Object.freeze({ intrinsicPromise: true });
const bindingDependencies = ({ init = false, parameter = {}, declaration: { destructured = false } = {} } = {}) => {
    if (destructured) return [];

    const { fallback = false } = parameterOf(parameter);

    return [init || fallback].filter(Boolean);
};
// Syntax producers share owned template storage. Only these records reach
// demand; acquisition maps and compiler/parser objects stay outside this owner.
export const createModelStorage = () => {
    const expressions = [];
    const statements = [];
    const own = (description) => {
        const value = Object.freeze({ ...description, index: expressions.length });

        append(expressions, value);

        return value;
    };
    const ownStatement = (execution, description) => {
        const statement = Object.freeze({ ...description, execution, index: statements.length, statement: true });

        append(statements, statement);

        return statement;
    };
    const absence = own({ kind: 'source', promise: 'none', familyOnly: true, inert: true, truth: 0, absence: 'undefined', owner: createOwner({ evidence: absent() }) });
    const unknown = own({ kind: 'opaque', familyOnly: true, truth: -1, absence: 'unknown', owner: unknownOwner() });

    return { own, ownStatement, absence, unknown,
        counts: () => ({ expressions: expressions.length, completionContributions: statements.length }) };
};

// Own expression templates and function boundaries. This acquisition closure is
// discarded after preparation; demand receives only the records it produced.
export const acquireModel = ({ index = {}, callables = new Map(), callableSources = new Map(), namespaces: namespaceBindings = new Map(), decisionLimit = Infinity } = {}) => {
    const { functionEntries = [], references = [], identities = new WeakMap(), callableResolutions = new WeakMap(), executionOf = new WeakMap(), parents = new WeakMap(),
        writes = new Set(), opaqueExecutions = new Set(), opaqueCapabilities = new Set(), executionParents = new Map(), moduleOfExecution = new Map(), operators = new WeakMap(),
        initializerNames = new Map(), dynamicExecutions = new Set(), controlExecutions = new Set(), moduleEntries = [], sourceMembers = [], sourcePatterns = [], sourceCalls = [] } = index;
    const decisions = createDecisions({ limit: decisionLimit });
    const acquired = new WeakMap();
    const bindingKeys = new WeakMap();
    const bindingExpressions = new WeakMap();
    const unownedExpressions = new WeakMap();
    const patternValues = acquirePatterns({ ...index, destructurings: sourcePatterns });
    const invocationSources = new Map();
    const statementFlows = new WeakMap();
    const capabilityRegions = new Map();
    const arities = acquireArity(index);
    const functions = functionEntries.map(({ node = {}, body = {}, params = [], index: position = -1, execution = false } = {}) => {
        const { async = false, generator = false } = node;

        const code = generator ? 'generator-function' : 'opaque-execution';
        const supported = !generator && !opaqueExecutions.has(execution);

        return { functionModel: true, module: moduleOfExecution.get(execution), signature: acquireSignature({ node, index: position, arity: arities.get(node) }),
            promiseResult: async && !generator, index: position,
            location: locationOf(node), bodyLocation: locationOf(body), execution,
            parentExecution: executionParents.get(execution), hasDefaults: initializerNames.has(execution),
            ...(supported ? {} : { owner: unknownOwner({ code, location: locationOf(node) }) }), supported,
            capabilitySupported: !generator && !opaqueCapabilities.has(execution),
            initialization: params.some(({ type = '', left: { type: inner = '' } = {} } = {}) => (
                !['Identifier', 'AssignmentPattern'].includes(type) || (type === 'AssignmentPattern' && inner !== 'Identifier')
            )) };
    });
    const byFunction = new WeakMap(functionEntries.map(({ node = {} } = {}, position) => [node, functions.at(position)]));
    const namespaceExpressions = new WeakMap();
    const storage = createModelStorage();
    // eslint-disable-next-line resilient/prefer-safe-destructuring-defaults -- createModelStorage always installs these local constructors as own properties of a fresh record.
    const { own, ownStatement } = storage;
    const { absence, unknown } = storage;
    const unknownAt = (common, code = 'unsupported-expression') => own({ ...unknown, ...common, owner: unknownOwner({ ...common, code }) });
    // eslint-disable-next-line resilient/prefer-safe-destructuring-defaults -- The lexical index owns this required capability; acquisition checks it before use.
    const { contextFor } = index;
    const capabilities = acquireCapabilities({ index, callables }, contextFor);
    const { count: capabilitySubjects = 0 } = capabilities;
    const members = acquireMemberBoundaries({ ...index, memberAccesses: sourceMembers, callableSources,
        observesReceiver: node => capabilities.observesArgument(node),
        observesArrayElements: node => capabilities.observesArrayElements(node),
        observesFunction: node => capabilities.observesFunction(node) }, contextFor);
    const { exposedIntrinsics: nativeExposures = new Map() } = members;
    const intrinsicAt = (node) => {
        const intrinsic = members.intrinsicAt(node);
        const invalid = members.invalidFamiliesFor(node);
        const family = intrinsicFamilies.get(intrinsic.split('.').at(0)) || 'all';

        return members.supportsLookup(node) && !invalid.includes('all') && !invalid.includes(family) ? intrinsic : '';
    };
    const uses = acquireUses(node => members.promiseTargetFor(node), { index, capabilities, callables: callableSources, namespaces: namespaceBindings,
        nativeArrays: !nativeExposures.has('all') && !nativeExposures.has('array'),
        receiverFor: node => members.receiverFor(node), ownedMethodFor: node => members.ownedMethodFor(node),
        arrayMethodFor: node => members.arrayMethodFor(node),
        positionsSafe: (node, site) => members.positionsSafe(node, site) });
    const factoryFor = (node, name = '') => {
        const intrinsic = intrinsicAt(node);
        const factory = nativeFunctions.get(name ? `${intrinsic}.${name}` : intrinsic) || false;
        const { dependencies = [] } = factory ? factory : {};
        const invalid = members.invalidFamiliesFor(node);

        return dependencies.some(family => invalid.includes(family)) ? false : factory;
    };
    const noBinding = Object.freeze({ available: false });
    const bindingFor = (node) => {
        const binding = identities.get(node);

        if (!binding) return noBinding;

        const { execution = false, immutable = false, init = false, parameter: { index: position = -1 } = {} } = binding;
        const mutableInitial = !immutable && init && callableResolutions.get(node) === binding && !opaqueExecutions.has(execution);

        if (!immutable && init && opaqueExecutions.has(execution)) return noBinding;

        if (writes.has(binding) && !mutableInitial) return noBinding;

        if (execution !== executionOf.get(node)) return ((callableSources.has(binding) || namespaceBindings.has(binding)) && callableResolutions.get(node) === binding) ||
            members.captureSafe(node) ? binding : noBinding;

        const { range: [, initialized = Infinity] = [] } = init ?? {};
        const { range: [read = -1] = [] } = node;
        const selected = patternValues.forBinding(binding);

        if ((position >= 0 || (selected && (!init || (immutable && initialized <= read)))) && !opaqueExecutions.has(execution)) return binding;

        return callableResolutions.get(node) || noBinding;
    };
    const bindingKey = binding => bindingKeys.get(binding) || put(bindingKeys, binding, Symbol('stable value'));
    const valueDependencies = (node = {}) => {
        const { type = '', test = {}, consequent = {}, alternate = {}, left = {}, right = {}, argument = {}, arguments: args = [],
            object = {}, callee = {}, tag = {}, quasi: { expressions: substitutions = [] } = {}, properties = [], elements = [] } = node;

        const { lifetime = false, call = false, prior = false } = node;

        if (lifetime) return call ? [prior, call].filter(Boolean) : [];

        const { patternValue = '', target = false, fallback = false, init = false, parameter = false } = node;

        if (patternValue) return patternValue === 'root' ? bindingDependencies({ init, parameter: parameter || {} }) : [target, fallback].filter(Boolean);

        if (type === 'Identifier') {
            const binding = bindingFor(node);
            const selected = patternValues.forBinding(binding);

            return [...(selected ? [selected] : bindingDependencies(binding)), (callableSources.has(binding) ? false : members.lifetimeFor(node))].filter(Boolean);
        }

        if (type === 'ConditionalExpression') return [test, consequent, alternate];

        if (['LogicalExpression', 'BinaryExpression'].includes(type)) return [left, right];

        if (['UnaryExpression', 'AwaitExpression', 'SpreadElement'].includes(type)) return [argument];

        if (type === 'MemberExpression') return [object, members.writeFor(node)].filter(Boolean);

        if (type === 'AssignmentExpression') {
            const { object = false } = left;

            return [object, right].filter(Boolean);
        }

        if (type === 'ArrayExpression') return elements.filter(Boolean);

        if (type === 'ObjectExpression') return properties.flatMap(({ type = '', computed = false, key = {}, value = {}, argument = {} } = {}) => (
            type === 'SpreadElement' ? [argument] : [...(computed ? [key] : []), value]
        ));

        if (['CallExpression', 'NewExpression'].includes(type)) return [callee, ...args];

        if (type === 'TaggedTemplateExpression') return [tag, ...substitutions];

        return [];
    };
    const dependencies = node => [...new Set([...valueDependencies(node), ...uses.forContainer(node)])];
    const read = node => acquired.get(node) || unknown;
    const fallbackFor = (node, { type = '' } = {}) => {
        const value = read(node);
        const { kind = '', entries = [] } = value;

        // An empty default on a value binding declares an open object boundary.
        // A named nested pattern still owns its explicit field requirements.
        return type === 'Identifier' && kind === 'record' && !entries.length ? own({ ...value, open: true, openDefault: true }) : value;
    };
    const compileBinding = (node, { location = {}, ...common } = {}) => {
        const binding = bindingFor(node);
        const { available = false, init = false, parameter = {} } = binding;

        if (!available) {
            const identified = identities.get(node);
            const { execution = false, declaration: { destructured = false } = {} } = identified ?? {};
            const code = [!identified && 'unresolved-binding', opaqueExecutions.has(execution) && 'opaque-execution',
                execution !== executionOf.get(node) && 'captured-value', destructured && 'destructured-binding', 'unstable-binding'].find(Boolean);

            return unknownAt({ ...common, location }, code);
        }

        if (bindingExpressions.has(binding)) return bindingExpressions.get(binding);

        const namespace = namespaceBindings.get(binding);
        const existingNamespace = namespace && namespaceExpressions.get(namespace);

        if (existingNamespace) return put(bindingExpressions, binding, existingNamespace);

        if (namespace) {
            const { fields = new Map(), open = false } = namespace;
            const entries = [...fields].map(([name = '', target = false] = []) => {
                const callable = byFunction.get(callableSources.get(target) || target);
                const value = callable ? own({ kind: 'source', inert: true, callable, truth: 1, absence: 'present', promise: 'none',
                    owner: createOwner({ evidence: fromESTree({ type: 'FunctionExpression' }, { projection: 'family' }) }) }) : unknown;

                return Object.freeze({ name, known: true, data: true, value });
            });

            const expression = own({ ...common, location, kind: 'record', entries: Object.freeze(entries), trusted: true, open });

            put(namespaceExpressions, namespace, expression);

            return put(bindingExpressions, binding, expression);
        }

        const callable = !init && byFunction.get(callableSources.get(binding));

        if (callable) return put(bindingExpressions, binding, own({ ...common, location, kind: 'source', callable, inert: true, familyOnly: true,
            truth: 1, absence: 'present', promise: 'none', owner: createOwner({ evidence: fromESTree({ type: 'FunctionExpression' }, { projection: 'family' }) }) }));

        const selected = patternValues.forBinding(binding);

        if (selected) return put(bindingExpressions, binding, read(selected));

        const { declaration: { destructured = false } = {} } = binding;

        if (destructured) return unknownAt({ ...common, location }, 'destructured-binding');

        const { position = -1, fallback = false, origin = {}, rest = false } = parameterOf(parameter);
        const { type: initializerType = '' } = init ? init : {};

        return put(bindingExpressions, binding, own({ ...common, location: position >= 0 ? locationOf(origin) : location,
            ...(position >= 0 ? { owner: unknownOwner({ code: 'parameter-input', location: locationOf(origin) }) } : {}),
            key: bindingKey(binding), capability: capabilities.subjectFor(origin), kind: position >= 0 ? 'parameter' : 'link',
            transfer: ['CallExpression', 'AwaitExpression'].includes(initializerType),
            target: init ? read(init) : unknown, familyOnly: init ? read(init).familyOnly : true, position, rest, fallback: fallback ? read(fallback) : false }));
    };
    const prefixFor = (first, args, { execution = false, location = {} } = {}) => args.reduce(
        (left, argument) => own({ kind: 'sequence', execution, location, left, right: read(argument) }), read(first));
    const compileCall = (node = {}, common) => {
        const { type: callType = '', callee = {}, optional = false, arguments: args = [] } = node;
        const { type = '', name: calleeName = '', object = {}, property: { name = '' } = {} } = callee;
        const { method = '', replacement = false, uncertain = false } = members.receiverFor(callee);
        const subject = method && !replacement && !uncertain ? object : callee;
        const invocation = capabilities.subjectFor(subject);
        const { guarded = false } = contextFor(node);
        const described = { ...common, invocation, guarded: guarded || controlExecutions.has(executionOf.get(node)),
            invalidFamilies: members.invalidFamiliesFor(node), argumentFresh: Object.freeze(args.map((argument) => {
                const { type = '' } = argument;

                return type === 'ArrayExpression' || ownsRecordFields(argument);
            })),
            capabilityTest: capabilities.testFor(node), name: type === 'Identifier' ? calleeName : name,
            argumentMetadata: Object.freeze(args.map(argumentMetadata)), argumentOwned: Object.freeze(args.map(argument => ownsRecordFields(argument) || members.safe(argument, node))) };
        const direct = byFunction.get(callee);
        const resolved = direct || byFunction.get(callableSources.get(callableResolutions.get(callee)));

        [resolved, ...args.map(argument => byFunction.get(argument) || byFunction.get(callableSources.get(callableResolutions.get(argument))))].filter(Boolean).forEach((model) => {
            retain(invocationSources.get(model) || put(invocationSources, model, new Set()), executionOf.get(node));
        });
        const { execution: calleeExecution = false } = resolved ?? {};
        // Async identity proves the result without executing a dependency body.
        // A literal callee also survives dynamic lexical lookup in its caller.
        const available = direct || !dynamicExecutions.has(executionOf.get(node));
        const model = available && resolved;
        const imported = moduleOfExecution.get(calleeExecution) !== moduleOfExecution.get(executionOf.get(node));

        if (optional) return unknownAt(described, 'optional-call');

        if (args.some(({ type = '' } = {}) => type === 'SpreadElement')) return unknownAt({ ...described, prefix: prefixFor(callee, args, common) }, 'spread-call');

        if (!available) return unknownAt(described, 'opaque-execution');

        if (callType === 'NewExpression') {
            const promiseConstructor = intrinsicAt(callee) === 'Promise';

            return promiseConstructor ? own({ ...described, kind: 'call', function: nativePromiseConstructor, arguments: Object.freeze(args.map(read)) })
                : own({ ...described, kind: 'member-call', construct: true, callee: read(callee), arguments: Object.freeze(args.map(read)),
                    owner: unknownOwner({ ...common, code: 'unresolved-call' }) });
        }

        // A closure passed directly to an opaque call can only be created on
        // paths reaching that call. This over-approximates creation, without
        // evaluating opaque arguments or borrowing a consumer's runtime value.
        if (!model) return own({ ...described, kind: 'member-call', callee: read(callee), arguments: Object.freeze(args.map(read)),
            closures: Object.freeze(args.map(argument => byFunction.get(argument)).filter(Boolean)), owner: unknownOwner({ ...common, code: 'unresolved-call' }) });

        return own({ ...described, kind: 'call', owner: unknownOwner({ ...common, code: imported ? 'imported-result' : 'recursive-call' }),
            function: model, arguments: Object.freeze(args.map(read)) });
    };
    const readBinding = (node, common) => {
        const { capabilities: observed = [], ...source } = common;
        const binding = compileBinding(node, source);
        const { guarded = false } = common;
        const safe = namespaceBindings.has(bindingFor(node)) || members.safe(node);
        const lifetime = callableSources.has(bindingFor(node)) ? false : members.lifetimeFor(node);

        if (!safe && lifetime) return own({ ...common, kind: 'unowned', target: binding, lifetime: read(lifetime) });

        if (guarded || observed.length) return own({ ...common, kind: safe ? 'use' : 'unowned', target: binding });

        return safe ? binding : unownedExpressions.get(binding) || put(unownedExpressions, binding, own({ ...common, kind: 'unowned', target: binding }));
    };
    const compileSelection = ({ patternValue = '', node = {}, target = false, fallback = false, init = false, parameter = false, name = '', position: slot = -1, formal = false } = {}) => {
        const execution = executionOf.get(node);
        const common = { execution, module: moduleOfExecution.get(execution), location: locationOf(node), capability: capabilities.subjectFor(node), truth: -1,
            guarded: controlExecutions.has(execution) };

        if (patternValue === 'default') return own({ ...read(target), ...common, fallback: fallbackFor(fallback, node) });

        if (patternValue === 'field') return own(formal && slot >= 0 ? formalSlot({ ...common, target: read(target), slot })
            : { ...common, kind: 'selection', target: read(target), name, slot, formal, fallback: false });

        const { type: initializerType = '' } = init ? init : {};

        if (!parameter) return own({ ...common, kind: 'use', target: read(init), transfer: ['CallExpression', 'AwaitExpression'].includes(initializerType) });

        const { position = -1, fallback: initial = false, origin = {}, rest = false } = parameterOf(parameter);

        return own({ ...common, kind: 'parameter', key: bindingKey(origin), position, rest,
            fallback: initial ? read(initial) : false, owner: unknownOwner({ ...common, code: 'parameter-input' }) });
    };
    const compile = (node = {}) => {
        const { lifetime = false, call = false, prior = false, ordered = false, patternValue = '' } = node;

        if (lifetime) return own({ kind: 'lifetime', call: call ? read(call) : false, prior: prior ? read(prior) : false, ordered });

        if (patternValue) return compileSelection(node);

        const { type = '', test = {}, consequent = {}, alternate = {}, left = {}, right = {}, argument = {},
            elements = [], properties = [], regex = false, object = {}, computed = false, property = {}, optional = false, tag = {},
            quasi: { expressions: substitutions = [] } = {} } = node;
        const operator = operators.get(node) || '';
        const execution = executionOf.get(node);
        const { guarded = false } = contextFor(node);
        const common = { execution, module: moduleOfExecution.get(execution), location: locationOf(node), truth: -1, guarded: guarded || controlExecutions.has(execution),
            capabilities: Object.freeze([...new Set(uses.forCall(node).map(({ capability = false } = {}) => capability))]) };
        const observations = Object.freeze(uses.forContainer(node).map(read));

        if (type === 'ObjectExpression') {
            const entries = properties.map((entry = {}) => {
                const { type = '', kind = 'init', computed = false, key = {}, value = {}, argument = {} } = entry;
                const { known = false, name = '' } = propertyName(entry);

                return Object.freeze({ name, known: known && type === 'Property' && !prototypeDefinition(entry),
                    data: kind === 'init', value: read(type === 'SpreadElement' ? argument : value), key: computed ? read(key) : false });
            });

            return own({ ...common, observations, kind: 'record', entries: Object.freeze(entries),
                standardPrototype: !properties.some(prototypeDefinition) && !members.invalidFamiliesFor(node).includes('all'),
                trusted: !properties.some(({ kind = 'init', ...entry } = {}) => kind !== 'init' || prototypeDefinition({ kind, ...entry })),
                owner: unknownOwner({ ...common, code: 'unsupported-expression' }) });
        }

        const { type: targetType = '', object: receiver = false, computed: dynamic = false, optional: conditional = false, property: { name: field = '' } = {} } = left;
        const revision = type === 'AssignmentExpression' && operator === '=' && targetType === 'Identifier' && capabilities.subjectFor(left);

        if (revision) return own({ ...common, kind: 'revision', argument: read(right), revision });

        if (type === 'AssignmentExpression' && operator === '=' && targetType === 'MemberExpression' && !dynamic && !conditional) return own({
            ...common, kind: 'assignment', target: read(receiver), argument: read(right), name: field
        });

        const write = type === 'MemberExpression' && members.writeFor(node);

        if (write) return own({ ...common, kind: 'assigned', target: read(write) });

        if (type === 'MemberExpression') {
            const { name = '' } = property;
            const invalidFamilies = members.invalidFamiliesFor(node);
            const promiseFactory = intrinsicAt(object) === 'Promise' && promiseFactories.has(name);

            return own({ ...common, kind: 'member', target: read(object), name, invalidFamilies, promiseFactory,
                promiseMethod: promiseFactory ? name : '',
                nativeNamespace: !computed && !optional && nativeNamespaces.get(intrinsicAt(node)),
                nativeFactory: !computed && !optional && factoryFor(object, name),
                supported: !computed && !optional && !invalidFamilies.includes('all') && members.supportsLookup(object), owner: unknownOwner({ ...common, code: 'unsupported-expression' }) });
        }

        if (type === 'ArrayExpression' && !elements.length) return own({ ...common, kind: 'source', familyOnly: true, inert: true, slots: Object.freeze([]),
            nativeTag: members.invalidFamiliesFor(node).some(family => ['all', 'array'].includes(family)) ? '' : 'Array',
            truth: 1, absence: 'present', promise: 'none', standardPrototype: !members.invalidFamiliesFor(node).some(family => ['all', 'array'].includes(family)),
            owner: createOwner({ evidence: fromESTree({ type }, { projection: 'family' }) }) });

        if (type === 'ArrayExpression') return own({ ...common, kind: 'array', arguments: Object.freeze(elements.map(element => element ? read(element) : absence)),
            argumentOwned: Object.freeze(elements.map(element => !element || ownsRecordFields(element) || members.safe(element, node))),
            holes: Object.freeze(elements.map(element => !element)), fixed: !elements.filter(Boolean).some(({ type = '' } = {}) => type === 'SpreadElement'),
            standardPrototype: !members.invalidFamiliesFor(node).some(family => ['all', 'array'].includes(family)) });

        if (type === 'SpreadElement') return own({ ...common, kind: 'spread', argument: read(argument) });

        if (['Literal', 'ArrowFunctionExpression', 'FunctionExpression'].includes(type)) {
            const value = type === 'Literal' ? Reflect.get(node, 'value') : false;
            const literal = type === 'Literal' ? { type, value, ...(regex ? { regex } : {}) } : { type };
            const truth = type === 'Literal' ? Number(Boolean(value)) : 1;
            const primitive = value === null || ['string', 'number', 'boolean', 'bigint'].includes(typeof value);
            const prototypeFamily = type === 'Literal' ? 'regexp' : 'function';

            return own({ ...common, observations, kind: 'source', promise: 'none', familyOnly: true, truth, constant: type === 'Literal' && !regex && primitive ? Object.freeze({ value }) : false,
                standardPrototype: !members.invalidFamiliesFor(node).some(family => ['all', prototypeFamily].includes(family)),
                closure: byFunction.get(node), callable: byFunction.get(node),
                absence: type === 'Literal' && value === null ? 'null' : 'present', inert: true,
                owner: createOwner({ evidence: fromESTree(literal, { projection: 'family' }) }) });
        }

        if (!opaqueExecutions.has(execution) && intrinsicAbsence(node, identities)) return own({ ...absence, ...common, truth: 0 });

        if (type === 'Identifier') {
            const intrinsic = intrinsicAt(node);
            const factory = factoryFor(node);

            return intrinsic ? own({ ...common, kind: 'source', callable: factory, truth: 1, absence: 'present', inert: true, promise: 'none',
                owner: createOwner({ evidence: fromESTree({ type: intrinsic === 'Reflect' ? 'ObjectExpression' : 'FunctionExpression' }, { projection: 'family' }) }) }) : readBinding(node, common);
        }

        if (type === 'ConditionalExpression') return own({ ...common, kind: 'conditional', test: read(test), yes: read(consequent), no: read(alternate),
            yesLocation: locationOf(consequent), noLocation: locationOf(alternate) });

        if (type === 'LogicalExpression') return own({ ...common, kind: 'logical', operator, left: read(left), right: read(right) });

        if (type === 'UnaryExpression' && ['!', 'typeof', 'void', '+', '-'].includes(operator)) return own({ ...common, kind: 'unary', operator,
            argument: read(argument), owner: createOwner({ evidence: fromESTree({ type, operator }, { projection: 'family' }) }),
            ...(operator === 'typeof' ? { truth: 1 } : {}) });

        if (type === 'BinaryExpression' && ['===', '!==', '==', '!=', '<', '>', '<=', '>=', 'in', 'instanceof'].includes(operator)) {
            return own({ ...common, kind: 'boolean', operator, left: read(left), right: read(right), inert: ['===', '!=='].includes(operator),
                capabilityTest: capabilities.testFor(node),
                owner: createOwner({ evidence: fromESTree({ type, operator }, { projection: 'family' }) }) });
        }

        if (['CallExpression', 'NewExpression'].includes(type)) return compileCall(node, { ...common, observations });

        if (type === 'TaggedTemplateExpression') return unknownAt({ ...common, observations, prefix: prefixFor(tag, substitutions, common) });

        if (type === 'AwaitExpression') return own({ ...common, kind: 'await', argument: read(argument), owner: unknownOwner({ ...common, code: 'unresolved-settlement' }) });

        return unknownAt({ ...common, observations });
    };
    const expressionFor = (node) => {
        if (!node) return absence;

        traverse(node, { enter: value => acquired.has(value) ? [] : dependencies(value), leave: (value) => {
            if (!acquired.has(value)) put(acquired, value, compile(value));
        } });

        return read(node);
    };

    functionEntries.forEach(({ body = {} } = {}, position) => {
        const model = functions.at(position);
        const { execution = false, supported = false, capabilitySupported = false } = model;
        const flow = supported || capabilitySupported ? acquireFlow({ body, expressionFor, patterns: patternValues, nodes: statementFlows,
            own: description => ownStatement(execution, description), absence }) : ownStatement(execution, { kind: 'unsupported' });

        completeCallable(model, flow);
    });

    const moduleRoots = moduleEntries.map(({ filename = '', execution = false, program = {} } = {}, position) => ({
        functionModel: true, index: functions.length + position, execution, module: filename,
        supported: !opaqueExecutions.has(execution), bodyLocation: locationOf(program),
        flow: acquireFlow({ body: program, expressionFor, patterns: patternValues, nodes: statementFlows, own: description => ownStatement(execution, description), absence })
    }));
    const modules = new Map(moduleRoots.map((model) => {
        const { module = '' } = model;

        return [module, model];
    }));

    moduleRoots.forEach((model, position) => {
        const { dependencies = [] } = moduleEntries.at(position);

        Object.defineProperty(model, 'imports', { value: Object.freeze(dependencies.map(name => modules.get(name))), enumerable: true });
        Object.freeze(model);
    });
    const [root = {}] = moduleRoots;
    const registerCapabilityRegion = (node) => {
        const expression = expressionFor(node);
        const { repeated = false, region = false } = contextFor(node);
        const flow = region && statementFlows.get(region);

        if (repeated && flow) put(capabilityRegions, expression, flow);
    };

    sourceCalls.forEach(({ node = {} } = {}) => registerCapabilityRegion(node));
    uses.observedNodes.forEach(registerCapabilityRegion);
    const externalExecutions = new Set();
    const discardedValues = new WeakMap();
    const transparent = (node) => {
        const parent = parents.get(node) ?? {};
        const { type = '', value = false, kind = 'init' } = parent;

        return type === 'ArrayExpression' || type === 'ObjectExpression' || (type === 'Property' && value === node && kind === 'init');
    };
    const discarded = (node) => {
        traverse(node, {
            enter: current => discardedValues.has(current) || !transparent(current) ? [] : [parents.get(current)],
            leave: (current) => {
                if (discardedValues.has(current)) return;

                const parent = parents.get(current) ?? {};
                const { type = '', test = false } = parent;
                const unused = type === 'ExpressionStatement' || (type === 'UnaryExpression' && ['!', 'typeof', 'void'].includes(operators.get(parent))) ||
                    (['IfStatement', 'ConditionalExpression'].includes(type) && test === current);

                put(discardedValues, current, unused || (transparent(current) && discardedValues.get(parent)));
            }
        });

        return discardedValues.get(node);
    };
    const exposeFunction = (node) => {
        const model = byFunction.get(node);
        const { execution = false } = model ?? {};

        if (model) retain(externalExecutions, execution);
    };

    references.forEach(({ node = {}, parent = {} } = {}) => {
        const binding = identities.get(node);
        const callable = callableSources.get(binding);
        const { declaration: { node: declared = false } = {} } = binding ?? {};

        if (!callable || node === declared) return;

        const { type = '', callee = false, init = false, id = {} } = parent;
        const alias = type === 'VariableDeclarator' && init === node && callableSources.get(identities.get(id)) === callable;

        if (!alias && !(type === 'CallExpression' && callee === node) && !discarded(node)) exposeFunction(callable);
    });
    functionEntries.forEach(({ node = {} } = {}) => {
        const parent = parents.get(node) ?? {};
        const { type = '', callee = false, id = {} } = parent;
        const { type: container = '' } = parents.get(parent) ?? {};
        const { type: declaration = '' } = parents.get(parents.get(parent)) ?? {};
        const bound = type === 'VariableDeclarator' && callableSources.get(identities.get(id)) === node;
        const { type: kind = '' } = node;

        if (type.startsWith('Export') || (bound && declaration.startsWith('Export')) ||
            (!bound && kind !== 'FunctionDeclaration' && !(type === 'CallExpression' && callee === node) && !discarded(node)) || container.startsWith('Export')) exposeFunction(node);
    });
    const callees = new Map();

    invocationSources.forEach((callers, { execution = false } = {}) => callers.forEach(caller => retain(callees.get(caller) || put(callees, caller, new Set()), execution)));
    const exposed = new Set();

    [...externalExecutions].forEach(execution => traverse(execution, { enter: (current) => {
        if (exposed.has(current)) return [];

        retain(exposed, current);
        retain(externalExecutions, current);

        return [...(callees.get(current) || [])];
    } }));
    const { exposedIntrinsics = new Map(), exposedArguments = new WeakMap() } = members;
    const intrinsicExposures = new Map([...exposedIntrinsics].map(([family = '', calls = new Set()] = []) => [family, Object.freeze({
        unconditional: calls.has(false), uses: Object.freeze([...calls].filter(Boolean).map((node) => {
            const { callee = {} } = node;
            const { repeated = false } = contextFor(node);
            const argumentsList = exposedArguments.get(node) || new Set();

            return Object.freeze({ expression: expressionFor(node), lookup: expressionFor(callee), execution: executionOf.get(node),
                ordered: contextFor(node).ordered, repeated, callbackOnly: argumentsList.size === 1 && argumentsList.has(0) });
        }))
    })]));

    return { expressionFor, patternFor: (node, pattern) => {
        const selection = patternValues.forNode(node, pattern);

        return selection ? expressionFor(selection) : unknown;
    }, functions: Object.freeze(functions), root, moduleRoots: Object.freeze(moduleRoots), decisions, absence, unknown, capabilities, uses, contextFor, invocationSources,
    intrinsicExposures, externalExecutions, capabilityRegions,
    counts: () => ({ functions: functions.length, ...storage.counts(), capabilitySubjects,
        decisions: decisions.count(), decisionWork: decisions.work() }) };
};
