const getBindingReason = ({ kind = '', union = false, opaque = false } = {}) => {
    if (kind === 'union' || union) return 'union branch payload remains opaque; caller owns agreement';

    if (['required', 'unknown'].includes(kind) || opaque &&
        !['string', 'number', 'boolean', 'bigint', 'array', 'object', 'function'].includes(kind)) {
        return 'generic payload remains opaque; caller owns agreement';
    }

    return '';
};

export { getBindingReason };
