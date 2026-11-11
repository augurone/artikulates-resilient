import { readFamily, readField } from 'eslint-plugin-resilient/agreement';

import { append, put, retain } from '../collections.js';
import { propertyName } from '../estree-properties.js';
import { traverse } from '../traversal.js';
import { absenceBoundaries } from './absence-boundaries.js';
import { locationOf } from './locations.js';
import { notify } from './work.js';

const admitted = (code, reason, evidence = []) => Object.freeze({ required: false, code, reason, evidence: Object.freeze(evidence) });
const required = Object.freeze({ required: true, code: 'missing-absence-contract',
    reason: 'No authored default or established absence boundary', evidence: Object.freeze([]) });
const guardedForwarding = Object.freeze({ status: 'agreement', reason: 'The forwarding site establishes callability' });
const safeData = Object.freeze({ status: 'agreement', reason: 'The data use handles natural absence' });
const callableUse = kind => ['invocation', 'collection', 'argument'].includes(kind);
const forwardingRequirements = (uses) => {
    const callers = new Map();
    const direct = new Set();
    const escapes = new Set();
    const results = new Set();
    const callable = new Set();
    const unresolved = new Set();
    const returned = new Set();

    uses.forEach((entries, subject) => entries.forEach(({ kind = '', target = false, unresolvedRequiresCallable = false,
        unresolvedValue = false, resultRole = '', resultTarget = false } = {}) => {
        // An unresolved consumer retains its requirement without proving a callable use.
        if (callableUse(kind) || (unresolvedValue && unresolvedRequiresCallable)) retain(direct, subject);

        if (kind === 'escape' || unresolvedValue) retain(escapes, subject);

        if (kind === 'result') retain(results, subject);

        if (kind === 'forward' && target) append(callers.get(target) || put(callers, target, []), { subject, unresolvedRequiresCallable, resultRole, resultTarget });
    }));
    results.forEach(subject => traverse(subject, { enter: (current) => {
        if (returned.has(current)) return [];

        retain(returned, current);

        return (callers.get(current) || []).flatMap(({ subject = false, unresolvedRequiresCallable = false, resultRole = '', resultTarget = false } = {}) => {
            if (resultRole === 'discard') return [];

            if (resultTarget) {
                append(callers.get(resultTarget) || put(callers, resultTarget, []), { subject, unresolvedRequiresCallable, resultRole: 'return' });

                return returned.has(resultTarget) ? [subject] : [];
            }

            if (resultRole === 'invoke' || (resultRole === 'observe' && unresolvedRequiresCallable)) retain(direct, subject);

            if (resultRole === 'observe') retain(escapes, subject);

            return !resultRole || resultRole === 'return' ? [subject] : [];
        });
    } }));
    escapes.forEach(subject => traverse(subject, { enter: (current) => {
        if (unresolved.has(current)) return [];

        retain(unresolved, current);

        return (callers.get(current) || []).map(({ subject = false, unresolvedRequiresCallable = false } = {}) => {
            if (unresolvedRequiresCallable) retain(direct, subject);

            return subject;
        });
    } }));
    direct.forEach(subject => traverse(subject, { enter: (current) => {
        if (callable.has(current)) return [];

        retain(callable, current);

        return (callers.get(current) || []).map(({ subject = false } = {}) => subject);
    } }));

    return { callable, unresolved, returned };
};

