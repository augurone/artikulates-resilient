const isArray = value => Array.isArray(value);

const validArray = value => isArray(value) ? value : [];

const hasArrayContent = (value = []) => isArray(value) && !!value.length;

const hasArrayValue = hasArrayContent;

const getArray = value => validArray(value);

export {
    getArray,
    hasArrayContent,
    hasArrayValue,
    isArray,
    validArray
};
