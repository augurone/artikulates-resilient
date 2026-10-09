import { appendFileSync } from 'node:fs';
import path from 'node:path';

// Native runner events, rather than a successful process exit, own the cases.
export default async function* reportProjectTests(events) {
    const { env: { RESILIENT_PROJECT_CASES = '', RESILIENT_PROJECT_ROOT = '' } = {} } = process;
    const names = new Map();
    const ancestors = new Map();

    // eslint-disable-next-line resilient/prefer-prototype-methods -- Native runner events arrive as an asynchronous stream whose suite/case order owns the decoder state.
    for await (const event of events) {
        const { type = '', data = {} } = event;
        const { file = '', name = '', nesting = 0, skip = false, todo = false, details: { type: kind = '', error = {} } = {} } = data;
        const stack = ancestors.get(file) || [];

        if (type === 'test:stderr') {
            const { message = '' } = data;
            process.stderr.write(message);
        }

        if (type === 'test:stdout') {
            const { message = '' } = data;
            yield message;
        }

        if (type === 'test:start') {
            // eslint-disable-next-line resilient/prefer-safe-transformations -- The private current-suite stack follows native ordered runner events and never mutates test records.
            ancestors.set(file, [...stack.slice(0, nesting), name]);
        }

        if (!['test:pass', 'test:fail'].includes(type) || kind === 'suite' || !file || name === file) continue;

        const fullName = [...stack.slice(0, nesting), name].join(' > ');
        const relative = path.relative(RESILIENT_PROJECT_ROOT, file).split(path.sep).join('/');
        const key = JSON.stringify([relative, fullName]);
        const ordinal = names.get(key) || 0;
        const status = [skip && 'skipped', todo && 'todo', type === 'test:pass' && 'passed', 'failed'].find(Boolean);

        if (status === 'failed') {
            const { stack = '', message = '' } = error;
            process.stderr.write(`${stack || message}\n`);
        }

        // eslint-disable-next-line resilient/prefer-safe-transformations -- Duplicate-case ordinals are private event-decoder state, not a mutation of runner results.
        names.set(key, ordinal + 1);
        appendFileSync(RESILIENT_PROJECT_CASES, `${JSON.stringify({ file: relative, name: fullName, ordinal, status })}\n`);
        yield '';
    }
}
