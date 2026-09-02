# Tree resolution and analysis strategy

This document defines how Resilient chooses source for analysis. It separates
the project-wide source index from the analysis context so that knowing about a
file does not make that file semantically active.

## The two trees

### Project Tree

The Project Tree is the project-level inventory and relationship index. It may
contain every known source file, including files that are unused by the current
analysis request.

It owns project topology and lifecycle information:

- file identity and source version;
- parser and project configuration identity;
- forward module edges;
- reverse dependent edges;
- resolver outcomes and resolution errors;
- which files are available to activate.

The Project Tree does not infer value contracts and does not automatically make
every indexed file part of an analysis.

### Active Tree

The Active Tree is the semantic context for one analysis request. It is the
transitive closure of the selected roots through statically discoverable and
successfully resolved dependency edges.

```text
Project Tree
  ├── unused.js                 indexed, inactive
  ├── test-helper.js             indexed, inactive
  └── page.js                    active root
       └── provider.js           active dependency
            └── model.js         active dependency
```

Only Active Tree programs are supplied to the contract graph and analyzer.
Unused Project Tree entries cannot produce diagnostics merely because they are
present in the project.

## Resolution algorithm

For an analysis rooted at one or more files:

1. Add the roots to the active set.
2. Provide each active file's parsed program from the selected parser and
   project options.
3. Collect statically represented module sources from imports and local export
   edges, including re-export barrels.
4. Resolve each source using the project resolver.
5. If resolution produces a concrete file, add it to the active queue unless it
   has already been visited.
6. If resolution fails, record an unknown edge and leave the dependency out of
   the active semantic set.
7. Repeat until the active queue is empty.
8. Resolve local export and re-export contracts to a stable point, then run
   diagnostics on the resulting Active Tree documents.

The analyzer follows only edges represented by supported static syntax. A
dynamic import, external package, unsupported module form, or resolver failure
does not become a guessed contract. It remains unknown unless a caller supplies
an appropriate resolver or evidence adapter.

The compatibility adapter performs this process on demand from an ESLint root
file. Its default resolver supports local relative `.js`, `.jsx`, and
`index.js` paths. The contract graph then propagates signatures, returns,
properties, and re-export agreements across the loaded active files. See
[`contracts.md`](contracts.md) for the current implementation boundary.

For ESLint consumers, activation is automatic and lazy: the first contract
rule invocation activates the internal Project Tree for the current root and
its supported local dependency closure. Later contract rules reuse that graph
within the same run. Consumers enable the contracts preset; they do not call a
project-activation API.

## Project Tree strategy for 0.5.0

The Project Tree is an index around Active Tree resolution, not an eager request
to analyze the whole repository.

The current caller-supplied implementation provides:

1. **Indexing** — accept known project files and configuration identity without
   activating every file.
2. **Resolution** — turn a module edge into a concrete file, an explicit
   unknown edge, or a resolution agreement that tooling can inspect.
3. **Activation** — construct the Active Tree from explicit roots and supported
   dependency edges.
4. **Invalidation** — when a file, resolver, parser option, or relevant config
   changes, identify the active roots and dependents that need recomputation.
5. **Reuse** — retain parsed programs and completed analysis snapshots while
   their source and project identities remain unchanged.

Project Tree indexing may be broad; Active Tree activation must remain narrow.
This allows a project session to know that `unused.js` exists, while keeping its
contracts and diagnostics outside an analysis rooted at `page.js`.

## Ownership boundaries

| Concern | Owner |
| --- | --- |
| File inventory and source versions | Project Tree |
| Module resolution and dependency edges | Project Tree / resolver |
| Root selection and dependency closure | Active Tree |
| Value, shape, flow, and failure contracts | Resilient analyzer |
| Contradiction diagnostics | Resilient analyzer |
| Developer presentation | ESLint and later adapters |

The tree may decide which programs are available to the analyzer. It must not
decide whether a value is string-like, array-like, unknown, or contradictory.
Those meanings remain in the contract model and flow analysis.

## Invariants

The implementation and tests should preserve these invariants:

- an unused indexed file cannot emit a diagnostic for an unrelated active root;
- every active dependency is reachable from a selected root through recorded
  edges;
- unresolved or unsupported edges remain unknown rather than becoming guessed
  contracts;
- changing an active provider invalidates its affected consumers;
- changing an unrelated inactive file does not change an active analysis result;
- the same project snapshot, resolver, parser options, and roots produce the
  same Active Tree and diagnostic result;
- ESLint consumes the analyzer's result and does not create a second semantic
  interpretation.

## Implemented versus deliberately out of scope

The 0.4.3 compatibility path already has the core of Active Tree resolution:
on-demand loading of local relative dependencies, named/default imports,
namespace imports, re-export barrels, finite cycles, cache reuse, and
dependency file-state invalidation.

The 0.5.0 release implemented the caller-supplied project substrate:

- `createProjectTree` indexes parsed programs, source states, static edges, and
  resolver outcomes;
- `activate()` returns the explicit Active Tree and leaves unused files
  inactive;
- `getInvalidatedFiles()` reports dependent and identity-driven invalidation;
- `analyze({ previousSnapshot })` reuses unchanged documents outside the
  invalidation closure and clean-run equivalence is tested;
- ESLint consumes the same contract graph exposed by the snapshot API.

Filesystem-wide discovery, parser-backed loading, package/workspace aliases,
dynamic imports, and editor or language-server adapters remain deliberately
outside this release boundary.

An LSP, editor extension, or standalone CLI can consume this API later. They are
adapters; they are not prerequisites for the analysis product.
