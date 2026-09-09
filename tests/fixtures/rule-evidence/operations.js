export const flow = (value, stage) => () => {
    if (typeof stage !== 'function') return '';

    return stage(value);
};
