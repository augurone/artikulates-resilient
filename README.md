# eslint-plugin-resilient

## Why Resilient?

JavaScript already expresses expectations through signatures, defaults,
operations, control flow, and return paths. Resilient checks those executable
boundaries instead of adding a second annotation system that can drift from the
code.

It catches boundary failures before runtime, giving immediate feedback during
development and enforceable safety checks in builds and CI—a caller supplying
an unusable value, a changed return shape, or a transformation that loses an
invariant—while leaving external uncertainty to the runtime boundary that owns
validation.

For the reasoning behind this approach, see [The Code Is the
Contract](https://dev.to/augurone/the-code-is-the-contract-mk1) and its
[technical model](docs/engineering/the-code-is-the-contract.md).

## What it is

Resilient provides static contract feedback during development and build/CI
safety checks for functional, flow-oriented native ECMAScript. It is an ESLint
plugin with a portable contracts API.

Adopt the layers you need:

- `recommended` — the core discipline for signatures, defaults, control flow,
  transformations, and collection operations;
- `contracts` — static findings for known value, shape, return, call-site, and
  local-module contradictions;
- `imports` — generic import-tree correctness through
  `eslint-plugin-import-x`;
- `safety` — opt-in policy for mutation, failure handling, and promise
  sequencing.

It works with plain JavaScript, React, and framework projects. It is not a
runtime validator, does not require a parallel type language, and does not own
framework conventions or application import policy. Unknown values remain
unknown.

## Integrate

Install the plugin:

```bash
npm install --save-dev eslint eslint-plugin-resilient
```

Resilient uses ESLint flat config. The 0.7.x line requires ESLint 10.9.1 or
later within ESLint 10 and supports Node.js 22.13+ or 24+.

| Release line | ESLint | Node.js |
| --- | --- | --- |
| 0.6.2 | 9.x | 18.x |
| 0.7.0+ | 10.9.1–10.x | 22.13+ or 24+ |

Configure ESLint with the layers you need. The smallest useful setup is:

```javascript
import resilient from 'eslint-plugin-resilient';

export default [
    resilient.configs.recommended,
    resilient.configs.contracts
];
```

For project-owned aliases and composed entrypoints, add one Resilient project
configuration. It supplies the same resolver to the contract graph and
`import-x`; no second import resolver configuration is needed:

```javascript
import resilient from 'eslint-plugin-resilient';

const project = resilient.imports({
    aliases: { '@': 'src' },
    root: 'src/app',
    extensions: ['.js', '.jsx', '.mjs', '.cjs'],
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

`resilient.imports({...})` configures resolution; `resilient.configs.imports`
enables the generic import rules. Add `resilient.configs.safety` when the
project wants mutation, failure-handling, and promise-sequencing policy too.

The project adapter accepts these settings:

- `cwd` — project directory; defaults to the current working directory;
- `root` — optional project-relative boundary for ancestor and inferred files;
- `aliases` — project-relative string targets, such as `{ '@': 'src' }`;
- `extensions` — extensions to try; defaults to `.js`, `.jsx`, `.mjs`, and
  `.cjs`;
- `entryFiles` — files that activate project roots; defaults to `['index']`;
- `ancestorFiles` — files such as `layout` that are discovered in the entry
  file's directory and its ancestors;
- `inferredFiles` — additional project-owned files such as `error` or
  `not-found` discovered alongside those entries.

The adapter resolves relative imports and configured aliases. It also tries
the configured extensions and `index.js`. Ordinary package resolution remains
the import resolver's fallback. Resilient does not know or guess a framework's
conventions, does not follow dynamic imports, and does not invent call edges
between configured root files.

For a project that needs resolution beyond this simple configuration, provide
the resolver directly through ESLint settings. It must return an absolute file
path or an empty string when the source is outside the project's resolver:

```javascript
import resilient from 'eslint-plugin-resilient';

export default [{
    settings: {
        resilient: {
            resolver: ({ source = '', from = '' } = {}) => (
                source === '@app/pages' ? '/project/src/pages.js' : ''
            ),
            roots: ({ fileName = '' } = {}) => (
                fileName.endsWith('/page.js') ? ['/project/src/app/layout.js'] : []
            )
        }
    }
}, resilient.configs.contracts];
```

Start with `recommended`; add `contracts`, `imports`, or `safety` as opt-in
layers. The core preset enforces explicit native-JavaScript boundaries. The
other presets add contract, import-tree, and safety checks respectively.

### Integration hooks

- [ESLint presets](docs/reference/contracts.md#eslint-presets) — configure the
  core, contract, import, and safety layers.
- [Project Tree API](docs/reference/contracts.md#public-api) — supply parsed
  programs and selected analysis roots.
- [Module graph](docs/reference/contracts.md#module-graph) — follow local
  imports and named re-export barrels.
- [Resolver and framework roots](docs/reference/contracts.md#module-graph) —
  connect aliases, composed roots, and project-specific resolution.
- [Diagnostics and evidence](docs/guide/diagnostic-explanations.md) — explain
  findings in the editor, CI, or a focused inspector run.

For a focused source probe:

```javascript
const render = ({
    title = ''
} = {}) => title.trim();

render({ title: 42 }); // reported by signature-contract-call-site
```

```bash
npx resilient-inspect src/page.js --find "items.toUpperCase" --diagnostics --evidence
```

## Safety and runtime boundaries

The safety preset covers safe transformations, non-silent failure handling,
optional callback guards, and promise ownership. Use `Promise.all` for
independent work, sequential `await` when ordering or retries matter, and
`Promise.allSettled` when partial failure is part of the contract.

Resilient does not evaluate runtime API data, database records, configuration,
third-party implementations, dynamic properties, or unsupported effects.
Validate and normalize those values at the boundary that owns them. See the
[safety rules](docs/rules/) and [dialect semantics](docs/reference/semantics.md)
for the precise behavior and supported exceptions.

## Deeper documentation

- [Guides](docs/guide/) — adoption, migration, objections, and diagnostics.
- [Rule documentation](docs/rules/) — individual rule behavior and examples.
- [Contracts reference](docs/reference/contracts.md) — API, evidence,
  diagnostics, project trees, and analysis limits.
- [Dialect semantics](docs/reference/semantics.md) — the normative discipline.
- [Tree resolution](docs/reference/tree-resolution.md) — indexed versus active
  files and dependency activation.
- [Technical rationale](docs/engineering/the-code-is-the-contract.md) and
  [readable essay](docs/blogs/blog-the-code-is-the-contract.md) — why the code
  remains the contract.
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
maintainer and verification workflow.

## License

MIT