// Query state receives owned records only. Keeping this factory outside source
// acquisition prevents its closure from retaining lexical indexes or host ASTs.
const declarationQueries = ({ prepared = [], uses = new Map(), demand = {} } = {}) => {
    const { callable: callableSubjects = new Set(), unresolved: unresolvedSubjects = new Set(), returned = new Set() } = forwardingRequirements(uses);
    const reachesUnresolved = ({ target = false, unresolvedRequiresCallable = false, resultRole = '' } = {}) => (
        (unresolvedRequiresCallable && unresolvedSubjects.has(target)) ||
        (returned.has(target) && resultRole === 'observe' && unresolvedRequiresCallable)
    );
    const exposesResult = ({ target = false, unresolvedRequiresCallable = false, resultRole = '' } = {}) => (
        resultRole === 'return' && unresolvedRequiresCallable && returned.has(target)
    );
    const requiresCallable = (entry = {}, mode = 'observe') => {
        const { target = false, resultTarget = false, resultRole = '', unresolvedValue = false, unresolvedRequiresCallable = false } = entry;
        const invokedResult = resultRole === 'invoke' || (mode === 'invoke' && (!resultRole || resultRole === 'return' || resultTarget));

        return (unresolvedValue && unresolvedRequiresCallable) || callableSubjects.has(target) || reachesUnresolved(entry) ||
            (returned.has(target) && (invokedResult || callableSubjects.has(resultTarget)));
    };
    const consumers = new Map();
    const consumerTasks = new Map(['observe', 'discard', 'invoke'].map(mode => [mode, new Map()]));
    const consumerTask = (subject, mode = 'observe') => {
        const tasks = consumerTasks.get(mode);

        return tasks.get(subject) || put(tasks, subject, { subject, mode });
    };
    const downstream = ({ target = false, resultTarget = false, resultRole = '' } = {}, mode = 'observe') => {
        const result = returned.has(target) && resultTarget;
        const selected = !resultRole || resultRole === 'return' ? mode : resultRole;

        // A returned source value is safe either when the producer establishes
        // its callability or when its later consumer owns the required guard.
        // Both alternatives still check every effect in the producer.
        return result ? [[consumerTask(target, 'invoke')], [consumerTask(target, 'discard'), consumerTask(result, mode)]]
            : [[consumerTask(target, ['discard', 'invoke'].includes(selected) ? selected : 'observe')]];
    };
    const downstreamProof = (groups) => {
        const unknown = { status: 'unknown', reason: 'The forwarded consumer is unresolved' };
        const alternatives = groups.map((group) => {
            const proofs = group.map(task => consumers.get(task) || unknown);

            return proofs.find(({ status = '' } = {}) => status !== 'agreement') || {
                ...safeData, consumed: proofs.some(({ consumed = true } = {}) => consumed)
            };
        });

        return alternatives.find(({ status = '', consumed = true } = {}) => status === 'agreement' && consumed) ||
            alternatives.find(({ status = '' } = {}) => status === 'agreement') || alternatives.at(0) || unknown;
    };
    const forwardingGuards = new WeakMap();
    const summaries = new Map();
    const callableSummaries = new Map();
    const presenceSummaries = new Map();
    const tupleProofs = new WeakMap();
    const tupleResults = new WeakMap();
    const openField = ({ target = false, name = '' } = {}, observation) => {
        if (!target) return required;

        const owner = demand.ownerFor(target);

        demand.ensure(owner, observation);
        const { families = [], incomplete = true } = readFamily({ owner, ...observation });

        if (incomplete || families.length !== 1 || families.at(0) !== 'object') return required;

        const { cases = [] } = readField({ owner, name, ...observation });
        const open = cases.some(({ state = '' } = {}) => state === 'unknown');
        const absent = cases.some(({ state = '' } = {}) => state === 'absent');
        const callable = cases.length && cases.every(({ state = '', owner = false } = {}) => {
            if (state !== 'present') return false;

            const { families = [], incomplete = true } = readFamily({ owner, ...observation });

            return !incomplete && families.length === 1 && families.at(0) === 'function';
        });

        if (callable) return admitted('known-callable-field', 'Every source alternative supplies a callable; no synthetic default is needed');

        return open && !absent ? admitted('open-object-field', 'A proved object boundary preserves its open field value and natural absence') : required;
    };
    const resultFor = (model, observation) => {
        if (tupleResults.has(model)) return tupleResults.get(model);

        const { identity = false, normal = 'unknown', returns = [], absences = [], owner = false } = demand.functionValue(model, observation);
        const { families = [], incomplete = false } = readFamily({ ...observation, owner });

        return put(tupleResults, model, Object.freeze({ identity, normal, families, absences, incomplete,
            returns: Object.freeze(returns.map(({ location = {} } = {}) => location)) }));
    };
    const tupleProof = (boundary, observation) => {
        if (tupleProofs.has(boundary)) return tupleProofs.get(boundary);

        const { model = {}, failure = false } = boundary;
        const { execution = false } = model;
        const { identity = false } = demand.ensure(failure, observation);
        const { identity: returned = false, normal = 'unknown', returns = [], families = [], absences = [], incomplete = false } = resultFor(model, observation);
        const { execution: origin = false, position = -1, fallback = false, location = {} } = identity;
        const preserved = normal === true && identity && returned === identity && origin === execution && position >= 0 && !fallback;
        const status = [preserved && 'agreement', (families.length > 1 || absences.length > 1) && 'contradiction', 'unknown'].find(Boolean);
        const evidence = Object.freeze([Object.freeze({ kind: 'tuple-result',
            status,
            families, absences, incomplete, returns,
            ...(preserved ? { parameter: position, location } : {}) })]);
        const result = preserved ? admitted('guarded-tuple-identity', 'Tuple rejection and every normal return preserve the same formal value', evidence)
            : Object.freeze({ ...required, reason: 'Tuple rejection has no proved result identity or carrier correspondence', evidence });

        return put(tupleProofs, boundary, result);
    };
    const proofFor = ({ kind = '', expression = {}, capability = false, guard: { syntaxOnly = false } = {} } = {}, observation, executableOnly = false) => {
        if (kind === 'guard') return { status: executableOnly && syntaxOnly ? 'unknown' : 'agreement',
            reason: 'An acquired callable predicate consumes natural absence' };

        return demand.checkCapability({ expression, capability, observation, executableOnly });
    };
    const forwardGuard = (entry, observation, exposed = false, mode = 'observe') => {
        if (!exposed && !requiresCallable(entry, mode)) return false;

        if (forwardingGuards.has(entry)) return forwardingGuards.get(entry);

        const proof = proofFor(entry, observation, true);
        const { status = '' } = proof;

        return put(forwardingGuards, entry, status === 'agreement');
    };
    const safeForwardedData = (entry = {}, mode = 'observe') => {
        const { absenceSafe = false } = entry;

        return absenceSafe && !requiresCallable(entry, mode);
    };
    const consumerProof = (entry, observation) => {
        const active = new Set();
        const roots = downstream(entry);

        roots.flat().forEach(root => traverse(root, { enter: (task) => {
            if (consumers.has(task)) return [];

            if (active.has(task)) {
                put(consumers, task, Object.freeze({ status: 'unknown', reason: 'Cyclic forwarding does not establish a consumer contract' }));

                return [];
            }

            retain(active, task);
            const { subject = false, mode = 'observe' } = task;

            // Evidence at the forwarding site can discharge the edge before
            // traversal. Unproved recursive edges remain cyclic.
            return (uses.get(subject) || []).flatMap((entry) => {
                const { kind = '', target = false, localProofOnly = false } = entry;

                return kind === 'forward' && target && !localProofOnly && !reachesUnresolved(entry) &&
                    !safeForwardedData(entry, mode) && !forwardGuard(entry, observation, false, mode) ? downstream(entry, mode).flat() : [];
            });
        }, leave: (task) => {
            if (consumers.has(task)) return;

            const { subject = false, mode = 'observe' } = task;
            const entries = uses.get(subject) || [];
            const inspect = (entry) => {
                const { kind = '', absenceSafe = false, localProofOnly = false } = entry;

                if (kind === 'result' && mode === 'discard') return safeData;

                if (kind === 'result' && mode === 'invoke') return proofFor(entry, observation, true);

                if (kind === 'escape' || kind === 'result') return { status: 'unknown', reason: 'The formal value escapes guarded consumption' };

                if (kind === 'data' && absenceSafe) return safeData;

                if (kind === 'forward' && safeForwardedData(entry, mode)) return safeData;

                if (kind === 'forward' && forwardGuard(entry, observation, false, mode)) return guardedForwarding;

                if (kind === 'forward') {
                    const unknown = { status: 'unknown', reason: 'The forwarded consumer is unresolved' };

                    return !localProofOnly && !reachesUnresolved(entry) ? downstreamProof(downstream(entry, mode)) : unknown;
                }

                return proofFor(entry, observation, true);
            };
            const results = entries.map((entry = {}) => {
                const { consumed = true } = entry;
                const result = inspect(entry);

                return consumed ? result : { ...result, consumed: false };
            });
            const failure = results.find(({ status = '' } = {}) => status !== 'agreement');
            const result = failure || { status: 'agreement', reason: 'Every callable use of the formal is guarded by executable evidence',
                consumed: results.some(({ consumed = true } = {}) => consumed) };
            notify(observation, 'callable-consumer');

            put(consumers, task, Object.freeze(result));
        } }));

        const proof = downstreamProof(roots);
        const { consumed = true } = proof;

        // An unused branch adds no callable obligation to a join. It cannot
        // establish an absence contract for an otherwise unconsumed value.
        return consumed ? proof : { status: 'unknown', reason: 'The forwarded value has no established consumption' };
    };
    const checkCallable = ({ index: position = -1, ...observation } = {}) => {
        if (!Number.isInteger(position) || position < 0 || position >= prepared.length) throw new RangeError('Expected a declaration index in this analysis');

        if (callableSummaries.has(position)) return callableSummaries.get(position);

        const { capability = false } = prepared.at(position);
        const candidates = uses.get(capability) || [];
        const testedOnly = candidates.length && candidates.every(({ kind = '' } = {}) => kind === 'guard');
        const statuses = candidates.map((entry) => {
            const { kind = '', target = false, localProofOnly = false } = entry;

            if (['data', 'escape', 'result'].includes(kind) || (kind === 'guard' && !testedOnly)) return 'unproved';

            if (kind === 'forward' && !target) return 'unproved';

            const exposed = exposesResult(entry);

            if (kind === 'forward' && forwardGuard(entry, observation, exposed)) return 'agreement';

            if (kind === 'forward' && (localProofOnly || reachesUnresolved(entry) || exposed)) return 'unproved';

            const { status = 'unproved' } = kind === 'forward' ? consumerProof(entry, observation) : proofFor(entry, observation);

            return status;
        });
        const evidence = candidates.flatMap(({ kind = '', target = false, location = {} } = {}, offset) => {
            if (statuses.at(offset) !== 'agreement') return [];

            if (!target) return [Object.freeze({ kind, location })];

            const { location: consumer = {}, filename = '' } = target;

            return [Object.freeze({ kind, location, consumer, filename })];
        });
        const callableEvidence = candidates.some((entry, offset) => {
            const { kind = '' } = entry;

            return statuses.at(offset) === 'agreement' && (callableUse(kind) || requiresCallable(entry) || exposesResult(entry));
        });
        const unguarded = evidence.length && candidates.some((entry, offset) => {
            const { kind = '', absenceSafe = false, optionalDirect = false } = entry;
            const status = statuses.at(offset);

            if (kind === 'guard' || status === 'agreement') return false;

            // A separate guarded callable use can establish the optional
            // contract while the direct-call rule reports this contradiction.
            if (optionalDirect && status === 'contradiction' && callableEvidence) return false;

            if (callableUse(kind) || requiresCallable(entry) || exposesResult(entry)) return true;

            if (absenceSafe) return false;

            return proofFor(entry, observation).status !== 'agreement';
        });
        const result = !unguarded && evidence.length ? admitted('guarded-callable', 'Callable absence is handled at established uses', evidence) : required;

        return put(callableSummaries, position, result);
    };
    const checkPresence = ({ index: position = -1, ...observation } = {}) => {
        const callable = checkCallable({ index: position, ...observation });
        const { required: unproved = true } = callable;

        if (!unproved) return callable;

        if (presenceSummaries.has(position)) return presenceSummaries.get(position);

        const { capability = false, presence = [] } = prepared.at(position);
        const exposed = (uses.get(capability) || []).some(exposesResult);
        const safe = !exposed && !callableSubjects.has(capability) && presence.length && presence.every(({ kind = '' } = {}) => kind !== 'escape') &&
            presence.some(({ kind = '' } = {}) => kind !== 'alias');
        const result = safe ? admitted('guarded-value', 'Every value use consumes absence or belongs to a presence-selected branch', presence) : required;

        notify(observation, 'absence-consumer');

        return put(presenceSummaries, position, result);
    };
    const check = ({ index: position = -1, ...observation } = {}) => {
        if (!Number.isInteger(position) || position < 0 || position >= prepared.length) throw new RangeError('Expected a declaration index in this analysis');

        if (summaries.has(position)) return summaries.get(position);

        const { admission: declared = required, tuple = false, field = {}, capability = false } = prepared.at(position);
        const admission = tuple ? tupleProof(tuple, observation) : declared;
        const { required: missing = false } = admission;

        if (!missing) return put(summaries, position, admission);

        const natural = openField(field, observation);
        const { required: undeclared = true, code = '' } = natural;

        if (!undeclared && (code !== 'open-object-field' || !callableSubjects.has(capability))) return put(summaries, position, natural);

        const presence = checkPresence({ index: position, ...observation });
        const { required: unproved = true } = presence;

        return put(summaries, position, unproved ? admission : presence);
    };

    return { check, checkCallable, checkPresence };
};

