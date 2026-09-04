import { getObject } from './object.js';

const getPatternPropertyNames = ({ pattern = {} } = {}) => {
    const { properties = [] } = getObject(pattern);

    return properties
        .map(({ key: { type = '', name = '' } = {} } = {}) => (
            type === 'Identifier' ? name : ''
        ))
        .filter(Boolean);
};

const getScopeVariableNames = ({ sourceCode = {}, functionNode = {} } = {}) => {
    const { scopeManager: sourceScopeManager = {} } = sourceCode;
    const { acquire = false } = getObject(sourceScopeManager);

    if (typeof acquire !== 'function') return new Set();

    const functionScope = acquire.call(sourceScopeManager, functionNode) ?? {};
    const getScopeNames = ({ variables = [], childScopes = [] } = {}) => {
        const variableNames = variables
            .map(({ name = '' } = {}) => name)
            .filter(Boolean);
        const childNames = childScopes
            .filter(({ type = '' } = {}) => type !== 'function')
            .flatMap((childScope = {}) => getScopeNames(childScope));

        return [...variableNames, ...childNames];
    };

    return new Set(getScopeNames(functionScope));
};

const getAddedPropertyNames = ({ pattern = {}, properties = [] } = {}) => {
    const existingNames = new Set(getPatternPropertyNames({ pattern }));

    return properties.filter((name = '') => !existingNames.has(name));
};

const hasScopeCollision = ({
    sourceCode = {},
    functionNode = {},
    names = []
} = {}) => {
    const scopeVariableNames = getScopeVariableNames({ sourceCode, functionNode });

    return names.some((name = '') => scopeVariableNames.has(name));
};

export {
    getAddedPropertyNames,
    getPatternPropertyNames,
    hasScopeCollision
};
