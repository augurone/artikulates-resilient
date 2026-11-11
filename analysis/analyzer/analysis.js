import { parse } from 'espree';

import { all, createOwner, field, fromESTree, readFamily, request } from 'eslint-plugin-resilient/agreement';

import { put } from '../collections.js';
import { bindingSources, synchronousFunction } from './callables.js';
import { prepareCalls, checkCall, callOutcome } from './calls.js';
import { prepareDeclarations } from './declarations.js';
import { createDemand } from './demand.js';
import { locationOf } from './locations.js';
import { acquireModel } from './model.js';
import { indexModules } from './modules.js';
import { operationRequirements as operations } from './native-members.js';
import { preparePromiseOwnership } from './promise-ownership.js';
import { requiredPatternFields, requiredRecordFields } from './records.js';
import { returnDiagnostics } from './returns.js';
import { prepareSignaturePlacement } from './signature-placement.js';

const presenceOnly = all();
const noCauses = Object.freeze([]);
const consistency = ({ families = [], incomplete = false } = {}, returns = []) => {
    const absences = new Set(returns.flatMap(({ absences: kinds = [] } = {}) => kinds));

    if (families.length > 1 || absences.size > 1) return 'contradiction';

    return incomplete ? 'unknown' : 'agreement';
};

// eslint-disable-next-line resilient/prefer-safe-destructuring-defaults -- The resolver is guarded; omitted limits stay absent until validation. Explicit Infinity is not omission.
const prepare = ({ program = {}, filename = '', roots = [], resolveModule, limits: { decisions: requestedDecisions, demand: requestedDemand } = {} } = {}) => {
    [requestedDecisions, requestedDemand].forEach((limit) => {
        // eslint-disable-next-line resilient/no-undefined-comparison -- Only omitted limits select unrestricted analysis; zero, false and null remain invalid requests.
        if (typeof limit === 'undefined') return;

        if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError('Expected a positive safe integer analysis limit');
    });
    const decisionLimit = requestedDecisions ?? Infinity;
    const demandLimit = requestedDemand ?? Infinity;
    const index = indexModules({ program, operations, filename, roots, resolveModule });
    const { candidates = [], destructurings = [], calls = [], invocations = [], declarations = [], identities = new WeakMap(),
        counts = {}, ownFunctionCount = 0 } = index;
    const { callables: callableSources = new Map(), namespaces = new Map() } = bindingSources(index);
    const callables = new Map([...callableSources].filter(([, node = {}] = []) => synchronousFunction(node)));
    const model = acquireModel({ index, callables, callableSources, namespaces, decisionLimit });
    const { expressionFor, functions = [], root = {}, moduleRoots = [], decisions = {}, absence = {}, unknown = {}, invocationSources = new Map(),
        intrinsicExposures = new Map(), externalExecutions = new Set(), capabilityRegions = new Map() } = model;

    if (typeof expressionFor !== 'function') throw new TypeError('Expected model expression acquisition');

    const demand = createDemand({ functions, root, moduleRoots, decisions, absence, unknown, invocationSources, intrinsicExposures, externalExecutions, capabilityRegions, limit: demandLimit });
    const expressions = new WeakMap();
    const records = new WeakSet(destructurings.filter(({ node = {}, pattern = {} } = {}) => requiredRecordFields({ node, pattern }).length).map(({ node = {} } = {}) => node));
    const ownerFor = (node) => {
        if (records.has(node)) return expressions.get(node) || put(expressions, node, createOwner({ evidence: fromESTree(node, { projection: 'presence' }) }));

        return demand.ownerFor(expressionFor(node));
    };
    const prepared = candidates.map(({ node = {}, operation = '', conditional = false } = {}, index) => ({
        owner: ownerFor(node), required: operations.get(operation), consumer: `Receiver family assuming native ${operation}`,
        descriptor: Object.freeze({ index, operation, conditional, location: locationOf(node) })
    }));
    const patterns = destructurings.map(({ node = {}, expected = '' } = {}, index) => ({
        owner: ownerFor(node), expression: records.has(node) ? false : expressionFor(node), required: expected, consumer: `Destructuring as ${expected}`,
        descriptor: Object.freeze({ index, expected, location: locationOf(node) })
    }));
    const fields = destructurings.flatMap(({ node = {}, pattern = {}, entries = [] } = {}) => entries.flatMap(({ node: selected = {} } = {}) => {
        const { type = '', properties = [] } = selected;

        if (type !== 'ObjectPattern' || properties.some(({ computed = false } = {}) => computed)) return [];

        const owner = selected === pattern && records.has(node) ? ownerFor(node) : demand.ownerFor(model.patternFor(selected, pattern));

        return requiredPatternFields(selected).map(entry => ({ ...entry, owner,
            expression: selected === pattern && records.has(node) ? false : model.patternFor(selected, pattern), site: expressionFor(node) }));
    }));
    const declarationIndexes = new Map(declarations.map(({ node = {} } = {}, index) => [node, index]));
    const properties = fields.map(({ owner = false, expression = false, site = false, name = '', key = {}, value = {} } = {}, index) => ({
        owner, expression, site, required: field({ name, required: presenceOnly }), consumer: `Destructuring requires own field ${name}`,
        optional: field({ name, required: presenceOnly, optional: true }),
        declaration: declarationIndexes.get(value) ?? -1,
        descriptor: Object.freeze({ index, name, location: locationOf(key) })
    }));

    const callAnalysis = prepareCalls({ calls, functions, expressionFor });
    const { counts: callCounts = {} } = callAnalysis;
    const callResults = calls.map(({ node = {} } = {}) => ownerFor(node));
    const uses = invocations.map(({ node = {}, subject = {} } = {}, index) => {
        const { callee: { type = '', name = '' } = {} } = node;
        const expression = expressionFor(node);
        const { invocation: { optionalCallback = false } = {} } = expression;
        const { optionalCallback: declaredOptional = false } = identities.get(subject) ?? {};

        return { expression, descriptor: Object.freeze({ index, name, location: locationOf(node),
            optionalCallback: optionalCallback || declaredOptional, direct: type === 'Identifier' }) };
    });
    const absenceDeclarations = Object.freeze(declarations.map(({ node = {}, defaulted = false, rest = false, parameterPattern = false } = {}, index) => {
        const { type = '', name = '' } = node;

        return Object.freeze({ index, kind: type, name, location: locationOf(node), parameter: parameterPattern,
            absence: [rest && 'rest', defaulted && 'default', 'undeclared'].find(Boolean) });
    }));
    const declarationChecks = prepareDeclarations({ index, model, demand });
    const signaturePlacement = prepareSignaturePlacement({ index, model, declarations: declarationChecks });
    const { counts: boundaryCounts = {} } = signaturePlacement;
    const { memberAccesses = [] } = index;
    const members = memberAccesses.map(({ node = {}, parent = {}, conditional = false } = {}, index) => {
        const { computed = false, optional = false, property: { name = '' } = {} } = node;
        const { type = '', operator = '', callee = false, left = false, argument = false } = parent;
        const writing = (type === 'AssignmentExpression' && left === node) || (type === 'UpdateExpression' && argument === node) ||
            (type === 'UnaryExpression' && operator === 'delete' && argument === node);

        return { expression: expressionFor(node), descriptor: Object.freeze({ index, name, call: type === 'CallExpression' && callee === node,
            supported: !computed && !optional && !conditional && !writing, location: locationOf(node) }) };
    });
    const promises = preparePromiseOwnership(index, expressionFor);

    return { prepared, patterns, properties, callAnalysis, callResults, functions: functions.slice(0, ownFunctionCount), demand, uses, absenceDeclarations,
        declarationChecks, signaturePlacement, members, promises, files: index.moduleEntries.map(({ filename = '' } = {}) => filename),
        counts: { ...counts, ...callCounts, ...model.counts(), ...boundaryCounts } };
};

