import { writeFileSync } from 'node:fs';

const writeJsonReport = (file, value) => writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);

export { writeJsonReport };
