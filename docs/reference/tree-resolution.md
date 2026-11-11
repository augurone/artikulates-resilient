# Source resolution and analysis scope

An inventory describes files that might be available. An analysis closure
describes source used by a particular request. Knowing that a file exists does
not activate its contracts or create findings for an unrelated root.

The current JavaScript path starts from the linted Program, configured extra
roots and their supported static module edges. It provides no public ProjectTree/ActiveTree, project-wide
watcher or incremental snapshot API. The [architecture guide](../engineering/architecture.md)
describes the current owned-session boundary.

## Resolution algorithm

The [module owner](../../analysis/analyzer/modules.js) performs these steps:

1. Index the supplied root Program and its lexical bindings. Acquire configured
   root snapshots in selection order, sharing filename identities.
2. Collect top-level `ImportDeclaration`, sourced `ExportNamedDeclaration` and
   `ExportAllDeclaration` edges. Bare imports also establish dependencies.
3. Ask the host's optional `resolveModule({ from, source })` for a source snapshot.
   An unavailable result supplies no dependency facts.
4. Parse available dependency text with Espree and index each resolved filename
   once in this root session. Reuse that record when another edge names it.
5. Connect supported named/default/namespace imports and explicit reexports.
   Missing exports and unresolved cyclic links supply no invented binding.
   Star namespaces retain an open boundary rather than becoming closed records.

This JavaScript closure does not follow dynamic imports or `require` calls.
The host supplies source text, not evaluated exports, inferred values or proof
that module initialization succeeds. Execution and agreement owners interpret
the acquired relationships separately.

## Filesystem resolution and configured candidates

The [ESLint module host](../../analysis/eslint/support/modules.js) owns file I/O.
It requires an absolute importing filename. A configured
`settings.resilient.resolver` function supplies the target; otherwise the host
resolves relative or absolute specifiers locally. Bare packages need a resolver.
A falsey custom result remains unavailable; it does not trigger a guessed route.

An available custom target must be an absolute filename. The host accepts `.js`
and `.jsx` extensions and tries the target, a `.js` candidate and
`index.js`. Explicit `.ts`/`.tsx` and other unsupported extensions are unavailable.
Snapshots, including unavailable results, are cached only for this analysis.

The [project adapter](../../integrations/project.js) adds configured aliases and
ordered extension candidates. Candidate order is resolution policy; it is not
a published ambiguity/provenance model. The adapter also returns ordered
ancestor/inferred-root candidates. The ESLint host activates those selected
roots together with explicit `settings.resilient.roots` configuration. An array
lists filenames; a callback receives `{ fileName }` and returns that array.
Relative entries resolve from ESLint's cwd. Duplicates share one module record.
Missing/unsupported candidates supply no fabricated evidence; other read,
configuration and parse failures propagate.

Selection does not invent framework invocation. Actual calls and module
relationships in the selected files contribute their supported evidence.
Only the linted Program supplies findings for that file; adding a root does
not copy that root's unrelated diagnostics into the result.

Direct analyzer callers can provide `roots: [{ filename, source }]` to
`createAnalysis` or `createProgramAnalysis`. A session's frozen `files` list
records the distinct acquired filenames. [Configured-root behavior](../../tests/configured-roots.test.js)
exercises real cross-file calls, inactive controls, cycles and edits.

## Parser and source ownership

`createAnalysis` parses JavaScript with Espree. `createProgramAnalysis` accepts
a valid supplied ESTree Program; ESLint passes its selected parser's actual
root tree. Dependency text is nevertheless parsed with Espree, in module mode,
with JSX syntax enabled. The custom root parser and its options are not forwarded
to dependency parsing. Accepting a root AST does not establish direct TypeScript
or TSX project support. CommonJS export inference is unsupported.

The analyzer owns the supported evidence it acquires before returning a session;
public answers do not borrow caller ASTs for later interpretation. Contract rules
share that root session during an ESLint traversal. A new Program traversal clears
the prior session even if the host reuses its SourceCode object.

## Unknown edges and failures

At the analyzer boundary, an absent `resolveModule` callback, unavailable source,
unsupported dependency extension or missing export leaves the evidence unknown.
Unknown cannot erase an
independently established contradiction or stand in for JavaScript undefined.
An unresolved/ambiguous decision is not permission to select a plausible contract.
Separate import/syntax rules can still report their own policy findings.

The filesystem host treats `ENOENT`, `ENOTDIR` and `EISDIR` as unavailable
candidates. Other I/O failures propagate. Thrown resolver errors, malformed
available snapshots and dependency parse errors are operational failures; they
do not become successful unknown or empty lint results. This distinction belongs
to the actual host contract, not a blanket rule that every missing file throws.

## Invariants

- Only the linted Program, selected roots and successfully supplied static dependencies enter this closure;
  unrelated project inventory supplies no evidence.
- Filename identity selects acquired module records. Resolution must supply the
  intended identity; equal spelling or shape cannot substitute for a provider.
- Cycles are not evidence producers. Retain grounded source contributions and
  incomplete relationships without inventing exports or successful initialization.
- File, parser, resolver or configuration changes require a new analyzer session.
  Prior immutable answers describe their prior source, not an edited project.
- Source selection belongs to the host/module boundary. Value evidence,
  completion, requirements and policy judgments belong to their semantic owners.

## Separate TypeScript compiler closure

The [TypeScript project lowerer](../engineering/typescript.md) uses its owning
Program, compiler/provider resolution and selected emit roots. It includes their
runtime dependency closure, excludes type-only runtime edges and rejects unresolved
local runtime routes before publication. That compiler path does not make the
JavaScript ESLint host TypeScript-aware. Its selected emit roots are separate
from the JavaScript analyzer's configured context roots.
