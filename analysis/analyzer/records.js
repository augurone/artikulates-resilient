import { forget, put, retain } from '../collections.js';
import { propertyName, prototypeDefinition } from '../estree-properties.js';

const hasObservableReads = (property = {}) => {
    const { kind = 'init' } = property;

    return kind !== 'init' || prototypeDefinition(property);
};

export const ownsRecordFields = ({ type = '', properties = [] } = {}) => type === 'ObjectExpression' && !properties.some(hasObservableReads);

// These source headers are acquisition scratch, shared by the actual record's
// consumers. They establish eligibility and method names, never selected values.
export const acquireRecordSources = (observesFunction = () => false) => {
    const sources = new WeakMap();
    const closedMethod = (value = {}) => {
        const { type = '' } = value;

        return type === 'ArrowFunctionExpression' || (type === 'FunctionExpression' && observesFunction(value));
    };

    return (node = {}) => {
        if (sources.has(node)) return sources.get(node);

        const { type = '', properties = [] } = node ?? {};

        if (type !== 'ObjectExpression') return false;

        const ownsFields = ownsRecordFields(node);
        const closed = ownsFields && properties.every(({ type = '', computed = false, key = {} } = {}) => {
            const { known = false } = propertyName({ computed, key });

            return type === 'Property' && known;
        });
        const methods = ownsFields ? new Set() : false;

        if (methods) properties.forEach(({ type = '', computed = false, key = {}, value = {} } = {}) => {
            const { known = false, name = '' } = propertyName({ computed, key });

            // A spread or unknown name can overwrite any earlier method.
            // Later explicit own data properties still establish their names.
            if (type !== 'Property' || !known) {
                methods.forEach(name => forget(methods, name));

                return;
            }

            if (closedMethod(value)) {
                retain(methods, name);

                return;
            }

            forget(methods, name);
        });

        return put(sources, node, Object.freeze({ ownsFields, methods, closed }));
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
