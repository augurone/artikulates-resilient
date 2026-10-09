import { readFileSync } from 'node:fs';
import { register } from 'node:module';

const { env: { RESILIENT_PROJECT_TESTS = '' } = {} } = process;
const configuration = JSON.parse(readFileSync(RESILIENT_PROJECT_TESTS, 'utf8'));
// eslint-disable-next-line resilient/prefer-safe-destructuring-defaults -- A native URL supplies its required searchParams object; a substitute would hide an unsupported runtime.
const { searchParams } = new URL(import.meta.url);
const guardedConfiguration = { ...configuration, observeHelpers: searchParams.get('role') !== 'host' };

register(new URL('./project-tests-loader.js', import.meta.url), { data: guardedConfiguration });
