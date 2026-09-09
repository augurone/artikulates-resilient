import { checkProofCatalogs } from './proof-catalogs.js';

process.stdout.write(`${JSON.stringify(checkProofCatalogs({ write: process.argv.includes('--write') }), null, 2)}\n`);