// This closure captures only prepared owners and descriptors, never the AST,
// lexical indexes, or input source. Setup scratch data can be reclaimed.
export const createSession = ({ prepared = [], patterns = [], properties = [], callAnalysis: { prepared: callEntries = [], signatures = [] } = {},
    callResults = [], functions: functionModels = [], demand = {}, uses = [], absenceDeclarations = [], declarationChecks = {}, signaturePlacement = {}, members = [],
    promises: promiseUses = [], files = [], counts = {} } = {}) => {
    const receivers = Object.freeze(prepared.map(({ descriptor = {} } = {}) => descriptor));
    const destructurings = Object.freeze(patterns.map(({ descriptor = {} } = {}) => descriptor));
    const destructuringFields = Object.freeze(properties.map(({ descriptor = {} } = {}) => descriptor));
    const calls = Object.freeze(callEntries.map(({ descriptor = {} } = {}) => descriptor));
    const functions = Object.freeze(functionModels.map(({ index = -1, location = {}, supported = false, promiseResult = false } = {}) => Object.freeze({
        index, location, supported, completion: promiseResult ? 'fulfillment' : 'return'
    })));
    const { descriptors: signatureExtractions = [] } = signaturePlacement;
    const summaries = new WeakMap();
    const summarize = (fact) => {
        if (summaries.has(fact)) return summaries.get(fact);

        const { facet = '', state = '', reason = '', families = [], incomplete = false, presence = [], causes = noCauses, causesTruncated = false } = fact;

        if (facet.startsWith('field:')) return put(summaries, fact, Object.freeze({ facet, state, reason, presence, causes, causesTruncated }));

        // Agreement facts contain registered owner handles. A family-only
        // session must not expose those handles or their replaceable premises.
        return put(summaries, fact, Object.freeze({ facet, state, reason, families, incomplete, causes, causesTruncated }));
    };
    const judgmentFor = (entries, { index = -1, ...observation } = {}) => {
        if (!Number.isInteger(index) || index < 0 || index >= entries.length) throw new RangeError('Expected a query index in this analysis');

        const { owner: source = false, expression = false, site = expression, required = '', optional = false, declaration = -1, consumer: label = '' } = entries.at(index);
        const owner = expression ? demand.useValue(expression, site, observation) : source;
        const { required: present = true } = optional && declaration >= 0 ? declarationChecks.checkCallable({ index: declaration, ...observation }) : {};

        demand.ensure(owner, observation);

        return request({ ...observation, owner, required: present ? required : optional, consumer: label });
    };
    const evaluate = (entries, options) => {
        const { status = '', consumer = '', fact = false } = judgmentFor(entries, options);

        return Object.freeze({ status, consumer, fact: summarize(fact) });
    };
    const evaluateField = (options) => {
        const { status = '', consumer = '', facts: [family = false, fact = false] = [] } = judgmentFor(properties, options);

        return Object.freeze({ status, consumer, family: summarize(family), fact: fact ? summarize(fact) : false });
    };
    const evaluateCall = ({ index = -1, ...observation } = {}) => {
        if (!Number.isInteger(index) || index < 0 || index >= callEntries.length) throw new RangeError('Expected a call index in this analysis');

        const call = callEntries.at(index);
        const { expression = {} } = call;
        const { index: site = -1, module: filename = '' } = expression;
        const acquired = demand.callsFor(expression, observation);
        const selected = acquired.length ? acquired : [{ ...call, eligible: false }];
        const { descriptor: { location: use = {} } = {} } = call;
        const results = selected.map((entry) => {
            const { descriptor: { site: origin = -1, filename: source = '' } = {} } = entry;
            const { obligations = [], ...result } = checkCall({ call: entry, summarize, observation,
                readValue: owner => demand.ensure(owner, observation),
                defaultOwner: (owner, fallback) => {
                    const { owner: selected = false } = demand.defaulted(owner, fallback, observation);

                    return selected;
                } });

            return { ...result, obligations: origin === site ? obligations : obligations.map(({ location = {}, ...obligation } = {}) => Object.freeze({
                ...obligation, origin: source === filename ? location : Object.freeze({ ...location, filename: source }), location: use
            })) };
        });
        const statuses = results.map(({ status = '' } = {}) => status);

        return Object.freeze({ status: callOutcome(statuses),
            obligations: Object.freeze(results.flatMap(({ obligations = [] } = {}) => obligations)) });
    };
    const evaluateFunction = ({ index = -1, ...observation } = {}) => {
        if (!Number.isInteger(index) || index < 0 || index >= functionModels.length) throw new RangeError('Expected a function index in this analysis');

        const { owner = false, identity = false, normal = 'unknown', thrown = 'unknown', returns = [] } = demand.functionValue(functionModels.at(index), observation);
        const { position = -1, location = {}, execution = false } = identity;
        const { execution: ownExecution = false, promiseResult = false } = functionModels.at(index);
        const returnedParameter = identity && position >= 0 && execution === ownExecution ? Object.freeze({ index: position, location }) : false;
        const fact = readFamily({ ...observation, owner });
        const completed = returns.map(({ value: { owner: source = false, absences = [] } = {}, ...site } = {}) => {
            const result = readFamily({ ...observation, owner: source });

            return { ...site, absences, fact: summarize(result) };
        });
        const diagnostics = returnDiagnostics({ returns: completed });
        const status = consistency(fact, completed);

        return Object.freeze({ status: normal === false ? 'agreement' : status, completion: promiseResult ? 'fulfillment' : 'return', normal, thrown, returnedParameter, fact: summarize(fact),
            diagnostics,
            returns: Object.freeze(completed.map(({ location = {}, fact: result = {} } = {}) => Object.freeze({ location, fact: result }))) });
    };
    const evaluateResult = ({ index = -1, required = '', ...observation } = {}) => {
        if (!Number.isInteger(index) || index < 0 || index >= callResults.length) throw new RangeError('Expected a call index in this analysis');

        const owner = callResults.at(index);

        demand.ensure(owner, observation);
        const { status = '', fact = {} } = request({ ...observation, owner, required });

        return Object.freeze({ status, fact: summarize(fact), ...demand.completionFor(owner, observation) });
    };
    const evaluateInvocation = ({ index = -1, ...observation } = {}) => {
        if (!Number.isInteger(index) || index < 0 || index >= uses.length) throw new RangeError('Expected an invocation index in this analysis');

        const { expression = {} } = uses.at(index);

        return demand.checkInvocation(expression, observation);
    };
    const evaluateMember = ({ index = -1, ...observation } = {}) => {
        if (!Number.isInteger(index) || index < 0 || index >= members.length) throw new RangeError('Expected a member index in this analysis');

        const { expression = {}, descriptor: { supported = false } = {} } = members.at(index);

        if (!supported) return Object.freeze({ missing: false, conflicts: Object.freeze([]), incomplete: true, expected: '', native: false });

        const { evidence = [], ...result } = demand.checkMember(expression, observation);

        const facts = new Map(evidence.map((fact) => {
            const described = summarize(fact);

            return [JSON.stringify(described), described];
        }));

        return Object.freeze({ ...result, evidence: Object.freeze([...facts].toSorted(([a = ''] = [], [b = ''] = []) => a.localeCompare(b)).map(([, fact = {}] = []) => fact)) });
    };
    const evaluatePromiseUse = ({ index = -1, ...observation } = {}) => {
        if (!Number.isInteger(index) || index < 0 || index >= promiseUses.length) throw new RangeError('Expected a promise-use index in this analysis');

        const { expression = false, descriptor: { ownership = '', chain = false, eligible = false } = {} } = promiseUses.at(index);

        if (ownership !== 'dropped') return Object.freeze({ unhandled: false, reason: 'explicit-ownership', ownership });

        if (chain) return Object.freeze({ unhandled: true, reason: 'unowned-chain', ownership });

        if (!eligible) return Object.freeze({ unhandled: false, reason: 'outside-call-boundary', ownership });

        const result = demand.checkPromise(expression, observation);
        const { known = false, incomplete = false, normal = false } = result;
        const reason = [known && 'dropped-promise', incomplete && 'unknown-result', !normal && 'no-normal-result', 'non-promise-result'].find(Boolean);

        return Object.freeze({ ...result, unhandled: known, reason, ownership });
    };

    return Object.freeze({
        files: Object.freeze([...files]),
        receivers, check: options => evaluate(prepared, options),
        destructurings, checkDestructuring: options => evaluate(patterns, options),
        destructuringFields, checkDestructuringField: evaluateField,
        calls, checkCall: evaluateCall, callSignatures: signatures, functions, checkFunction: evaluateFunction,
        checkCallResult: evaluateResult, declarations: absenceDeclarations, checkDeclaration: options => declarationChecks.check(options),
        signatureExtractions, checkSignatureExtraction: options => signaturePlacement.check(options),
        memberAccesses: Object.freeze(members.map(({ descriptor = {} } = {}) => descriptor)), checkMemberAccess: evaluateMember,
        promiseUses: Object.freeze(promiseUses.map(({ descriptor = {} } = {}) => descriptor)), checkPromiseUse: evaluatePromiseUse,
        invocations: Object.freeze(uses.map(({ descriptor = {} } = {}) => descriptor)), checkInvocation: evaluateInvocation,
        get counts() { return Object.freeze({ ...counts, ...demand.counts() }); }
    });
};

