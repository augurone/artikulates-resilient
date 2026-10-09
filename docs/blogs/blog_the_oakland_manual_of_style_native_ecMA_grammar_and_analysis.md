# The Oakland Manual of Style: What ESLint Already Knows About Your Code

## Spec and Scan: ASTs, Scope, and the Machinery Behind Agreement in Native ECMAScript

---

>*The earlier essays ask what executable code can say about agreement, absence, responsibility, and the unknown. [Style Is Grammar](https://dev.to/augurone/style-is-grammar-4m49) brings those ideas together as a dialect of native ECMAScript. This essay asks how tools read those forms, beginning with machinery many of us already use without giving it much thought.*

----

Most of us encounter ESLint as an interruption.

A line is underlined. A message appears. A commit or build stops until we answer it. We learn the rules that matter to our project, change the offending code, and get back to work. The machinery becomes familiar enough to disappear.

But consider what we have come to expect from that interruption. A tool can point to a particular argument, distinguish one variable from another with the same name, or tell us that a return path leaves something unfinished. It can do this while the program is sitting still in an editor.

We accept that feedback routinely. We spend less time asking what the tool had to understand before it could offer it.

ESLint is usually introduced as a linter. That description is correct. It leaves a useful part of the story unexplained: the source has already become something a tool can inspect structurally before most rules begin their work. Parsing, traversal, scope analysis, and source locations provide much of the machinery we need to ask better questions of ordinary JavaScript.

That machinery deserves attention in its own right. It also gives the Resilient argument a practical footing. If the code carries an agreement, there has to be a way to read it.

## The source becomes structure

Take the small boundary that has appeared throughout this series:

```javascript
const readTitle = ({ title = '' } = {}) => title.trim();
```

A person reads a function that receives an object, gives an absent title an empty-string meaning, and returns the trimmed result. A parser records the syntax that makes that reading possible.

The initializer is an arrow function. Its parameter is an assignment pattern: an object binding pattern on the left and a default object on the right. Inside that pattern, the `title` property has another default. The expression body is a call whose callee is the member expression `title.trim`.

A simplified view of the abstract syntax tree, or AST, looks like this:

```text
VariableDeclarator: readTitle
└── initializer: ArrowFunctionExpression
    ├── parameter: AssignmentPattern
    │   ├── binding: ObjectPattern
    │   │   └── property: title
    │   │       └── AssignmentPattern
    │   │           ├── binding: title
    │   │           └── default: ''
    │   └── default: {}
    └── expression body: CallExpression
        └── callee: MemberExpression
            ├── receiver: title
            └── property: trim
```

The tree preserves relationships that a search for words does not. The two defaults occupy different boundaries. The call belongs to this function's expression body. `title` is the receiver of the member access. Changing indentation or splitting the line does not change those relationships.

[Ariya Hidayat's introduction to syntax-tree visualization with Esprima](https://ariya.io/2012/04/javascript-syntax-tree-visualization-with-esprima/) is a useful demonstration of this change in perspective. Source becomes a tree whose organization reflects the language's syntax. The [ESTree specification](https://github.com/estree/estree) provides a shared vocabulary for many JavaScript tools that consume that structure.

This is why parsing is useful beyond compilation. Once a program has structure, a tool can ask where a construct occurs and what surrounds it. A call inside a string is different from a call expression. A default on a property is different from a fallback in a function body. A return from a nested callback belongs to that callback.

Those are syntactic facts. They make later questions possible without answering all of them.

## A name is not a binding

An AST identifies the occurrences of a name. Another part of the machinery establishes which declaration an occurrence refers to.

```javascript
const title = '';
const count = (title = 0) => title + 1;
```

The spelling is the same. The bindings are different. Inside `count`, the parameter owns the name `title`; the outer declaration does not supply the operand.

That distinction matters whenever a rule follows a value. Searching for `title` cannot tell us which agreement a use belongs to. Scope analysis gives tools the lexical relationships needed to distinguish the declarations and their references.

ESLint's JavaScript infrastructure makes scope information available alongside the parsed source. A rule can work with the AST and those bindings rather than treat every matching name as the same value. It also has access to source text, tokens, comments, and locations. These are related views of the file, each useful for a different question.

The distinction between them is worth keeping. The parser records syntax. Scope analysis connects lexical references. A semantic analyzer decides what evidence those forms and relationships support. Calling all of this “the AST” makes the tool sound more magical than it is and hides the work each layer performs.

## A rule visits the program

[Nicholas C. Zakas's introduction to ESLint](https://humanwhocodes.com/blog/2013/07/16/introducing-eslint/) describes the founding choice: pluggable rules that inspect the AST. A project could define its own checks instead of waiting for a central linter to anticipate every concern.

The [current custom-rules guide](https://eslint.org/docs/latest/extend/custom-rules) describes the working interface. A rule's `create(context)` method returns visitors for node types, selectors, or code-path events. ESLint invokes those handlers as it traverses the parsed file. Through `SourceCode`, a rule can inspect text, tokens, comments, and scope. Through `context.report()`, it can attach a finding to a node or source location.

A visitor is simply a function called when the traversal reaches something the rule wants to inspect. A rule interested in calls can visit call expressions. A rule interested in returns can inspect return statements and their enclosing functions. Code-path events provide additional information about paths through the function.

Some rules care about tokens and layout. Others care about bindings, control flow, or particular operations. The common infrastructure lets them meet the developer through the same diagnostic channel.

That is a considerable amount of work already done. The rule does not have to invent a parser, locate every construct by hand, or build a new editor integration before it can explain a problem. Configurations select the policy. Rule metadata identifies it. Reports give it a location. Suggestions and fixes can offer a repair where the rule supports one.

The [Babel Plugin Handbook](https://github.com/jamiebuilds/babel-handbook/blob/master/translations/en/plugin-handbook.md#asts) describes related machinery from a transformation perspective: nodes, traversal, paths, and scope. Babel and ESLint have different jobs, but they make the same underlying idea familiar. Tools can work with the structure of a program rather than repeatedly rediscover it in text.

The important question is then what a particular rule is justified in concluding from that structure.

## A tree is the beginning of analysis

Return to `readTitle` and add a call:

```javascript
readTitle({ title: 42 });
```

The parser supplies the function, its default, its operation, and the number literal in the argument. Scope connects the call to the local function. To report a disagreement, an analyzer still has to interpret those facts: what agreement does the signature express, what does the operation demand, and what does the caller supply?

JavaScript itself does not enforce a string requirement because a parameter has a string default. Defaults apply when the supplied value is `undefined`. They do not validate arbitrary input. With `{ title: null }`, the default is skipped and the function attempts `null.trim()`. The [ECMAScript binding-initialization rules](https://tc39.es/ecma262/multipage/ecmascript-language-statements-and-declarations.html#sec-destructuring-binding-patterns) establish the mechanics; a project's analyzer and dialect establish how those mechanics serve as contract evidence.

The gap between structure and conclusion grows when the value travels:

```javascript
const makeReader = () => (title = '') => title.trim();
const api = { read: makeReader() };

api.read(42);
```

Every expression is available in the parsed file. But the useful finding requires more than recognizing each expression separately. The returned function carries a signature. The factory call produces that function. The object exposes it as `read`. The final call supplies a number.

ESLint's traversal tells a visitor when it has reached a node. It does not, by itself, retain that entire chain as a callable agreement or resolve the dependencies needed to answer a later question about it. A rule can invoke additional analysis, accumulate facts, or inspect the complete program. Those are analysis decisions built on the infrastructure, rather than consequences of having a visitor alone.

The same distinction applies across files. An import declaration has a syntax tree. Resolving its local provider and carrying a returned contract into the consumer requires a model of the module relationship.

## How Resilient uses the machinery

Resilient gives recurring native forms contractual jobs. A signature establishes a boundary. A default gives absence an executable meaning. An operation makes a demand. A guard establishes a condition within its scope. A return offers an agreement to the next participant.

That is the grammar developed in the earlier essays. AST tooling makes those forms addressable. Analysis gives the evidence somewhere to live and a way to travel.

In the current implementation, Resilient reports the first example through `resilient/signature-contract-call-site`:

```text
title expects string-like, but this call supplies number-like (static evidence: default at line 1).
```

It also follows the returned function through the factory and object property in the second example and reports the numeric argument at `api.read(42)`. These are supported local relationships in the analyzer, not hypothetical abilities supplied by the parser.

The contract layer retains signatures, inferred value families, selected shapes, return evidence, and supported local module relationships. ESLint rules consume its results and publish findings. Other adapters can query the same model; the agreement is not created by the message that happens to display it.

```text
parser and AST       → source structure
binding analysis     → lexical relationships
contract analyzer    → retained evidence and supported conclusions
ESLint rule          → policy and findings at useful source locations
```

There is a tooling lineage behind this division. Hidayat's syntax-tree demonstration shows how structure makes source facts visible. Zakas's rule model makes AST inspection pluggable; the Babel handbook explains traversal, paths, and scope. Each step helps a tool move from source text toward a finding it can locate and explain.

Static-analysis research asks how far those conclusions can go. In [*Type Analysis for JavaScript*](https://cs.au.dk/~amoeller/papers/tajs/paper.pdf), Simon Holm Jensen, Anders Møller, and Peter Thiemann describe TAJS, an abstract-interpretation approach to JavaScript analysis. Mutable properties, prototypes, computed names, coercion, first-class functions, and dynamic evaluation complicate what a tool can establish. TAJS addresses the broader language; Resilient analyzes a bounded dialect in application-owned code. Both take JavaScript semantics seriously, but the research reference does not give Resilient TAJS's coverage or guarantees.

This division preserves the argument of [The Code Is the Contract](https://dev.to/augurone/the-code-is-the-contract-mk1). Executable facts do not need a second authored description before tooling can inspect them. An internal evidence model organizes what the tool derives from source; it does not ask the developer to maintain a competing account of the same boundary.

It also preserves the distinction developed in [Let's Define Undefined](https://dev.to/augurone/lets-define-undefined-3ej). The empty-string default remains a string when absence is the case this boundary handles. Its consumer may decide that empty content is insufficient, but that decision does not change the producer's value family. An absent callback has a different problem: no callable value has been established, and a no-op function would claim that an implementation exists. A rule needs to recognize that difference before it can recommend a safe form.

The dialect makes these decisions recognizable. Grammar identifies the form; semantics describes its contractual meaning; policy decides whether it is permitted at this boundary. An analyzer may understand a mutation while a preset rejects it. A parser may recognize optional chaining without the project choosing it as an accepted expression. Understanding a form and permitting it are separate responsibilities.

## Where the evidence stops

The same machinery gives Resilient a way to be precise about uncertainty.

```javascript
readTitle({ title: externalValue });
```

If the source does not establish `externalValue`, the call-site analyzer does not report it as a known number, a known string, or a known contradiction. The function still expresses an agreement. The actual supplied value remains unknown to that analysis.

This is the boundary described in [The Fallacy of the “Unknown Cliff”](https://dev.to/augurone/the-fallacy-of-the-unknown-cliff-in-modern-web-applications-40il). The AST does not inspect a live payload. A default does not validate it. The receiving boundary owns the runtime behavior needed to establish the agreement the application will use next. Uncertainty about that value does not erase surrounding source facts or switch off other safety obligations.

A resolved local import can participate in analysis. A dynamic access the analyzer cannot resolve remains unknown. A framework or library contract may require a form outside the ordinary dialect. The tool must preserve that boundary rather than rewrite behavior merely to make the source look familiar.

ESLint already supplies a way to mark a local departure: a directive naming a rule, its scope, and a reason. As *Swearing and Slang* argues, the reason is a claim about behavior that still needs review. A suppression changes which findings are displayed; it does not validate data or establish a missing agreement. Resilient's exception discipline and measurement build on those existing mechanisms while keeping findings, suppressed findings, and directive sites distinct.

The tooling must follow evidence far enough to report a supported disagreement and stop where the source cannot support a conclusion.

That is the machinery behind an underlined line: parsing locates the form, scope connects its names, analysis tests the agreement, and an ESLint rule applies policy at the source. A useful diagnostic can show which source facts justify its claim.

## The Code

[Artikulates Resilient GitHub repository](https://github.com/augurone/artikulates-resilient)

[Artikulates Resilient npm package](https://www.npmjs.com/package/eslint-plugin-resilient)

## Further reading

1. [ESLint: Custom Rules](https://eslint.org/docs/latest/extend/custom-rules) — Visitors, source access, scope, code paths, reports, suggestions, and fixes.

2. [Ariya Hidayat: JavaScript Syntax Tree Visualization with Esprima](https://ariya.io/2012/04/javascript-syntax-tree-visualization-with-esprima/) — A visual introduction to parsed JavaScript structure.

3. [Nicholas C. Zakas: Introducing ESLint](https://humanwhocodes.com/blog/2013/07/16/introducing-eslint/) — The original rationale for AST inspection and pluggable rules.

4. [Babel Plugin Handbook: ASTs](https://github.com/jamiebuilds/babel-handbook/blob/master/translations/en/plugin-handbook.md#asts) — Nodes, traversal, paths, and scope in transformation tooling.

5. [TAJS: Type Analysis for JavaScript](https://cs.au.dk/~amoeller/papers/tajs/paper.pdf) — Research on broader static analysis using JavaScript's own semantics.

6. [Resilient: Contract Analysis](https://github.com/augurone/artikulates-resilient/blob/main/docs/reference/contracts.md) — The implemented evidence model, public API, supported relationships, and explicit boundaries.
