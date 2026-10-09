import { getNodeShape } from './ast-boundary.js';

const createAstShape = (node = {}) => {
    const shape = getNodeShape(node);
    const {
        kind = 0,
        text = '',
        name = {},
        type = {},
        parameters = [],
        statements = []
    } = shape;

    return {
        kind,
        text,
        name,
        type,
        parameters: Array.isArray(parameters) ? parameters : [],
        statements: Array.isArray(statements) ? statements : []
    };
};

const getParameterShape = (parameter = {}) => {
    const { name = {}, type = {} } = createAstShape(parameter);
    const { text = '' } = createAstShape(name);

    return { name: text, type };
};

export {
    createAstShape,
    getParameterShape
};