// Consumer proofs belong to formal bindings and are shared by every forwarding
// use. Actual caller arguments never participate in these generic proofs.
export const prepareDeclarations = ({ index = {}, model = {}, demand = {} } = {}) => {
    const { declarations = [], parents = new WeakMap() } = index;
    // Required source acquisition is checked below before capture; a fallback cannot manufacture expression evidence.
    const { capabilities = {}, uses: { bySubject = new Map(), presenceBySubject = new Map() } = {}, functions = [], expressionFor, patternFor } = model;
    // The required capability lookup is checked below before capture; no substitute can establish binding identity.
    const { subjectFor } = capabilities;

    if (typeof subjectFor !== 'function' || typeof expressionFor !== 'function' || typeof patternFor !== 'function') {
        throw new TypeError('Expected owned declaration and use acquisition');
    }

    const uses = new Map();
    const boundaryFor = absenceBoundaries(index);

    declarations.forEach(({ node = {} } = {}) => traverse(subjectFor(node), { enter: (subject) => {
        if (!subject || uses.has(subject)) return [];

        const entries = Object.freeze((bySubject.get(subject) || []).map(({ node: call = false, location = false, ...use } = {}) => (
            Object.freeze({ ...use, expression: call ? expressionFor(call) : false, location: call ? locationOf(call) : location || locationOf() })
        )));

        put(uses, subject, entries);

        return entries.flatMap(({ target = false, resultTarget = false } = {}) => [target, resultTarget].filter(Boolean));
    } }));
    const tupleBoundaries = new WeakMap();
    const prepared = declarations.map((declaration) => {
        const { node = {}, defaulted = false, rest = false, destructured = false, objectProperty = false,
            parameterPattern = false, init = false, pattern = {} } = declaration;
        const capability = subjectFor(node);

        if (defaulted) return { capability, admission: admitted('authored-default', 'The source declares its absence value') };

        if (rest) return { capability, admission: admitted('rest-binding', 'Rest owns its collection value') };

        if (!destructured) return { capability, admission: admitted('root-pattern', 'Root pattern absence is outside the leaf default policy') };

        const { type = '' } = pattern;
        const { type: initializer = '', callee: { type: calleeType = '', computed = false, name = '', property: { name: member = '' } = {} } = {} } = init ?? {};
        const stateTuple = type === 'ArrayPattern' && initializer === 'CallExpression' && (calleeType === 'Identifier' ? name === 'useState'
            : calleeType === 'MemberExpression' && !computed && member === 'useState');

        if (stateTuple) return { capability, admission: admitted('state-tuple', 'The documented state tuple preserves its external value and setter boundary') };

        const boundary = boundaryFor(declaration);
        const { code = '', functionIndex = -1, failure = false } = boundary;
        const { type: bindingType = '' } = node;
        const leaf = objectProperty && !parameterPattern && bindingType === 'Identifier';
        const direct = leaf && init && parents.get(parents.get(node)) === pattern;
        const selected = leaf && !direct ? patternFor(node, pattern) : {};
        const { kind = '', target = false, name: fieldName = '' } = selected;
        const { known = false, name: directName = '' } = propertyName(parents.get(node) || {});
        const field = direct && known ? { target: expressionFor(init), name: directName } : {};

        if (failure && !tupleBoundaries.has(boundary)) put(tupleBoundaries, boundary, Object.freeze({
            model: functions.at(functionIndex), failure: demand.ownerFor(expressionFor(failure))
        }));

        return { capability, presence: Object.freeze(objectProperty && bindingType === 'Identifier' ? [...(presenceBySubject.get(capability) || [])] : []),
            admission: code ? admitted(code, 'A documented structural boundary preserves the supplied value') : required,
            field: Object.freeze(kind === 'selection' ? { target, name: fieldName } : field),
            tuple: tupleBoundaries.get(boundary) || false };
    });

    return declarationQueries({ prepared, uses, demand });
};
