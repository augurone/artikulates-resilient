# The Oakland Manual of Style: Tooling Grammar and Analysis in Native ECMA

## Spec and Scan: Leveraging underutilized tooling in native ECMAScript

[Artikulates Resilient GitHub repository](https://github.com/augurone/artikulates-resilient)

[Artikulates Resilient npm package](https://www.npmjs.com/package/eslint-plugin-resilient)

---

ESLint is usually introduced as a linter. That description is correct, but incomplete in a way that matters.

A linter run begins by parsing source. Before a rule decides whether a line violates a policy, the text has become a structured representation of the program: functions have parameters and bodies; identifiers have positions and bindings; calls have callees and arguments; returns belong to functions; comments and tokens retain their relationship to the source. A rule is not looking for a phrase in a file. It is visiting parts of a parsed program.

That is the relevant fact for Resilient. The project needs to inspect native ECMAScript, retain evidence about the forms it finds, follow that evidence through the relationships the source exposes, and report a disagreement at the place a developer can act on it. AST tooling and ESLint already provide much of the infrastructure for that job.

## Source is more than text

Take a small function:

```javascript
const readTitle = ({ title = '' } = {}) => title.trim();
```

The source is compact, but a parser does not see one opaque line. In ESTree-shaped terms, it sees a variable declaration whose initializer is an arrow function. Its parameter is an object pattern. The outer parameter has a default object. The `title` property has a default string. The body is a call expression on a member expression: `title.trim()`.

```text
VariableDeclarator
  ArrowFunctionExpression
    AssignmentPattern
      ObjectPattern
        Property: title
          AssignmentPattern: ''
    CallExpression
      MemberExpression: title.trim
```

This is a record of the code's actual syntax. It preserves facts that a text scanner would have to guess at: where the defaults sit, which value receives `trim`, and which function owns the return.

That is enough to make a useful local query:

```javascript
readTitle({ title: 42 });
```

The AST makes the signature, operation, and call available to the analyzer as connected source facts. Native defaults handle `undefined`, not `null`: `readTitle({ title: null })` still reaches `null.trim()` and throws at runtime. If this boundary intends to accept `null`, it needs an explicit guard or other runtime behavior. The AST does not establish runtime facts about an external system; it is a stable index of what the program says, and the analysis decides which conclusions that evidence supports.

## What ESLint actually supplies

The [ESLint custom-rules guide](https://eslint.org/docs/latest/extend/custom-rules) describes the working interface. A custom rule exports a `create(context)` function and returns visitors for AST node types or selectors. ESLint invokes those visitors during traversal. The rule receives a `SourceCode` object for text, comments, tokens, and parser information; it can inspect scope and receive code-path events; and it uses `context.report()` to publish a finding at a node or location.

This is why ESLint is more useful to the project than a generic text scanner.

It already knows how to give a rule the parsed file, where the source construct sits, which lexical binding an identifier resolves to, and how to put a diagnostic in an editor, a command-line report, or continuous integration. It also has established mechanisms for configurations, rule metadata, suggestions, fixes, and local configuration comments.

Those capabilities matter in concrete ways:

- A rule can distinguish a callback parameter from an unrelated local variable with the same spelling.
- It can report the invocation of an optional callback, rather than merely find the word `onComplete`.
- It can see whether a return belongs to a particular function body.
- It can point a finding at the argument, operation, or return that supplies the most useful explanation.
- It can use a normal `eslint-disable` directive for a narrow, reviewable departure from policy.

None of those is a full semantic model. Together they are a mature rule runtime and diagnostic channel for one.

## Where a rule runs out of road

An individual rule callback sees a parsed file at a particular point in traversal. ESLint walks that file's AST depth-first, but that traversal is not a dependency-aware project-analysis schedule. It is enough for many local policies. It is not, on its own, enough to retain a contract from its definition through every supported alias, factory, object property, callback, and local module edge.

```javascript
const makeReader = () => (title = '') => title.trim();
const api = { read: makeReader() };

api.read(42);
```

The useful report belongs at `api.read(42)`: a known number is being passed to a function that eventually invokes `trim`. Yet the evidence begins in the returned function and moves through a factory and an object property before the call occurs.

This is where the project stops being “a collection of clever lint rules.” A visitor has the traversal context of its current file and node, not a correctness-preserving order over a project graph. The analyzer needs a separate evidence model that can retain what a signature, default, operation, return, or object member establishes, then answer a later query about supported project relationships. ESLint can request and display that answer; it should not rediscover the entire path independently in every rule.

That division of work is deliberate:

```text
parser and AST     → structural facts
analysis layer     → retained evidence and supported conclusions
ESLint rule        → diagnostic and policy at the source location
```

The separation also makes limits explicit. A local import that resolves can participate in analysis. An unresolvable computed access remains unknown. A project can reject an unnecessarily obscure form as policy without claiming that the form has no JavaScript meaning.

## A tooling lineage

This is familiar territory in JavaScript tooling.

[Ariya Hidayat's introduction to JavaScript syntax trees](https://ariya.io/2012/04/javascript-syntax-tree-visualization-with-esprima/) remains a good demonstration of why parsers are useful for more than compilation: tree structure resolves syntactic ambiguities that text alone leaves unclear. Esprima and the [ESTree specification](https://github.com/estree/estree) helped make a shared vocabulary for tools that parse and consume JavaScript.

[Nicholas C. Zakas's introduction to ESLint](https://humanwhocodes.com/blog/2013/07/16/introducing-eslint/) makes the next step explicit. ESLint was designed around pluggable rules inspecting the AST, so a project could define rules that fit its own code rather than wait for a central linter to anticipate every concern.

The [Babel Plugin Handbook](https://github.com/jamiebuilds/babel-handbook/blob/master/translations/en/plugin-handbook.md#asts) describes the same basic machinery from a compiler-tooling perspective. Its value here is not that Babel must be the implementation. It gives a clear account of AST nodes, traversal, paths, and scope: the distinctions a reader needs before thinking about how analysis visits a program.

TAJS is the deeper research lineage. In [*Type Analysis for JavaScript*](https://www.cs.au.dk/~amoeller/papers/tajs/paper.pdf), Simon Holm Jensen, Anders Møller, and Peter Thiemann describe a broad static analysis for JavaScript. Their problem statement reads like a catalogue of why JavaScript analysis cannot be casual: prototype objects, mutable string-keyed properties, computed property names, coercion, wrapped primitives, variable arity, first-class functions, dynamic evaluation, and the difference between a missing property and a property whose value is `undefined`.

TAJS and Resilient share a starting conviction: JavaScript's own forms and semantics are serious material for analysis. They make different engineering choices. TAJS faces the general language as it is found. Resilient controls an application-owned surface by asking authors to use a recognizable grammar where the project needs durable evidence.

## Why grammar matters to the analyzer

“Grammar” does not mean replacing ECMAScript grammar. It means choosing recurring, valid forms whose jobs the analyzer can recognize and connect. A boundary, a default, a guard, an operation, a return, and a resolvable local edge each contribute a distinct source fact. Together, they make supported evidence composable instead of asking the analyzer to reconstruct intent from every legal but idiosyncratic form.

That is the practical purpose of the restriction. It gives people and tools a shared set of recognizable signals, makes policy departures explicit, and preserves unknown when the source cannot support a conclusion.

The Oakland Manual is an account of the machinery behind that work: parsers that preserve program structure, an analyzer that retains supported evidence, and ESLint rules that bring conclusions to the developer.

## Further reading

1. [ESLint: Custom Rules](https://eslint.org/docs/latest/extend/custom-rules) — The direct reference for custom-rule visitors, source access, scopes, code paths, reports, suggestions, and fixes.

2. [Ariya Hidayat: JavaScript Syntax Tree Visualization with Esprima](https://ariya.io/2012/04/javascript-syntax-tree-visualization-with-esprima/) — A friendly demonstration of why parse trees help reveal what JavaScript syntax means.

3. [Nicholas C. Zakas: Introducing ESLint](https://humanwhocodes.com/blog/2013/07/16/introducing-eslint/) — The original AST-and-pluggability rationale for ESLint.

4. [Babel Plugin Handbook: ASTs](https://github.com/jamiebuilds/babel-handbook/blob/master/translations/en/plugin-handbook.md#asts) — Practical material on AST nodes, parsing, traversal, paths, and scopes.

5. [ESTree specification](https://github.com/estree/estree) — The shared AST vocabulary used by much of the JavaScript tooling ecosystem.

6. [ECMAScript: Destructuring Binding Patterns](https://tc39.es/ecma262/#sec-destructuring-binding-patterns) — The normative specification for destructuring binding patterns and their default initializers.

7. [MDN: Destructuring assignment—default values](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Destructuring#default_value) — A practical companion to the specification, including the runtime behavior of defaults.

8. [TAJS: Type Analysis for JavaScript](https://www.cs.au.dk/~amoeller/papers/tajs/paper.pdf) — An advanced treatment of broad static analysis for JavaScript.
