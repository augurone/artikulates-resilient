import { forget, put, retain } from '../collections.js';
import { propertyName, prototypeDefinition } from '../estree-properties.js';

const hasObservableReads = (property = {}) => {
    const { kind = 'init' } = property;

    return kind !== 'init' || prototypeDefinition(property);
};

const closedProperty = ({ type = '', computed = false, value: { type: valueType = '' } = {} } = {}) => (
    type === 'Property' && !computed && ['Literal', 'ArrowFunctionExpression'].includes(valueType)
);

export const ownsRecordFields = ({ type = '', properties = [] } = {}) => type === 'ObjectExpression' && !properties.some(hasObservableReads);

// These source headers are acquisition scratch, shared by the actual record's
// consumers. They establish eligibility and method names, never selected values.
export const acquireRecordSources = () => {
    const sources = new WeakMap();

    return (node = {}) => {
        if (sources.has(node)) return sources.get(node);

        const { type = '', properties = [] } = node ?? {};

        if (type !== 'ObjectExpression') return false;

        const ownsFields = ownsRecordFields(node);
        const methods = ownsFields && properties.every(closedProperty) ? new Set() : false;

        if (methods) properties.forEach(({ computed = false, key = {}, value: { type = '' } = {} } = {}) => {
            const { known = false, name = '' } = propertyName({ computed, key });

            if (!known) return;

            if (type === 'ArrowFunctionExpression') {
                retain(methods, name);

                return;
            }

            forget(methods, name);
        });

        return put(sources, node, Object.freeze({ ownsFields, methods }));
    };
};

// A fresh literal has not escaped. Its ordinary own data properties cannot be
// changed by an earlier pattern read. Accessors/prototypes need effect evidence;
// const-bound records need mutation evidence before their fields can be trusted.
export const requiredPatternFields = ({ properties = [] } = {}) => {
    return properties.flatMap(({ type: propertyType = '', key = {}, value = {} } = {}) => {
        const { type: valueType = '' } = value;

        if (propertyType !== 'Property' || valueType === 'AssignmentPattern') return [];

        const { known = false, name = '' } = propertyName({ key });

        return known ? [{ name, key, value }] : [];
    });
};

export const requiredRecordFields = ({ node = {}, pattern = {} } = {}) => ownsRecordFields(node) ? requiredPatternFields(pattern) : [];
