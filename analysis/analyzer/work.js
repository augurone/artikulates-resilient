export const notify = ({ onWork } = {}, kind = '') => {
    if (typeof onWork !== 'function') return;

    onWork(Object.freeze({ kind }));
};
