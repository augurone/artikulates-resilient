// Interpret property syntax only. Adapters still own whether a source is safe
// to consume; agreement owns the evidence retained from that source.
export const propertyName = ({ computed = false, key = {} } = {}) => {
    const { type = '', name = '' } = key;

    if (!computed && type === 'Identifier') return { known: true, name };

    if (type !== 'Literal') return { known: false };

    const { value = false } = key;

    if (['string', 'number'].includes(typeof value)) return { known: true, name: String(value) };

    return { known: false };
};

export const prototypeDefinition = ({ type = '', computed = false, method = false, shorthand = false, kind = 'init', key = {} } = {}) => {
    const { known = false, name = '' } = propertyName({ computed, key });

    return type === 'Property' && !computed && !method && !shorthand && kind === 'init' && known && name === '__proto__';
};
