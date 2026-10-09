import path from 'node:path';

const getFileCandidates = ({ base = '', extensions = ['.js', '.jsx'] } = {}) => [
    base,
    ...extensions.map(extension => `${base}${extension}`),
    path.join(base, 'index.js')
];

export { getFileCandidates };