// Like fromESTree, this boundary trusts valid parser nodes. It copies only the
// evidence it consumes before returning; callers retain ownership of their AST.
// eslint-disable-next-line resilient/prefer-safe-destructuring-defaults -- The optional source resolver belongs to the host; preserving absence avoids fabricating module evidence.
export const createProgramAnalysis = ({ program = {}, limits = {}, filename = '', roots = [], resolveModule } = {}) => {
    if (!program || typeof program !== 'object') throw new TypeError('Expected an ESTree Program');

    const { type = '', body = false } = program;

    if (type !== 'Program' || !Array.isArray(body)) throw new TypeError('Expected an ESTree Program');

    return createSession(prepare({ program, limits, filename, roots, resolveModule }));
};

// Parsing is an external boundary: syntax errors propagate. A new source needs
// a new session; old results never silently claim to describe an edited file.
// eslint-disable-next-line resilient/prefer-safe-destructuring-defaults -- The optional source resolver is forwarded unchanged to the program boundary; absence means local source only.
export const createAnalysis = ({ source = '', sourceType = 'module', limits = {}, filename = '', roots = [], resolveModule } = {}) => {
    if (typeof source !== 'string') throw new TypeError('Expected JavaScript source text');

    if (!['module', 'script'].includes(sourceType)) throw new TypeError('Expected module or script source');

    const program = parse(source, { ecmaVersion: 'latest', sourceType, range: true, loc: true, ecmaFeatures: { jsx: true } });

    return createProgramAnalysis({ program, limits, filename, roots, resolveModule });
};
