import { readdirSync } from 'node:fs';
import path from 'node:path';

const getArtifactLintBatch = (options = []) => {
    const [, , destination = '', partText = '0', batchSizeText = '8', configFile = ''] = options;
    const part = Number(partText);
    const batchSize = Number(batchSizeText);
    const files = readdirSync(path.join(destination, 'js'))
        .filter(name => name.endsWith('.js'))
        .toSorted()
        .slice(part * batchSize, (part + 1) * batchSize)
        .map(name => path.join(destination, 'js', name));

    return { destination, part, configFile, files };
};

export { getArtifactLintBatch };
