# eslint-plugin-resilient

Resilient is an ESLint plugin for making executable JavaScript contracts
visible. Signatures, defaults, operations, control flow, return paths, and
local module relationships provide the evidence; Resilient reports known
contradictions without adding a second type or annotation language.

It provides static contract feedback during development and safety checks in
builds and CI. Unknown runtime data remains owned by the application boundary
that can validate and normalize it.

## Install

```bash
npm install --save-dev eslint eslint-plugin-resilient
```

Resilient uses ESLint flat config. Version `0.7.x` requires ESLint `10.9.1`
or later within ESLint 10 and Node.js `22.13+` or `24+`.

## Configure

Resilient is organized as opt-in layers:

- `recommended` — the core native-JavaScript discipline;
- `contracts` — value, shape, return, call-site, and local-module checks;
- `imports` — generic import-tree checks through `eslint-plugin-import-x`;
- `safety` — opt-in mutation, failure-handling, and promise-sequencing policy.

The smallest useful setup is:

```javascript
import resilient from 'eslint-plugin-resilient';

export default [
    resilient.configs.recommended,
    resilient.configs.contracts
];
```

Add the import and safety layers when the project wants those policies too:

```javascript
import resilient from 'eslint-plugin-resilient';

export default [
    resilient.configs.recommended,
    resilient.configs.contracts,
    resilient.configs.imports,
    resilient.configs.safety
];
```

### Configure project conventions

The contract graph follows ordinary relative `.js`, `.jsx`, `.mjs`, `.cjs`,
and `index.js` paths by default. For project-owned aliases or composed 
entrypoints, use one `resilient.imports({...})` configuration. It supplies 
the same project resolver to the contract graph and `import-x`:

```javascript
import resilient from 'eslint-plugin-resilient';

const project = resilient.imports({
    aliases: { '@': 'src' },
    root: 'src/app',
    entryFiles: ['page'],
    ancestorFiles: ['layout'],
    inferredFiles: ['error', 'global-error', 'loading', 'not-found', 'template', 'default']
});

export default [
    resilient.configs.recommended,
    resilient.configs.contracts,
    resilient.configs.imports,
    project
];
```

`resilient.imports({...})` configures resolution. `resilient.configs.imports`
enables the generic import diagnostics; the two serve different purposes.

The project adapter accepts:

- `cwd` — project directory; defaults to the current working directory;
- `root` — optional project-relative boundary for ancestor and inferred files;
- `aliases` — project-relative string targets, such as `{ '@': 'src' }`;
- `extensions` — extensions to try; defaults to `.js`, `.jsx`, `.mjs`, and
  `.cjs`;
- `entryFiles` — files that activate project roots; defaults to `['index']`;
- `ancestorFiles` — files such as `layout` discovered in the entry file's
  directory and its ancestors;
- `inferredFiles` — additional project-owned files such as `error` or
  `not-found` discovered alongside those entries.

If the project uses ordinary `index.js` entries and relative imports, no
project configuration is needed. Resilient does not guess framework
conventions, follow dynamic imports, or invent call edges between configured
root files. Projects with resolution rules beyond this adapter can provide a
custom resolver through the lower-level API described in the
[contracts reference](docs/reference/contracts.md#module-graph).

## See it work

The same contract evidence is available through ESLint and the inspector. This
intentionally invalid call supplies a number where the signature expects a
string:

```javascript
const render = ({
    title = ''
} = {}) => title.trim();

render({ title: 42 }); // reported by signature-contract-call-site
```

For a focused source probe, run:

```bash
npx resilient-inspect src/page.js \
    --find "items.toUpperCase" \
    --diagnostics \
    --evidence
```

The inspector is a one-shot analysis tool for examining a source location. It
does not evaluate runtime data, watch files, or replace the ESLint run.

## Runtime boundaries

The safety preset covers safe transformations, non-silent failure handling,
optional callback guards, and promise ownership. Use `Promise.all` for
independent work, sequential `await` when ordering or retries matter, and
`Promise.allSettled` when partial failure is part of the contract.

Resilient does not evaluate runtime API data, database records, configuration,
third-party implementations, dynamic properties, or unsupported effects.
Validate and normalize those values at the boundary that owns them. Unknown
values remain unknown rather than becoming guessed contracts.

## Documentation

- [Contracts reference](docs/reference/contracts.md) — analyzer API, graph
  behavior, resolver boundaries, evidence, and diagnostics.
- [Tree resolution](docs/reference/tree-resolution.md) — Project Tree and
  Active Tree behavior.
- [Dialect semantics](docs/reference/semantics.md) — the normative discipline.
- [Rule documentation](docs/rules/) — individual rule behavior and examples.
- [Guides](docs/guide/) — adoption, migration, objections, and diagnostics.
- [Roadmap](docs/engineering/roadmap.md) — shipped work and future scope.
- [Documentation index](docs/) — the complete map by audience.

## Development

```bash
npm test
npm run lint
npm run fixtures:check
npm run consumer:check
npm run release:check
```

The repository is dogfooded: `npm run lint` excludes the intentionally invalid
`tests/fixtures` directory, while `npm run fixtures:check` verifies its
machine-checkable diagnostic coverage. See [AGENTS.md](AGENTS.md) for the full
maintainer workflow.

## License

MIT
