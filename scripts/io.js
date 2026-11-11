import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Developer commands share one serialization and output boundary.
const serialize = (record, pretty = false) => JSON.stringify(record, null, pretty ? 2 : 0) + '\n';

export const report = (record, { pretty = false } = {}) => process.stdout.write(serialize(record, pretty));
export const saveReport = (destination, record) => {
    const path = destination instanceof URL ? fileURLToPath(destination) : destination;

    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, serialize(record, true));
};
