const isObject = value => Object.prototype.toString.call(value) === '[object Object]';

const getObject = value => isObject(value) ? value : {};

const hasContent = (value = {}) => isObject(value) && !!(Object.keys(value).length);

const hasObjectValue = hasContent;

const modelCheck = (attr, model) => !!attr && isObject(model) && attr in model;

export {
    getObject,
    hasContent,
    hasObjectValue,
    isObject,
    modelCheck
};
