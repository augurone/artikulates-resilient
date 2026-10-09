import { readFamily, readField } from 'eslint-plugin-resilient/agreement';

import { put, retain } from '../collections.js';
import { propertyName } from '../estree-properties.js';
import { traverse } from '../traversal.js';
import { absenceBoundaries } from './absence-boundaries.js';
import { locationOf } from './locations.js';
import { notify } from './work.js';

const admitted = (code, reason, evidence = []) => Object.freeze({ required: false, code, reason, evidence: Object.freeze(evidence) });
const required = Object.freeze({ required: true, code: 'missing-absence-contract',
    reason: 'No authored default or established absence boundary', evidence: Object.freeze([]) });

// Query state receives owned records only. Keeping this factory outside source
// acquisition prevents its closure from retaining lexical indexes or host ASTs.
const declarationQueries = ({ prepared = [], uses = new Map(), demand = {} } = {}) => {
    const consumers = new Map();
    const summaries = new Map();
    const callableSummaries = new Map();
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
    const consumerProof = (capability, observation) => {
        const active = new Set();

        traverse(capability, { enter: (subject) => {
            if (consumers.has(subject)) return [];

            if (active.has(subject)) {
                put(consumers, subject, Object.freeze({ status: 'unknown', reason: 'Cyclic forwarding does not establish a consumer contract' }));

                return [];
            }

            retain(active, subject);

            return (uses.get(subject) || []).flatMap(({ kind = '', target = false } = {}) => kind === 'forward' && target ? [target] : []);
        }, leave: (subject) => {
            if (consumers.has(subject)) return;

            const entries = uses.get(subject) || [];
            const results = entries.map((entry) => {
                const { kind = '', target = false } = entry;

                if (kind === 'escape') return { status: 'unknown', reason: 'The formal value escapes guarded consumption' };

                if (kind === 'forward') return consumers.get(target) || { status: 'unknown', reason: 'The forwarded consumer is unresolved' };

                return proofFor(entry, observation, true);
            });
            const failure = results.find(({ status = '' } = {}) => status !== 'agreement');
            const result = failure || (entries.length ? { status: 'agreement', reason: 'Every callable use of the formal is guarded by executable evidence' }
                : { status: 'unknown', reason: 'The formal has no established callable consumer' });
            notify(observation, 'callable-consumer');

            put(consumers, subject, Object.freeze(result));
        } });

        return consumers.get(capability);
    };
    const checkCallable = ({ index: position = -1, ...observation } = {}) => {
        if (!Number.isInteger(position) || position < 0 || position >= prepared.length) throw new RangeError('Expected a declaration index in this analysis');

        if (callableSummaries.has(position)) return callableSummaries.get(position);

        const { capability = false } = prepared.at(position);
        const candidates = uses.get(capability) || [];
        const testedOnly = candidates.length && candidates.every(({ kind = '' } = {}) => kind === 'guard');
        const evidence = candidates.flatMap((entry) => {
            const { kind = '', target = false, location = {} } = entry;

            if (kind === 'escape' || (kind === 'guard' && !testedOnly)) return [];

            const proof = kind === 'forward' ? target && consumerProof(target, observation) : proofFor(entry, observation);
            const { status = '' } = proof ?? {};

            const { location: consumer = {}, filename = '' } = target;

            return status === 'agreement' ? [Object.freeze({ kind, location, ...(target ? { consumer, filename } : {}) })] : [];
        });
        const result = evidence.length ? admitted('guarded-callable', 'Callable absence is handled at established uses', evidence) : required;

        return put(callableSummaries, position, result);
    };
    const check = ({ index: position = -1, ...observation } = {}) => {
        if (!Number.isInteger(position) || position < 0 || position >= prepared.length) throw new RangeError('Expected a declaration index in this analysis');

        if (summaries.has(position)) return summaries.get(position);

        const { admission: declared = required, tuple = false, field = {} } = prepared.at(position);
        const admission = tuple ? tupleProof(tuple, observation) : declared;
        const { required: missing = false } = admission;

        if (!missing) return put(summaries, position, admission);

        const natural = openField(field, observation);
        const { required: undeclared = true } = natural;

        if (!undeclared) return put(summaries, position, natural);

        const callable = checkCallable({ index: position, ...observation });
        const { required: unproved = true } = callable;

        return put(summaries, position, unproved ? admission : callable);
    };

    return { check, checkCallable };
};

// Consumer proofs belong to formal bindings and are shared by every forwarding
// use. Actual caller arguments never participate in these generic proofs.
export const prepareDeclarations = ({ index = {}, model = {}, demand = {} } = {}) => {
    const { declarations = [], parents = new WeakMap() } = index;
    // Required source acquisition is checked below before capture; a fallback cannot manufacture expression evidence.
    const { capabilities = {}, uses: { bySubject = new Map() } = {}, functions = [], expressionFor, patternFor } = model;
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

        return entries.flatMap(({ target = false } = {}) => target ? [target] : []);
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

        return { capability,
            admission: code ? admitted(code, 'A documented structural boundary preserves the supplied value') : required,
            field: Object.freeze(kind === 'selection' ? { target, name: fieldName } : field),
            tuple: tupleBoundaries.get(boundary) || false };
    });

    return declarationQueries({ prepared, uses, demand });
};
