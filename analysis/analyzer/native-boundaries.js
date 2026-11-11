import { put } from '../collections.js';
import { traverse } from '../traversal.js';
import { nativeFunctions, nativeFunctionNamespaces, nativeNamespaces, nativePaths } from './native-members.js';

// Native identity is separate from application-owned receiver lifetime.
export const acquireNativeBoundaries = ({ bindings = [], identities = new WeakMap(), callableResolutions = new WeakMap(), writes = new Set() } = {}) => {
    const intrinsics = new Set([...nativeFunctionNamespaces, ...nativeNamespaces.keys()]);
    const nativeAliases = new WeakMap();
    const nativeSelections = new WeakMap();
    const intrinsicName = (node = {}) => {
        if (!node) return '';

        const { type = '', name = '' } = node;
        const binding = identities.get(node);

        return type === 'Identifier' && !binding && intrinsics.has(name) ? name : nativeAliases.get(binding) || '';
    };
    const intrinsicFor = (node = {}) => {
        if (!node) return '';

        traverse(node, { enter: (current = {}) => {
            const { type = '', computed = false, object = {} } = current;

            return nativeSelections.has(current) || type !== 'MemberExpression' || computed ? [] : [object];
        }, leave: (current = {}) => {
            if (nativeSelections.has(current)) return;

            const { type = '', computed = false, object = {}, property: { name = '' } = {} } = current;
            const path = `${nativeSelections.get(object) || ''}.${name}`;
            const selected = type === 'MemberExpression' && !computed ? nativePaths.has(path) && path : intrinsicName(current);

            put(nativeSelections, current, selected || '');
        } });

        return nativeSelections.get(node);
    };
    bindings.forEach((binding) => {
        const { init = {}, immutable = false, declaration: { destructured = false } = {} } = binding;
        const intrinsic = init && immutable && !destructured && !writes.has(binding) && intrinsicFor(init);
        const { receiverBound = false } = nativeFunctions.get(intrinsic) ?? {};

        if (intrinsic && !receiverBound) put(nativeAliases, binding, intrinsic);
    });
    const observesArgument = (callee) => {
        if (!callee) return false;

        const intrinsic = intrinsicFor(callee);
        const { observes = false } = nativeFunctions.get(intrinsic) ?? {};

        return observes;
    };
    const intrinsicAt = node => identities.has(node) && !callableResolutions.has(node) ? '' : intrinsicFor(node);

    return { observesArgument, intrinsicAt, promiseTargetFor: node => intrinsicAt(node) === 'Promise' };
};
