# Style Is Grammar: Making Agreement Visible in Native ECMAScript

## How Resilient Becomes a Dialect of JavaScript

---

[Artikulates Resilient GitHub repository](https://github.com/augurone/artikulates-resilient)

[Artikulates Resilient npm package](https://www.npmjs.com/package/eslint-plugin-resilient)

>*Four earlier essays establish the pieces of Resilient: executable contracts in [**The Code Is the Contract**](https://dev.to/augurone/the-code-is-the-contract-mk1), agreement in [**Software as an “Agreement Engine”**](https://dev.to/augurone/software-as-an-agreement-engine-3b6a), unknown boundaries in [**The Fallacy of the “Unknown Cliff”**](https://dev.to/augurone/the-fallacy-of-the-unknown-cliff-in-modern-web-applications-40il), and absence in [**Let’s Define Undefined**](https://dev.to/augurone/lets-define-undefined-3ej). This essay brings them together and asks a more practical question: Crockford argued for a deliberately limited subset of ECMAScript. Is a restricted set of expressions enough to make a dialect?*

---

“Style” is one of the least useful words in software because we use it for two very different things.

Sometimes style means presentation. It means the choices that make a file pleasant to scan and make a team’s code look like it belongs together: indentation, quotation marks, line length, import order, braces. Those choices matter. A codebase is a place people have to live in, and visual consistency makes that place calmer.

But sometimes “style” means a restriction on what a program is allowed to say.

Consider an optional callback:

```javascript
const notify = ({ onComplete } = {}) => onComplete();
```

Nothing about the spacing of that line changes its meaning. The interesting question is whether `onComplete` may be absent, and if it may be absent, who decides whether it is safe to call. The answer is currently hidden in an assumption. A project can choose to make the decision visible instead:

```javascript
const notify = ({ onComplete } = {}) => {
    if (typeof onComplete !== 'function') return;

    onComplete();
};
```

That is not merely a visual preference. It is a choice about behavior, control flow, and responsibility. The function receiving the optional callback owns the decision to invoke it. The guard tells a reader what happens when the callback was not supplied, and it gives a tool a form it can recognize.

That kind of style has a better name: grammar.

JavaScript already has a grammar in the language-specification sense. Resilient works with ordinary ECMAScript and chooses a more disciplined use of some familiar forms: destructured signatures, defaults, guards, returned transformations, and visible promise ownership.

Individually, these are familiar JavaScript forms. Together, they form a dialect: a shared way of using the language so that the agreements in a program remain legible.

## What’s a Dialect, and Where Is Resilient Best Understood?

A dialect is a recognizable variety of a shared language. Its vocabulary carries recurring local meanings, and its grammar gives those forms a dependable order. Speakers of the parent language can still read it; fluent speakers recognize what its forms are doing without each use needing to be explained again.

Resilient is a dialect of JavaScript. It is not new syntax or a private code. It is native ECMAScript whose familiar forms have recurring contractual jobs: destructured signatures, explicit defaults, guards, returned transformations, owned promises, and local module boundaries. Its grammar is the order those forms establish: boundary, absence, operation, return, responsibility.

Resilient is clearest in functional, application-owned JavaScript: code that receives values, establishes an agreement, carries it through an operation, transforms or returns a result, and owns the visible consequences.

It travels well through environments that keep native ECMAScript source structure and runtime behavior legible. It does not require every platform lifecycle, framework callback, dynamic dispatch, third-party API, or external payload to behave like local application code. Those are real boundaries. Preserve their actual contract, use a narrow exception when a policy would change it, and leave what source cannot establish unknown.

Resilient clarifies the code it owns and respects the contracts it does not.

## The Grammar of Agreement

Grammar can sound more formal than it needs to be. Here it means forms that express an agreement clearly enough for people to read and tools to inspect.

Take a small boundary:

```javascript
const readTitle = ({ title = '' } = {}) => title.trim();
```

One ordinary line carries a great deal. The outer default establishes an object-shaped boundary. The `title` default gives absence an empty-string meaning. `trim()` requires string-like behavior. The return carries that result forward. This is the practical claim of [The Code Is the Contract](https://dev.to/augurone/the-code-is-the-contract-mk1): signature, operation, and return are not documentation beside the agreement. They are the agreement in executable form.

The line does not validate arbitrary input. Passing `{ title: 42 }` is still a contradiction between a known number and a string operation. Receiving a payload from the network is still an unknown boundary until the application establishes something more. And its default does not claim that an empty string and `undefined` are the same thing. The default establishes a usable string when absence is the condition this boundary chose to handle; `undefined` remains the fact that no contractual value was supplied or produced. But for the absence it has chosen to handle, the function is not vague. It has said what it will do.

That matters to composition. A falsifiable default preserves the established value family through an absence the boundary chose to handle. The next operation still receives a string, an array, or an object-shaped agreement rather than a newly widened set of possibilities. The empty form may need its own content test—`[]` and `{}` are truthy—but it has not ceased to belong to its family.

Treat every legal form as equally expressive and meaning becomes distributed across convention, comments, defensive checks, and memory. A dialect asks the form to carry the decision where it is made.

The Resilient Dialect separates three questions that are often blurred together. Grammar asks which JavaScript form is being used: a binding pattern, default, operation, function, return, transformation, async boundary, or module relationship. Semantics asks what that form means as contract evidence. Policy asks whether the project permits that form at this boundary, and what a legitimate exception looks like. The same line of JavaScript can answer all three questions without acquiring a second language around it.

Those are three descriptions of the same program, not three languages stacked on top of one another.

```text
grammar   → which form is being used
semantics → what that form says about an agreement
policy    → whether this project permits that form here
```

This is why a class, optional chaining, a nested `if`, or a mutation may be perfectly valid ECMAScript and still be rejected by a Resilient preset. The parser understands those forms. JavaScript permits them. That is not the argument. The question is whether the project has chosen them as clear enough carriers for a particular agreement. Rejection is a policy decision, not a claim that the syntax is somehow outside the language.

## The Algebra of Agreement

Crockford’s restricted subset is a useful starting instinct, but restriction alone is not enough to make a dialect. A collection of forbidden forms is still only a collection of rules. Resilient has a stronger claim: an agreement has a usable algebra.

```text
C(T) = ⟨T⁺, D(T)⟩
D(T) ⊨ T
O(D(T)) = O(T)
∀ p ∈ P(f), return(p) ⊨ T
```

`C(T)` is the contract for an agreement `T`: a positive form and its falsifiable default. `D(T)` is not an escape from the agreement. It still satisfies `T`, and it retains the operations that `T` makes available. The final expression says that every normal return path of `f` must honor the contract it offers.

That is what makes composition more than a metaphor. One form establishes an agreement. The next consumes it. A transformation preserves it or a known operation contradicts it. A return offers it again. The algebra gives those relationships names and obligations.

```javascript
const normalizeTitle = ({ title = '' } = {}) => title.trim();
const decorateTitle = (title = '') => `Article: ${title}`;

const heading = decorateTitle(normalizeTitle({ title: '  Grammar  ' }));
```

The first boundary establishes `D(string) = ''` for absence in its own scope. `trim()` consumes an operation available to the string agreement. The second boundary receives a string-like result and produces a new string. Nothing here requires a parallel description. The code gives the analyzer a chain of evidence to follow.

```text
signature → default → operation → return → next use
```

The same chain can make a contradiction precise before the program runs:

```javascript
const normalizeTitle = (title = '') => title.trim();

const titleParts = ['Grammar'];
normalizeTitle(titleParts);
```

The signature establishes a string agreement for `title`; `titleParts` is locally established as an array. The call brings those two facts together at one source location. No runtime value needs to be guessed, and no general claim about every array is required. The disagreement is simply visible in the program’s own grammar.

The chain can have several honest outcomes. It does not need one story for every value.

- A known agreement can be preserved. An array returned from one function can be mapped by its caller; a string can be trimmed and passed to another string operation.
- A known contradiction can be reported. If a locally known array reaches `.trim()`, the disagreement has a specific source location.
- An unknown can remain unknown. A value from an external system has not become string-like merely because a reader hopes that it is.

This is the practical form of the [Agreement Engine](https://dev.to/augurone/software-as-an-agreement-engine-3b6a). Agreement is not a label attached to a value once and for all. It is a relationship that is established, preserved, consumed, transformed, or contradicted as code composes.

The analyzer is deliberately modest about this. It follows scoped source agreements, not global value meanings. A producer owns the contract it offers at its boundary. A consumer owns the interpretation it needs in its own scope. If that consumer returns a value, it becomes a producer again. The agreement keeps moving, but responsibility does not become diffuse.

## Responsibilities the Grammar Makes Visible

These choices are grammar not because they look tidy, but because each makes a different responsibility visible.

A destructured signature says what part of an application-owned object a function consumes:

```javascript
const renderArticle = ({ title = '', tags = [] } = {}) => ({
    title: title.trim(),
    tags: tags.map(tag => tag.trim())
});
```

The signature is not a runtime validator. It says this local agreement concerns `title` and `tags`; external validation still belongs at the boundary that receives external data. Its return produces a new article-shaped value instead of quietly changing a consumer-owned one. Mutation is not rejected because it is ugly or invalid JavaScript. It is a policy concern because shared mutation can change a value behind a boundary held by another reader. A returned transformation leaves evidence of the new agreement in source; mutation makes that evidence depend on aliasing and execution order. Where mutation is necessary, the boundary that owns that shared state should make it explicit.

Optional behavior needs an owner as well:

```javascript
const notify = ({ onComplete } = {}) => {
    if (typeof onComplete !== 'function') return;

    onComplete();
};
```

The rule is not afraid of calls. It requires the scope that invokes an optional capability to own the condition under which it invokes it. The guard is the decision in source: this boundary accepts an absent callback; it does not attempt a call unless a callable capability was supplied.

Failure needs an owner as well. Returning a promise moves that ownership to the caller. Awaiting exposes fulfillment or rejection in the current scope. Catching handles or translates it. Those are different contracts, even when they sit beside the same asynchronous work.

```javascript
const saveArticle = async ({ article = {} } = {}) => {
    try {
        const response = await save(article);

        return await response.json();
    } catch (error) {
        return handleError(error);
    }
};
```

This is not a universal recipe. It makes one thing plain: this scope owns the failure path, and `handleError` must return an agreement the caller can use. A bare promise chain leaves the same question unanswered: who answers when it rejects?

In each case, the restriction is worthwhile only if it can name the invariant it protects. “Use a guard” is not enough. The invariant is that a scope owns the decision to perform optional behavior. “Return transformations” is not enough. The invariant is that a new value and the boundary of mutation remain visible. “Handle promises” is not enough. The invariant is that failure has an owner.

Without that invariant, a rule is probably just preference wearing a safety costume.

## How a tool reads the language

A person sees a parameter, default, operation, and return. A tool sees the same choices as an abstract syntax tree, or AST. The tree does not make an uncertain thing certain; it gives stable structure to what the author made visible:

```javascript
const readTitle = ({ title = '' } = {}) => title.trim();
```

```text
function
├── parameter: object pattern
│   └── property: title
│       └── default: ''
└── return
    └── call: title.trim()
```

That structure is enough for an analyzer to make limited, honest observations. It can see that the default addresses absence, not arbitrary values. It can see that `trim()` needs a string-like receiver. It can recognize a known local call that supplies a number and report the contradiction at that call or operation. It can follow evidence through resolvable returns, aliases, object properties, and local module relationships.

It cannot inspect a live API response just because the response eventually flows into the same tree. It cannot infer a runtime guarantee from a comment or wish a dynamic property into a known one. This is the boundary developed in [The Fallacy of the “Unknown Cliff”](https://dev.to/augurone/the-fallacy-of-the-unknown-cliff-in-modern-web-applications-40il): static evidence is valuable precisely because it does not counterfeit the evidence it lacks.

ESLint is where many developers meet this work, but it is not the source of the meaning. Resilient’s contract analysis exposes queryable evidence separately from any one lint message, while ESLint remains a central enforcement surface in the current package. It turns a known contradiction or a policy breach into a familiar, line-level diagnostic. The grammar comes first; analysis follows what the source proves; ESLint delivers that discipline where developers already work.

```text
grammar           → the chosen forms of the dialect
contract analyzer → the evidence those forms provide
ESLint            → one place to report a policy breach or contradiction
```

This order matters. A selector is easy to write compared with a rule that knows what it is protecting. Before adding a rule, a project should be able to say:

1. What invariant does this rule preserve?
2. What source evidence establishes or contradicts that invariant?
3. Which boundary owns the decision?
4. What remains unknown at runtime?
5. Which exceptions preserve legitimate behavior rather than merely silence a warning?

The policy documentation is explicit that an exception relaxes a named barrier at a specific boundary; it does not validate data, make a contradiction disappear, or establish a general precedent. That is the right level of discipline for a dialect. Rules need limits, just as contracts do.

## Resilient, Defined

Resilient is not trying to make dynamic JavaScript completely knowable, and it is not asking developers to maintain a parallel account of facts the code already expresses. It is choosing a way to use JavaScript where the agreements that matter are easier to see.

```text
shared ECMAScript
        ↓
vocabulary  → familiar forms take recurring contractual jobs
        ↓
grammar     → those forms compose into an agreement
        ↓
semantics   → the agreement says what is known, required, produced, or owned
        ↓
policy      → the project permits forms that preserve that meaning here
        ↓
expression  → the agreement becomes recognizable in use
        ↓
native-ECMAScript-friendly territory
```

Vocabulary gives Resilient its familiar words. Grammar gives those words order. Semantics gives the order consequence. Policy makes a local choice about which forms keep that consequence legible. Expression makes the choice recognizable: boundaries are named, absence has a declared meaning, conditional behavior has an owner, transformations show what is new, and failure has somewhere to go.

The dialect is deliberately bounded. Where source establishes an agreement, analysis can follow it. Where source establishes a contradiction, tooling can report it. Where evidence ends, the value remains unknown. Outside its natural territory, Resilient does not counterfeit fluency. It preserves the real boundary, admits a narrow exception when necessary, and leaves unrelated obligations active.

That is Resilient: not a new runtime, parser, set of keywords, or private code, but a shared dialect of application-owned native ECMAScript. It makes agreements visible, carries them forward, and names the place where knowledge stops.

> A dialect is not a new language. It is a shared way of making the language already in use tell the truth clearly enough to be checked—and of knowing when not to pretend it is being spoken.
