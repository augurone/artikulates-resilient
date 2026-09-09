import { selectProofs } from './proof-families.js';
import { assertSupportedRuntime } from '../scripts/proof-runtime.js';

assertSupportedRuntime();

const proofs = selectProofs(process.argv.slice(2));
const { length: total = 0 } = proofs;
let completed = 0;

// eslint-disable-next-line resilient/prefer-prototype-methods -- Test modules load sequentially so top-level fixtures remain isolated.
for (const testFile of proofs) {
    process.stdout.write(`[${completed + 1}/${total}] ${testFile}\n`);
    await import(testFile);
    completed += 1;
}

process.stdout.write(`Passed ${completed} test modules.\n`);
