import { getObject } from '../support/object.js';

// Project-tree passes unique sorted names and private materialized native edge records.
const getReverseDependents = ({ fileNames = [], indexedFiles = {} } = {}) => {
    if (!fileNames.length) return {};

    if (fileNames.length === 1) {
        const [fileName = ''] = fileNames;
        const { [fileName]: entry = {} } = indexedFiles;
        const { edges = [] } = getObject(entry);
        const dependent = edges.some(({ targetFile = '' } = {}) => targetFile === fileName);

        return { [fileName]: dependent ? [fileName] : [] };
    }

    const domain = new Set(fileNames);
    const dependents = Object.groupBy(fileNames.flatMap((fileName = '') => {
        const { [fileName]: entry = {} } = indexedFiles;
        const { edges = [] } = getObject(entry);
        const targets = new Set(edges.map(({ targetFile = '' } = {}) => targetFile)
            .filter(target => typeof target === 'string' && domain.has(target)));

        return [...targets].map(target => ({ target, fileName }));
    }), ({ target = '' } = {}) => target);

    return Object.fromEntries(fileNames.map((fileName = '') => {
        const { [fileName]: entries = [] } = dependents;

        return [fileName, entries.map(({ fileName: dependent = '' } = {}) => dependent)];
    }));
};

export { getReverseDependents };
