import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { ESLint, auditSource, manifest } from '../config/eslint-host.js';
import { report as printReport, saveReport } from './io.js';

const cwd = fileURLToPath(new URL('../', import.meta.url));
const defaultConcurrency = '6';
const main = async (args = []) => {
    const { values: { concurrency: requested = defaultConcurrency, report: detailed = false, stats = false, help = false } = {}, positionals = [] } = parseArgs({
        args, allowPositionals: true,
        options: { concurrency: { type: 'string', default: defaultConcurrency }, report: { type: 'boolean' }, stats: { type: 'boolean' }, help: { type: 'boolean' } }
    });

    if (help) {
        process.stdout.write('Usage: npm run lint -- [--concurrency <N|off|auto>] [--report] [--stats] [file or glob ...]\n'
            + `Default concurrency: ${defaultConcurrency}. With no file arguments, checks the project excluding test fixtures.\n`
            + '--report writes .artifacts/lint-results.json; --stats includes per-file rule timings in that report.\n');

        return;
    }

    const namedConcurrency = ['off', 'auto'].includes(requested);
    const concurrency = namedConcurrency ? requested : Number(requested);

    if (!namedConcurrency && (!/^[1-9]\d*$/u.test(requested) || !Number.isSafeInteger(concurrency))) {
        throw new RangeError('Expected --concurrency to be a positive safe integer, off, or auto');
    }

    const patterns = positionals.length ? positionals : ['.'];
    const execution = { concurrency, stats, patterns };

    process.stdout.write(`Lint: concurrency ${concurrency} (${patterns.join(', ')})\n`);
    const start = performance.now();
    const cpuStart = process.cpuUsage();
    const eslint = new ESLint({ cwd, overrideConfigFile: fileURLToPath(new URL('../eslint.config.js', import.meta.url)),
        ignorePatterns: positionals.length ? [] : ['tests/fixtures/**'], cache: false, concurrency, stats });
    const results = await eslint.lintFiles(patterns);
    const lintDone = performance.now();
    const exceptions = results.flatMap(({ filePath = '' } = {}) => auditSource(readFileSync(filePath, 'utf8'))
        .map(message => ({ file: relative(cwd, filePath), message })));
    const auditDone = performance.now();
    const { maxRSS = 0 } = process.resourceUsage();
    const measurements = { lintMilliseconds: lintDone - start, auditMilliseconds: auditDone - lintDone, totalMilliseconds: auditDone - start,
        cpu: process.cpuUsage(cpuStart), maxRSSKiB: maxRSS };
    const summary = results.reduce(({
        files = 0, errors = 0, warnings = 0, fatal = 0, suppressed = 0
    } = {}, { errorCount = 0, warningCount = 0, fatalErrorCount = 0, suppressedMessages = [] } = {}) => ({
        files: files + 1, errors: errors + errorCount, warnings: warnings + warningCount,
        fatal: fatal + fatalErrorCount, suppressed: suppressed + suppressedMessages.length
    }), {});
    const formatter = await eslint.loadFormatter('stylish');

    process.stdout.write(formatter.format(results));
    exceptions.forEach(({ file = '', message = '' } = {}) => process.stdout.write(`${file}: ${message}\n`));

    if (detailed) {
        const sourceHashes = Object.fromEntries(results.map(({ filePath = '' } = {}) => [
            relative(cwd, filePath), createHash('sha256').update(readFileSync(filePath)).digest('hex')
        ]));
        const { version: runtime = '' } = process;
        const summaryWithExceptions = { ...summary, exceptionPolicyErrors: exceptions.length };
        const report = { runtime, manifest, execution, measurements, sourceHashes, summary: summaryWithExceptions, exceptions, results };

        saveReport(new URL('../.artifacts/lint-results.json', import.meta.url), report);
        printReport(summaryWithExceptions, { pretty: true });
    }

    process.stdout.write(`Lint timing: ${measurements.lintMilliseconds.toFixed(1)}ms; exception audit: ${measurements.auditMilliseconds.toFixed(1)}ms\n`);

    const { errors = 0, fatal = 0 } = summary;

    // eslint-disable-next-line resilient/prefer-safe-transformations -- The CLI owns its exit status; queued diagnostics must flush before process termination.
    if (errors || fatal || exceptions.length) process.exitCode = 1;
};
const { argv: [, , ...args] = [] } = process;

await main(args);
