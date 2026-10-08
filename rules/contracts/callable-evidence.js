import {
    getBinding, getBindingDefinition, getBindingOrigin, getBindingContext, isSameBinding,
    isStableBinding, isStableReference, registerBindingSource
} from './binding-evidence.js';
import { getImportedRuleDefinition, pruneRuleAnalysis } from './eslint-graph.js';
import { hasCallableCapability } from './flow.js';
import { getEnclosingFunction, isFunction as isFunctionNode } from './infer.js';
import { isSynchronousFunctionPredicate } from './member-evidence.js';
import { getObject } from '../support/object.js';

const consumers = [
    { methods: ['map', 'filter', 'some', 'find', 'forEach', 'reduce'], nested: false, single: false },
    { methods: ['sort', 'toSorted'], nested: true, single: true }
];

const createCallableEvidence = (context = {}) => {
    const { sourceCode = {} } = context;
    const { ast: program = {} } = sourceCode;
    pruneRuleAnalysis(program);
    registerBindingSource(sourceCode, context);
    const resolveFunction = (identifier = {}) => {
        const binding = getBindingOrigin(getBinding(identifier));

        if (!isStableBinding(binding)) return {};

        const { type = '', node = {} } = getBindingDefinition(binding);
        const { init = {} } = getObject(node);

        if (type === 'FunctionName') return node;

        if (type === 'Variable' && isFunctionNode(init)) return init;

        if (type !== 'ImportBinding') return {};

        const { name = '' } = getObject(binding);
        const { sourceCode: importedSource = sourceCode, filename = '' } = getObject(getBindingContext(identifier));
        const { settings = {}, languageOptions = {}, parserOptions = {} } = context;
        const { node: importedNode = {} } = getImportedRuleDefinition({
            context: { sourceCode: importedSource, filename, settings, languageOptions, parserOptions }, name
        });

        return importedNode;
    };
    const getGuardCallFact = (call = {}) => {
        const { callee = {}, arguments: args = [] } = getObject(call);
        const { type = '', name = '' } = getObject(callee);

        if (type !== 'Identifier' || args.length !== 1) return '';

        const binding = getBinding(callee);

        // The documented unresolved dialect predicate remains supported locally.
        // Consumer admission requires an actual resolved predicate body.
        if (!binding) return name === 'isFunction' ? 'unresolved-predicate' : '';

        const functionNode = resolveFunction(callee);
        const { type: functionType = '', params = [] } = functionNode;
        const { type: bindingType = '' } = getBindingDefinition(binding);

        if (!functionType && name === 'isFunction' && bindingType === 'ImportBinding') return 'unresolved-predicate';

        const [parameter = {}] = params;

        return isStableBinding(getBinding(parameter)) && isSynchronousFunctionPredicate({
            functionNode,
            matches: candidate => isSameBinding(candidate, parameter)
        })
            ? 'resolved-predicate' : '';
    };
    const queryCapability = (call = {}, identifier = {}, isGuardCall = undefined) => {
        const binding = getBinding(identifier);
        const { references = [] } = getObject(binding);
        const isStable = (guard = {}, use = {}) => {
            const { range: [start = 0] = [] } = guard;
            const { range: [, end = 0] = [] } = use;

            if (getEnclosingFunction(guard) !== getEnclosingFunction(use)) return isStableBinding(binding);

            return references.filter(reference => !isStableReference(reference)).every(({ identifier: { range: [write = 0] = [] } = {} } = {}) => (
                write < start || write >= end
            ));
        };

        return !!binding && hasCallableCapability({
            node: call,
            matches: candidate => isSameBinding(candidate, identifier),
            isGuardCall,
            isStable
        });
    };
    const hasCapability = (call = {}, identifier = {}) => queryCapability(
        call, identifier, candidate => Boolean(getGuardCallFact(candidate))
    );
    const hasConsumerCapability = (call = {}, identifier = {}) => queryCapability(
        call, identifier, candidate => getGuardCallFact(candidate) === 'resolved-predicate'
    );
    const getReferences = (binding) => {
        const { references = [] } = getObject(binding);

        return references.filter(reference => reference.isRead()).map(({ identifier = {} } = {}) => identifier);
    };
    const getAliasFamily = (binding, seen = []) => {
        if (!binding || seen.includes(binding)) return [];

        const aliases = (isStableBinding(binding) ? getReferences(binding) : []).flatMap((identifier) => {
            const { parent = {} } = identifier;
            const { type = '', id = {}, init = {}, parent: declaration = {} } = getObject(parent);
            const { kind = '' } = getObject(declaration);
            const target = getBinding(id);

            return type === 'VariableDeclarator' && init === identifier && kind === 'const' &&
                getBindingOrigin(target) === getBindingOrigin(binding)
                ? getAliasFamily(target, [...seen, binding]) : [];
        });

        return [binding, ...aliases];
    };
    const isGuardedConsumer = (call = {}, index = -1) => {
        const { callee = {}, arguments: args = [] } = getObject(call);
        const { params = [] } = resolveFunction(callee);
        const parameter = params.at(index) || {};
        const { type = '' } = getObject(parameter);
        const binding = getBinding(parameter);

        // Rest/spread, defaulted and destructured formals have different
        // positional ownership. They cannot borrow a fixed parameter's proof.
        if (index < 0 || type !== 'Identifier' || args.some(({ type = '' } = {}) => type === 'SpreadElement') ||
            !isStableBinding(binding)) return false;

        const { scope = {} } = getObject(binding);
        const { set = new Map(), dynamic = false, through = [] } = getObject(scope);
        const { references: argumentsReferences = [] } = getObject(set.get('arguments'));

        const hasDirectEval = through.some(({ identifier = {} } = {}) => {
            const { name = '', parent = {} } = identifier;
            const { type = '', callee = {} } = getObject(parent);

            return name === 'eval' && type === 'CallExpression' && callee === identifier;
        });

        if (dynamic || hasDirectEval || argumentsReferences.length) return false;

        const family = getAliasFamily(binding);
        const references = family.flatMap(getReferences);
        const invocations = references.filter((identifier) => {
            const { parent = {} } = identifier;
            const { type = '', callee = {} } = getObject(parent);

            return type === 'CallExpression' && callee === identifier;
        });
        const allowed = (identifier = {}) => {
            const { parent = {} } = identifier;
            const { type = '', operator = '', callee = {}, init = {}, id = {} } = getObject(parent);

            if (type === 'UnaryExpression' && operator === 'typeof') return true;

            if (type === 'CallExpression' && callee === identifier) return hasConsumerCapability(parent, identifier);

            if (type === 'CallExpression' && getGuardCallFact(parent) === 'resolved-predicate') return true;

            if (type === 'VariableDeclarator' && init === identifier && family.includes(getBinding(id))) return true;

            return false;
        };

        return !!invocations.length && references.every(allowed);
    };
    const hasGuardedUse = (identifier = {}) => {
        const binding = getBinding(identifier);
        const owner = getEnclosingFunction(identifier);
        const references = getAliasFamily(binding).flatMap(getReferences);

        return references.some((reference) => {
            const { parent = {} } = reference;
            const { type = '', callee = {}, arguments: args = [] } = getObject(parent);

            if (type !== 'CallExpression') return false;

            const local = getEnclosingFunction(parent) === owner;

            if (callee === reference) return local && hasCapability(parent, reference);

            const { type: calleeType = '', computed = true, object = {}, property = {} } = getObject(callee);
            const { type: objectType = '' } = getObject(object);
            const { name = '' } = getObject(property);
            const [callback = {}] = args;
            const known = calleeType === 'MemberExpression' && !computed && callback === reference &&
                consumers.some(({ methods = [], nested = false, single = false } = {}) => (
                    methods.includes(name) && (nested || (local && objectType === 'Identifier')) && (!single || args.length === 1)
                ));

            if (known && hasCapability(parent, reference)) return true;

            return args.includes(reference) && isGuardedConsumer(parent, args.indexOf(reference));
        });
    };
    const getOptionalCallback = (identifier = {}) => {
        const binding = getBindingOrigin(getBinding(identifier));
        const { type = '', name: declaration = {} } = getBindingDefinition(binding);
        const { parent = {} } = getObject(declaration);
        const { type: parentType = '', value = {} } = getObject(parent);

        return type === 'Parameter' && parentType === 'Property' && value === declaration ? declaration : false;
    };

    return { getOptionalCallback, hasCapability, hasGuardedUse, isGuardedConsumer };
};

export { createCallableEvidence };
