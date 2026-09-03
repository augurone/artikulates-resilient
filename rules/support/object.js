const isObject = value => Object.prototype.toString.call(value) === '[object Object]';

const getObject = value => isObject(value) ? value : {};

const hasObjectValue = (ob = {}) => isObject(ob) && !!(Object.keys(ob).length);

export {
    getObject,
    hasObjectValue,
    isObject
};
