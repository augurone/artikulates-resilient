import { absent, createOwner, fromESTree } from 'eslint-plugin-resilient/agreement';

import { append, put, retain } from '../collections.js';
import { sourcePropertyName as propertyName, prototypeDefinition } from '../estree-properties.js';
import { primitiveLiteral } from '../primitive-expressions.js';
import { traverse } from '../traversal.js';
import { acquireArgumentLists } from './argument-positions.js';
import { acquireArity } from './arity.js';
import { completeCallable } from './callables.js';
import { argumentMetadata } from './calls.js';
import { acquireCapabilities } from './capabilities.js';
import { createDecisions } from './decisions.js';
import { acquireFlow } from './flow.js';
import { intrinsicAbsence } from './initializers.js';
import { locationOf } from './locations.js';
import { acquireMemberBoundaries } from './member-boundaries.js';
import { nativeFunctions, nativeFunctionNamespaces, nativeNamespaces, promiseFactories } from './native-members.js';
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
    const { functionEntries = [], identities = new WeakMap(), callableResolutions = new WeakMap(), executionOf = new WeakMap(), parents = new WeakMap(),
        writes = new Set(), opaqueExecutions = new Set(), opaqueCapabilities = new Set(), executionParents = new Map(), moduleOfExecution = new Map(), operators = new WeakMap(),
        initializerNames = new Map(), initializerFacts = new WeakMap(), initializerTargets = new WeakMap(), dynamicExecutions = new Set(), controlExecutions = new Set(),
        moduleEntries = [], importTargets = new Map(), importProviders = new Map(),
        sourceMembers = [], sourcePatterns = [], sourceCalls = [] } = index;
    const decisions = createDecisions({ limit: decisionLimit });
    const acquired = new WeakMap();
    const bindingKeys = new WeakMap();
    const bindingExpressions = new WeakMap();
    const absenceInitializers = new WeakMap();
    const importExpressions = new WeakMap();
    const captureExpressions = new WeakMap();
    const captureInputs = new WeakSet();
    const lexicalExecutions = new Set();
    const lexicalCallers = new Map();
    const unownedExpressions = new WeakMap();
    const patternValues = acquirePatterns({ ...index, destructurings: sourcePatterns });
    const bindingExecutions = new Set(functionEntries.filter(({ entryParameters = [] } = {}) => entryParameters.length).map(({ execution = false } = {}) => execution));
    const parameterPositions = new WeakMap();
    const fieldPositions = new WeakMap();

    functionEntries.forEach(({ params = [], entryParameters = [] } = {}) => {
        if (!entryParameters.length) return;

        params.forEach((parameter, formal) => {
            put(parameterPositions, parameter, { formal, field: -1 });

            if (!patternValues.ordered(parameter)) return;

            const { left = parameter } = parameter;
            const { properties = [] } = left;

            properties.forEach(({ value = {} } = {}, field) => {
                const { type = '', left = value } = value;

                put(fieldPositions, left, field);

                if (type === 'AssignmentPattern') put(parameterPositions, value, { formal, field });
            });
        });
    });
    const invocationSources = new Map();
    const statementFlows = new WeakMap();
    const statementPrefixes = new WeakMap();
    const capabilityPrefixes = new Map();
    const capabilityRegions = new Map();
    const arities = acquireArity(index);
    const functions = functionEntries.map(({ node = {}, body = {}, params = [], index: position = -1, execution = false } = {}) => {
        const { async = false, generator = false } = node;

        const code = generator ? 'generator-function' : 'opaque-execution';
        const supported = !generator && !opaqueExecutions.has(execution);

        return { functionModel: true, module: moduleOfExecution.get(execution), signature: acquireSignature({ node, index: position, arity: arities.get(node) }),
            promiseResult: async && !generator, asynchronous: async, index: position,
            location: locationOf(node), bodyLocation: locationOf(body), execution,
            parentExecution: executionParents.get(execution), hasDefaults: initializerNames.has(execution),
            parameterInitialization: Object.freeze(params.map(parameter => patternValues.initializationFor(parameter))),
            orderedEntry: bindingExecutions.has(execution),
            ...(supported ? {} : { owner: unknownOwner({ code, location: locationOf(node) }) }), supported,
            capabilitySupported: !generator && !opaqueCapabilities.has(execution),
            initialization: params.some(({ type = '', left: { type: inner = '' } = {} } = {}) => (
                !['Identifier', 'AssignmentPattern'].includes(type) || (type === 'AssignmentPattern' && inner !== 'Identifier')
            )) };
    });
    const byFunction = new WeakMap(functionEntries.map(({ node = {} } = {}, position) => [node, functions.at(position)]));
    const namespaceExpressions = new WeakMap();
    const storage = createModelStorage();

    // eslint-disable-next-line resilient/prefer-safe-destructuring-defaults -- createModelStorage installs both constructors and both required value templates on its fresh private record.
    const { own, ownStatement, absence, unknown } = storage;
    const unknownAt = (common, code = 'unsupported-expression') => own({ ...unknown, ...common, owner: unknownOwner({ ...common, code }) });

    // eslint-disable-next-line resilient/prefer-safe-destructuring-defaults -- The lexical index owns this required capability; acquisition checks it before use.
    const { contextFor } = index;
    const capabilities = acquireCapabilities({ index, callables }, contextFor);
    const { count: capabilitySubjects = 0 } = capabilities;
    const members = acquireMemberBoundaries({ ...index, memberAccesses: sourceMembers, callableSources,
        selectionFor: binding => patternValues.forBinding(binding),
        observesReceiver: node => capabilities.observesArgument(node),
        observesArrayElements: node => capabilities.observesArrayElements(node),
        observesFunction: node => capabilities.observesFunction(node) }, contextFor);
    const intrinsicAt = (node) => {
        const intrinsic = members.intrinsicAt(node);

        return intrinsic;
    };
    const argumentLists = acquireArgumentLists();
    const freshValues = new WeakMap();
    const ownsFreshValue = (node) => {
        traverse(node, { enter: (source) => {
            const { type = '', consequent = {}, alternate = {} } = source;

            return !freshValues.has(source) && type === 'ConditionalExpression' ? [consequent, alternate] : [];
        }, leave: (source) => {
            const { type = '', consequent = {}, alternate = {} } = source;
            const literal = type === 'ArrayExpression' || ownsRecordFields(source);
            const selected = type === 'ConditionalExpression' && freshValues.get(consequent) && freshValues.get(alternate);

            put(freshValues, source, literal || selected);
        } });

        return Boolean(freshValues.get(node));
    };
    const uses = acquireUses(node => members.promiseTargetFor(node), { index, capabilities, callables: callableSources, namespaces: namespaceBindings, argumentLists,
        receiverFor: node => members.receiverFor(node), ownedMethodFor: node => members.ownedMethodFor(node),
        arrayMethodFor: (node, dataName) => members.arrayMethodFor(node, dataName),
        reductionChanges: node => members.reductionChanges(node),
        positionsSafe: (node, site) => members.positionsSafe(node, site) });
    const factoryFor = (node, name = '') => {
        const intrinsic = intrinsicAt(node);

        return nativeFunctions.get(name ? `${intrinsic}.${name}` : intrinsic) || false;
    };
    const noBinding = Object.freeze({ available: false });
    const naturalInitializer = (node) => {
        const binding = identities.get(node);
        const { naturalAbsence = false, execution = false, declaration: { node: declared = {} } = {} } = binding ?? {};

        if (!naturalAbsence) return false;

        return absenceInitializers.get(binding) || put(absenceInitializers, binding,
            own({ ...absence, execution, location: locationOf(declared) }));
    };
    const bindingFor = (node) => {
        const binding = identities.get(node);

        if (!binding) return noBinding;

        const { execution = false, immutable = false, init = false, caught = false, naturalAbsence = false,
            declaration: { node: declaredNode = {} } = {}, parameter: { index: position = -1 } = {} } = binding;
        const mutableInitial = !immutable && init && callableResolutions.get(node) === binding && !opaqueExecutions.has(execution);

        if (!immutable && init && opaqueExecutions.has(execution)) return noBinding;

        if (writes.has(binding) && !mutableInitial) return noBinding;

        const initializer = initializerTargets.get(node) ?? {};
        const { left = false } = initializer;
        const { parameterSource: { index: original = -1 } = {} } = identities.get(left) ?? {};
        const step = parameterPositions.get(initializer);
        const { formal: initializing = original, field = -1 } = step ?? {};
        const { parameterSource: { index: formal = -1 } = {} } = binding;
        const earlierField = field >= 0 && fieldPositions.has(declaredNode) && fieldPositions.get(declaredNode) < field;
        const unavailable = step ? formal < 0 || formal > initializing || (formal === initializing && !earlierField)
            : position < 0 || position >= initializing;

        if (initializing >= 0 && execution === executionOf.get(node) && unavailable) return noBinding;

        if (execution !== executionOf.get(node)) return ((callableSources.has(binding) || namespaceBindings.has(binding)) && callableResolutions.get(node) === binding) ||
            members.captureSafe(node) || members.captureValue(node) ? binding : noBinding;

        const { range: [, initialized = Infinity] = [] } = init ?? {};
        const { range: [read = -1] = [] } = node;
        const { range: [, absenceReady = Infinity] = [] } = declaredNode;
        const { parameterSource: { origin: { range: [declared = -1] = [] } = {} } = {} } = binding;

        if (position >= 0 && read < declared) return noBinding;

        const selected = patternValues.forBinding(binding);

        if ((caught || position >= 0 || (naturalAbsence && absenceReady <= read) ||
            (selected && (!init || (immutable && initialized <= read)))) && !opaqueExecutions.has(execution)) return binding;

        return callableResolutions.get(node) || noBinding;
    };
    const receiverRead = (node) => {
        const { type = '', callee = false } = parents.get(node) ?? {};

        // Direct invocation needs callable identity, not its mutable properties.
        // Other reads can forward the callable into a later protocol lookup.
        if (type === 'CallExpression' && callee === node && callableSources.has(bindingFor(node))) return false;

        return true;
    };
    const receiverLifetimeFor = node => receiverRead(node) && members.lifetimeFor(node);
    const receiverProtocolFor = node => receiverRead(node) ? members.protocolFor(node) : {};
    const bindingKey = binding => bindingKeys.get(binding) || put(bindingKeys, binding, Symbol('stable value'));
    const importedSource = (target) => {
        if (target === false) return false;

        const { immutable = false, init = false, type = '', execution = false, declaration: { destructured = false } = {} } = target;

        if (writes.has(target) || opaqueExecutions.has(execution) || destructured) return false;

        if (immutable && init) return init;

        return type ? target : false;
    };
    const valueDependencies = (node = {}) => {
        const { type = '', test = {}, consequent = {}, alternate = {}, left = {}, right = {}, argument = {}, arguments: args = [],
            object = {}, callee = {}, tag = {}, quasi: { expressions: substitutions = [] } = {}, expressions = [], properties = [], elements = [] } = node;

        const { lifetime = false, call = false, prior = false, adopted = false, subject = false } = node;

        if (lifetime) return call || adopted ? [prior, call, adopted, subject].filter(Boolean) : [];

        const { patternValue = '', target = false, fallback = false, init = false, parameter = false, propertyKey = false, excludedKeys = [] } = node;

        if (patternValue) return patternValue === 'root' ? bindingDependencies({ init, parameter: parameter || {} })
            : [target, propertyKey, ...excludedKeys, fallback].filter(Boolean);

        if (type === 'Identifier') {
            const binding = bindingFor(node);
            const selected = patternValues.forBinding(binding);
            const imported = importTargets.get(binding);
            const namespace = namespaceBindings.get(binding);
            const { fields = new Map() } = namespace ? namespace : {};
            const { protocolLifetime = false } = receiverProtocolFor(node);

            return [...(selected ? [selected] : bindingDependencies(binding)), imported && importedSource(imported),
                ...[...fields.values()].filter(Boolean).map(importedSource),
                receiverLifetimeFor(node), protocolLifetime].filter(Boolean);
        }

        if (type === 'ConditionalExpression') return [test, consequent, alternate];

        if (['LogicalExpression', 'BinaryExpression'].includes(type)) return [left, right];

        if (['UnaryExpression', 'AwaitExpression', 'SpreadElement'].includes(type)) return [argument];

        if (type === 'MemberExpression') {
            const { computed = false, property = false } = node;

            return [object, computed && property, members.writeFor(node)].filter(Boolean);
        }

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

        if (type === 'TemplateLiteral') return expressions;

        return [];
    };
    const dependencies = node => [...new Set([...valueDependencies(node), ...uses.forContainer(node), ...members.copyLifetimeFor(node).map(({ lifetime = false } = {}) => lifetime)].filter(Boolean))];
    const read = node => acquired.get(node) || unknown;
    const importedValue = (target, common = {}) => {
        const source = importedSource(target);

        return source ? own({ ...common, kind: 'module-value', target: read(source), provider: executionOf.get(source) }) : unknown;
    };
    const fallbackFor = (node, { type = '' } = {}) => {
        const value = read(node);
        const { kind = '', entries = [] } = value;

        // An empty default on a value binding declares an open object boundary.
        // A named nested pattern still owns its explicit field requirements.
        return type === 'Identifier' && kind === 'record' && !entries.length ? own({ ...value, open: true, openDefault: true }) : value;
    };
    const publishedParameter = (input, common) => {
        const entry = own({ ...common, kind: 'parameter-entry', target: input });

        return own({ ...common, kind: 'use', target: entry, initialized: true, immutable: true, entryBound: true });
    };
    // Raw argument/default production belongs to entry, even if later writes
    // make a body read unavailable. All consumers share the published binding.
    const parameterBinding = (binding, common) => {
        if (bindingExpressions.has(binding)) return bindingExpressions.get(binding);

        const { parameter = {}, execution = false } = binding;
        const { position = -1, fallback = false, origin = {}, rest = false } = parameterOf(parameter);
        const location = locationOf(origin);
        const input = own({ ...common, execution, location, kind: 'parameter', key: bindingKey(binding), capability: capabilities.subjectFor(origin),
            position, rest, fallback: fallback ? read(fallback) : false, owner: unknownOwner({ code: 'parameter-input', location }) });

        return put(bindingExpressions, binding, publishedParameter(input, { ...common, execution, location }));
    };
    const compileBinding = (node, { location = {}, execution: reader = false, ...description } = {}) => {
        const binding = bindingFor(node);
        const { available = false, init = false, parameter = {}, pattern = {}, caught = false, immutable = false } = binding;
        const { execution = reader } = binding;
        const common = { ...description, execution };

        if (!available) {
            const identified = identities.get(node);
            const { execution = false, declaration: { destructured = false } = {} } = identified ?? {};
            const code = [!identified && 'unresolved-binding', opaqueExecutions.has(execution) && 'opaque-execution',
                execution !== executionOf.get(node) && 'captured-value', destructured && 'destructured-binding', 'unstable-binding'].find(Boolean);

            return unknownAt({ ...common, location }, code);
        }

        if (bindingExpressions.has(binding)) return bindingExpressions.get(binding);

        if (caught) {
            const { declaration: { destructured = false } = {} } = binding;

            return put(bindingExpressions, binding, destructured ? unknownAt({ ...common, location }, 'opaque-catch')
                : own({ ...common, location, kind: 'caught', handler: bindingKey(caught), owner: unknownOwner({ ...common, code: 'opaque-catch' }) }));
        }

        const namespace = namespaceBindings.get(binding);
        const existingNamespace = namespace && namespaceExpressions.get(namespace);

        if (existingNamespace) return put(bindingExpressions, binding, existingNamespace);

        if (namespace) {
            const { fields = new Map(), open = false } = namespace;
            const entries = [...fields].map(([name = '', target = false] = []) => {
                const callable = byFunction.get(callableSources.get(target) || target);
                const value = callable ? own({ kind: 'source', inert: true, callable, truth: 1, absence: 'present', promise: 'none',
                    owner: createOwner({ evidence: fromESTree({ type: 'FunctionExpression' }, { projection: 'family' }) }) }) : importedValue(target, common);

                return Object.freeze({ name, known: true, data: true, value });
            });

            const expression = own({ ...common, location, kind: 'record', entries: Object.freeze(entries), trusted: true, open });

            put(namespaceExpressions, namespace, expression);

            return put(bindingExpressions, binding, expression);
        }

        const callable = !init && byFunction.get(callableSources.get(binding));

        if (callable) return put(bindingExpressions, binding, own({ ...common, location, kind: 'source', callable, inert: true, familyOnly: true,
            truth: 1, absence: 'present', promise: 'none', owner: createOwner({ evidence: fromESTree({ type: 'FunctionExpression' }, { projection: 'family' }) }) }));

        if (importTargets.has(binding)) return put(bindingExpressions, binding, importedValue(importTargets.get(binding), { ...common, location }));

        const selected = patternValues.forBinding(binding);

        if (selected) return put(bindingExpressions, binding, patternValues.ordered(pattern)
            ? own({ ...common, location, kind: 'use', target: read(selected), initialized: true, immutable: true, entryBound: true }) : read(selected));

        const { declaration: { destructured = false } = {} } = binding;

        if (destructured) return unknownAt({ ...common, location }, 'destructured-binding');

        const { position = -1, fallback = false, origin = {}, rest = false } = parameterOf(parameter);

        if (position >= 0 && bindingExecutions.has(execution)) return parameterBinding(binding, common);

        const { type: initializerType = '' } = init ? init : {};
        const initial = init ? read(init) : naturalInitializer(node) || unknown;
        const { familyOnly = true } = initial;

        return put(bindingExpressions, binding, own({ ...common, location: position >= 0 ? locationOf(origin) : location,
            ...(position >= 0 ? { owner: unknownOwner({ code: 'parameter-input', location: locationOf(origin) }) } : {}),
            key: bindingKey(binding), capability: capabilities.subjectFor(origin), kind: position >= 0 ? 'parameter' : 'link',
            immutable,
            transfer: ['CallExpression', 'AwaitExpression'].includes(initializerType),
            target: initial, familyOnly, position, rest, fallback: fallback ? read(fallback) : false }));
    };
    const prefixFor = (first, args, { execution = false, location = {} } = {}) => args.reduce(
        (left, argument) => own({ kind: 'sequence', execution, location, left, right: read(argument) }), read(first));
    const compileCall = (node = {}, common) => {
        const { type: callType = '', callee = {}, optional = false, arguments: written = [] } = node;
        const args = argumentLists(node);
        const spreadLayout = written.some(({ type = '' } = {}) => type === 'SpreadElement');
        const argumentValue = (argument = {}) => Reflect.get(argument, 'type') ? read(argument) : absence;
        const { type = '', name: calleeName = '', object = {}, property: { name = '' } = {} } = callee;
        const { method = '', replacement = false, uncertain = false } = members.receiverFor(callee);
        const subject = method && !replacement && !uncertain ? object : callee;
        const invocation = capabilities.subjectFor(subject);
        const { guarded = false } = contextFor(node);
        const described = { ...common, invocation, spreadLayout, guarded: guarded || controlExecutions.has(executionOf.get(node)),
            argumentFresh: Object.freeze(args.map(ownsFreshValue)),
            capabilityTest: capabilities.testFor(node), name: type === 'Identifier' ? calleeName : name,
            argumentMetadata: Object.freeze(args.map(argumentMetadata)), argumentOwned: Object.freeze(args.map(argument => ownsFreshValue(argument) || members.safe(argument, node))) };
        const suspended = { ...described, argumentStable: Object.freeze(args.map(argument => members.suspensionSafe(argument))),
            argumentTransfer: Object.freeze(args.map(argument => members.captureTransfer(argument, node))) };
        const direct = byFunction.get(callee);
        const resolved = direct || byFunction.get(callableSources.get(callableResolutions.get(callee)));

        [resolved, ...args.map(argument => byFunction.get(argument) || byFunction.get(callableSources.get(callableResolutions.get(argument))))].filter(Boolean).forEach((model) => {
            retain(invocationSources.get(model) || put(invocationSources, model, new Set()), executionOf.get(node));
        });
        const { execution: calleeExecution = false } = resolved ?? {};
        const { parentExecution: lexicalParent = false } = resolved ?? {};
        const { execution = false } = common;

        if (lexicalParent && execution !== lexicalParent) {
            const callers = lexicalCallers.get(calleeExecution) || put(lexicalCallers, calleeExecution, new Set());

            retain(callers, execution);
        }

        // Async identity proves the result without executing a dependency body.
        // A literal callee also survives dynamic lexical lookup in its caller.
        const available = direct || !dynamicExecutions.has(executionOf.get(node));
        const model = available && resolved;
        const imported = moduleOfExecution.get(calleeExecution) !== moduleOfExecution.get(executionOf.get(node));

        if (optional) return unknownAt(described, 'optional-call');

        if (args.some(({ type = '' } = {}) => type === 'SpreadElement')) {
            return unknownAt({ ...described, prefix: prefixFor(callee, written, common) }, 'spread-call');
        }

        if (!available) return unknownAt(described, 'opaque-execution');

        if (callType === 'NewExpression') {
            const promiseConstructor = intrinsicAt(callee) === 'Promise';

            return promiseConstructor ? own({ ...described, kind: 'call', function: nativePromiseConstructor, arguments: Object.freeze(args.map(argumentValue)) })
                : own({ ...described, kind: 'member-call', construct: true, callee: read(callee), arguments: Object.freeze(args.map(argumentValue)),
                    owner: unknownOwner({ ...common, code: 'unresolved-call' }) });
        }

        // A closure passed directly to an opaque call can only be created on
        // paths reaching that call. This over-approximates creation, without
        // evaluating opaque arguments or borrowing a consumer's runtime value.
        if (!model) return own({ ...suspended, kind: 'member-call', callee: read(callee), arguments: Object.freeze(args.map(argumentValue)),
            closures: Object.freeze(args.map(argument => byFunction.get(argument)).filter(Boolean)), owner: unknownOwner({ ...common, code: 'unresolved-call' }) });

        return own({ ...suspended, kind: 'call', owner: unknownOwner({ ...common, code: imported ? 'imported-result' : 'recursive-call' }),
            ...(imported ? { lookup: read(callee) } : {}),
            function: model, arguments: Object.freeze(args.map(argumentValue)) });
    };
    const readBinding = (node, common) => {
        const { capabilities: observed = [], ...source } = common;
        const acquired = compileBinding(node, source);
        const imported = bindingFor(node);
        const importProvider = importProviders.get(imported);
        const { execution: importer = false } = imported;
        // The imported binding's route owns initialization separately from
        // the resolved value or callable's defining module.
        const owned = importProvider ? importExpressions.get(imported) || put(importExpressions, imported,
            own({ ...source, execution: importer, kind: 'module-value', access: true, provider: importProvider, target: acquired })) : acquired;
        const { execution: provider = false, kind = '', target = false, entryBound = false } = owned;
        const { parameterSource: { index: position = -1 } = {} } = bindingFor(node);
        const { execution = false } = source;
        // The closed callable proof permits transport of the completed value
        // from its creating invocation, without replaying the selection.
        const captured = provider !== execution && (entryBound || members.captureValue(node) || members.captureCallable(node)) &&
            (executionParents.has(provider) || kind === 'link');
        const capture = () => {
            traverse(execution, { enter: (current) => {
                if (current === provider || !current) return [];

                retain(lexicalExecutions, current);

                return [executionParents.get(current)];
            } });

            if (kind === 'link' && target) retain(captureInputs, target);

            const { init = {} } = identities.get(node) ?? {};
            const staticRecord = Boolean(init) && !executionParents.has(provider) && members.captureSafe(node) && ownsRecordFields(init);

            return own({ ...source, kind: 'capture', provider, position, staticRecord, target: owned, owner: unknownOwner({ ...source, code: 'captured-value' }) });
        };
        const captures = captured && (captureExpressions.get(owned) || put(captureExpressions, owned, new Map()));
        const binding = captured ? captures.get(execution) || put(captures, execution, capture()) : owned;
        const { guarded = false } = common;
        const safe = namespaceBindings.has(bindingFor(node)) || members.safe(node);
        // Callable identity survives retirement, but native protocol lookup
        // still needs the caller's ordinary receiver-lifetime relationship.
        const lifetime = receiverLifetimeFor(node);
        const { protocolSafe = false, protocolLifetime = false } = receiverProtocolFor(node);
        const protocol = { protocolSafe, protocolLifetime: protocolLifetime && read(protocolLifetime) };

        if (!safe && lifetime) return own({ ...common, ...protocol, kind: 'unowned', target: binding, lifetime: read(lifetime) });

        if (guarded || observed.length) return own({ ...common, ...protocol, kind: safe ? 'use' : 'unowned', target: binding });

        if (safe) return binding;

        if (protocolLifetime) return own({ ...common, ...protocol, kind: 'unowned', target: binding });

        const entries = unownedExpressions.get(binding) || put(unownedExpressions, binding, new Map());

        return entries.get(protocolSafe) || put(entries, protocolSafe, own({ ...common, ...protocol, kind: 'unowned', target: binding }));
    };
    const compileSelection = ({ patternValue = '', node = {}, target = false, fallback = false, init = false, parameter = false,
        name = '', position: slot = -1, formal = false, excluded = [], propertyKey = false, excludedKeys = [] } = {}) => {
        const execution = executionOf.get(node);
        const common = { execution, module: moduleOfExecution.get(execution), location: locationOf(node), capability: capabilities.subjectFor(node), truth: -1,
            guarded: controlExecutions.has(execution) };

        if (patternValue === 'default') return own({ ...read(target), ...common, fallback: fallbackFor(fallback, node) });

        if (patternValue === 'rest') return own({ ...common, kind: 'record-rest', target: read(target), excluded,
            excludedKeys: Object.freeze(excludedKeys.map(key => key ? read(key) : false)),
            standardPrototype: true });

        if (patternValue === 'field') return own(formal && slot >= 0 ? formalSlot({ ...common, target: read(target), slot })
            : { ...common, kind: 'selection', target: read(target), name, propertyKey: propertyKey ? read(propertyKey) : false, slot, formal, fallback: false });

        const { type: initializerType = '' } = init ? init : {};
        const { type: declarationType = '' } = parents.get(node) ?? {};
        const { kind: declarationKind = '' } = parents.get(parents.get(node)) ?? {};

        if (!parameter) return own({ ...common, kind: 'use', target: read(init), initialized: declarationType === 'VariableDeclarator' && Boolean(init), immutable: declarationKind === 'const',
            transfer: ['CallExpression', 'AwaitExpression'].includes(initializerType) });

        const { position = -1, fallback: initial = false, origin = {}, rest = false } = parameterOf(parameter);

        const input = own({ ...common, kind: 'parameter', key: bindingKey(origin), position, rest,
            fallback: initial ? read(initial) : false, owner: unknownOwner({ ...common, code: 'parameter-input' }) });

        return patternValues.ordered(node) ? publishedParameter(input, common) : input;
    };
    const compile = (node = {}) => {
        const { lifetime = false, call = false, prior = false, ordered = false, discardResult = false, adopted = false, subject = false, patternValue = '' } = node;

        if (lifetime) return own({ kind: 'lifetime', call: call ? read(call) : false, prior: prior ? read(prior) : false,
            adopted: adopted && read(adopted), subject: subject && read(subject), ordered, discardResult });

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

                return Object.freeze({ name, known: known && type === 'Property' && !prototypeDefinition(entry), spread: type === 'SpreadElement',
                    data: kind === 'init', value: read(type === 'SpreadElement' ? argument : value), key: computed ? read(key) : false });
            });

            return own({ ...common, observations, kind: 'record', entries: Object.freeze(entries),
                standardPrototype: !properties.some(prototypeDefinition),
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
            const { known = false, name = '' } = propertyName({ computed, key: property });
            const promiseFactory = !computed && intrinsicAt(object) === 'Promise' && promiseFactories.has(name);

            return own({ ...common, kind: 'member', target: read(object), name, computed, propertyKey: computed && !known ? read(property) : false, promiseFactory,
                promiseMethod: promiseFactory ? name : '',
                nativeNamespace: !computed && !optional && nativeNamespaces.get(intrinsicAt(node)),
                nativeFactory: !computed && !optional && factoryFor(object, name),
                supported: (known || computed) && !optional,
                owner: unknownOwner({ ...common, code: 'unsupported-expression' }) });
        }

        if (type === 'ArrayExpression' && !elements.length) return own({ ...common, kind: 'source', familyOnly: true, inert: true, slots: Object.freeze([]),
            nativeTag: 'Array',
            truth: 1, absence: 'present', promise: 'none', standardPrototype: true,
            owner: createOwner({ evidence: fromESTree({ type }, { projection: 'family' }) }) });

        if (type === 'ArrayExpression') {
            const inputs = elements.map((element) => {
                const { type = '', argument = false } = element ?? {};

                return type === 'SpreadElement' ? argument : element;
            });

            return own({ ...common, kind: 'array', arguments: Object.freeze(inputs.map(element => element ? read(element) : absence)),
                argumentStable: Object.freeze(inputs.map(element => !!element && (ownsFreshValue(element) || members.suspensionSafe(element)))),
                argumentOwned: Object.freeze(inputs.map(element => !element || ownsFreshValue(element) || members.safe(element, node))),
                holes: Object.freeze(elements.map(element => !element)), spreads: Object.freeze(elements.map((element) => {
                    const { type = '' } = element ?? {};

                    return type === 'SpreadElement';
                })),
                standardPrototype: true });
        }

        if (type === 'SpreadElement') return own({ ...common, kind: 'spread', argument: read(argument) });

        const normalized = primitiveLiteral(node, operators.get(node));
        const { type: normalizedType = '' } = normalized;
        const primitiveSource = normalizedType === 'Literal' && normalized;

        if (primitiveSource || ['ArrowFunctionExpression', 'FunctionExpression'].includes(type)) {
            const value = primitiveSource ? Reflect.get(primitiveSource, 'value') : false;
            const literal = primitiveSource ? { type: 'Literal', value, ...(regex ? { regex } : {}) } : { type };
            const truth = primitiveSource ? Number(Boolean(value)) : 1;
            const primitive = value === null || ['string', 'number', 'boolean', 'bigint'].includes(typeof value);

            return own({ ...common, observations, kind: 'source', promise: 'none', familyOnly: true, truth, constant: primitiveSource && !regex && primitive ? Object.freeze({ value }) : false,
                standardPrototype: true,
                closure: byFunction.get(node), callable: byFunction.get(node),
                absence: type === 'Literal' && value === null ? 'null' : 'present', inert: true,
                owner: createOwner({ evidence: fromESTree(literal, { projection: 'family' }) }) });
        }

        if (!opaqueExecutions.has(execution) && intrinsicAbsence(node, identities)) return own({ ...absence, ...common, truth: 0 });

        if (type === 'Identifier') {
            const intrinsic = intrinsicAt(node);
            const factory = factoryFor(node);

            return intrinsic ? own({ ...common, kind: 'source', callable: factory, nativeFunctionNamespace: nativeFunctionNamespaces.has(intrinsic),
                truth: 1, absence: 'present', inert: true, promise: 'none',
                owner: createOwner({ evidence: fromESTree({ type: nativeNamespaces.get(intrinsic) === 'object' ? 'ObjectExpression' : 'FunctionExpression' },
                    { projection: 'family' }) }) }) : readBinding(node, common);
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

        if (type === 'BinaryExpression' && ['+', '-', '*', '/', '%', '**', '|', '&', '^', '<<', '>>', '>>>'].includes(operator)) {
            return own({ ...common, kind: 'arithmetic', operator, left: read(left), right: read(right) });
        }

        if (type === 'TemplateLiteral') {
            const { expressions = [] } = node;

            return own({ ...common, kind: 'template', arguments: Object.freeze(expressions.map(read)) });
        }

        if (['CallExpression', 'NewExpression'].includes(type)) return compileCall(node, { ...common, observations });

        if (type === 'TaggedTemplateExpression') return unknownAt({ ...common, observations, prefix: prefixFor(tag, substitutions, common) });

        if (type === 'AwaitExpression') return own({ ...common, kind: 'await', argument: read(argument), owner: unknownOwner({ ...common, code: 'unresolved-settlement' }) });

        return unknownAt({ ...common, observations });
    };
    const expressionFor = (node) => {
        if (!node) return absence;

        const pending = new WeakSet();

        traverse(node, { enter: (value) => {
            if (acquired.has(value)) return [];

            if (pending.has(value)) {
                put(acquired, value, unknownAt({ location: locationOf(value) }, 'cyclic-value'));

                return [];
            }

            retain(pending, value);

            return dependencies(value);
        }, leave: (value) => {
            if (acquired.has(value)) return;

            const compiled = compile(value);
            const copied = members.copyLifetimeFor(value);

            put(acquired, value, copied.length ? own({ ...compiled, kind: 'copied-source', target: compiled,
                lifetimes: Object.freeze(copied.map(({ lifetime = false, deep = false } = {}) => ({ proof: read(lifetime), deep }))) }) : compiled);
        } });

        return read(node);
    };

    functionEntries.forEach(({ body = {}, params = [] } = {}, position) => {
        const model = functions.at(position);
        const { execution = false, supported = false, capabilitySupported = false } = model;
        const flow = supported || capabilitySupported ? acquireFlow({ body, expressionFor, patterns: patternValues, nodes: statementFlows, prefixes: statementPrefixes,
            own: description => ownStatement(execution, description), handlerFor: bindingKey, naturalInitializer, absence }) : ownStatement(execution, { kind: 'unsupported' });

        const orderedEntry = bindingExecutions.has(execution);
        const needsEntry = orderedEntry || params.some(({ type = '', left: { type: binding = '' } = {}, right = false } = {}) => (
            type === 'AssignmentPattern' && binding === 'Identifier' && !initializerFacts.get(right)
        ));
        const entry = needsEntry ? params.reduce((prior, parameter) => {
            if (patternValues.ordered(parameter)) {
                const { target = unknown } = expressionFor(patternValues.rootFor(parameter));
                const steps = [ownStatement(execution, { kind: 'effect', argument: target, binding: true,
                    objectPattern: true, formalPattern: true, initializes: true }),
                ...patternValues.entriesFor(parameter).map(selected => ownStatement(execution, {
                    kind: 'effect', argument: expressionFor(selected), initializes: true
                }))];

                return steps.reduce((left, right) => own({ kind: 'sequence', execution, left, right }), prior);
            }

            const { type = '', left = parameter, argument = parameter } = parameter;
            const selected = type === 'RestElement' ? argument : left;
            const { type: binding = '' } = selected;

            if (binding !== 'Identifier') return prior;

            if (!orderedEntry) {
                const target = expressionFor(selected);
                const entry = own({ kind: 'parameter-entry', execution, target });

                return own({ kind: 'sequence', execution, left: prior, right: entry });
            }

            const formal = identities.get(selected);
            const { parameter: { fallback = false } = {} } = formal ?? {};

            if (fallback) expressionFor(fallback);

            const { target = unknown } = parameterBinding(formal, { execution, module: moduleOfExecution.get(execution), truth: -1 });
            const entry = ownStatement(execution, { kind: 'effect', argument: target, initializes: true });

            return own({ kind: 'sequence', execution, left: prior, right: entry });
        }, absence) : false;

        Object.defineProperty(model, 'localReader', { value: members.localReader(execution), enumerable: true });
        Object.defineProperty(model, 'entry', { value: entry, enumerable: true });
        completeCallable(model, flow);
    });

    const moduleRoots = moduleEntries.map(({ filename = '', execution = false, program = {} } = {}, position) => ({
        functionModel: true, index: functions.length + position, execution, module: filename,
        supported: !opaqueExecutions.has(execution), bodyLocation: locationOf(program),
        flow: acquireFlow({ body: program, expressionFor, patterns: patternValues, nodes: statementFlows, prefixes: statementPrefixes,
            own: description => ownStatement(execution, description), handlerFor: bindingKey, naturalInitializer, absence })
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
    // A sibling call needs the same parent frame as the callee when that
    // callee captures data. Propagate the frame requirement once per edge.
    const propagated = new Set();

    [...lexicalExecutions].forEach(execution => traverse(execution, { enter: (current) => {
        if (propagated.has(current)) return [];

        retain(propagated, current);
        retain(lexicalExecutions, current);

        return [...(lexicalCallers.get(current) ?? [])].filter(caller => executionParents.get(caller) === executionParents.get(current));
    } }));
    const [root = {}] = moduleRoots;
    const prefixes = new WeakMap();
    const capabilityPrefixFor = (node) => {
        const parentFor = (current) => {
            const parent = parents.get(current);

            return parent && executionOf.get(parent) === executionOf.get(current) ? parent : false;
        };

        traverse(node, { enter: current => prefixes.has(current) ? [] : [parentFor(current)].filter(Boolean), leave: (current) => {
            if (!prefixes.has(current)) put(prefixes, current, prefixes.get(parentFor(current)) || statementPrefixes.get(current) || false);
        } });

        return prefixes.get(node);
    };
    const registerCapabilityRegion = (node) => {
        const expression = expressionFor(node);
        const { repeated = false, region = false } = contextFor(node);
        const flow = region && statementFlows.get(region);
        const prefix = capabilityPrefixFor(node);

        if (repeated && flow) put(capabilityRegions, expression, flow);

        if (prefix) put(capabilityPrefixes, expression, prefix);
    };

    sourceCalls.forEach(({ node = {} } = {}) => registerCapabilityRegion(node));
    uses.observedNodes.forEach(registerCapabilityRegion);
    functionEntries.forEach(({ node = {} } = {}, index) => {
        const prefix = capabilityPrefixFor(node);

        if (prefix) put(capabilityPrefixes, functions.at(index), prefix);
    });

    return { expressionFor, patternFor: (node, pattern) => {
        const selection = patternValues.forNode(node, pattern);

        return selection ? expressionFor(selection) : unknown;
    }, functions: Object.freeze(functions), root, moduleRoots: Object.freeze(moduleRoots), decisions, absence, unknown, capabilities, uses, contextFor, invocationSources,
    lexicalExecutions, captureInputs,
    capabilityRegions, capabilityPrefixes,
    counts: () => ({ functions: functions.length, ...storage.counts(), capabilitySubjects,
        decisions: decisions.count(), decisionWork: decisions.work() }) };
};
