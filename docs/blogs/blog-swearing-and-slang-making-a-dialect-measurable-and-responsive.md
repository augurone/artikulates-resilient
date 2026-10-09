# Swearing and Slang: Making a Dialect Measurable and Responsive

## How to Break the Rules Without Breaking Agreement

---

[Artikulates Resilient GitHub repository](https://github.com/augurone/artikulates-resilient)

[Artikulates Resilient npm package](https://www.npmjs.com/package/eslint-plugin-resilient)

---

The first question people ask when they begin learning a language is often some version of: “How do you swear?”

It is not quite a frivolous question. A swear can be intimate, funny, defiant, or emphatic; its force depends partly on a shared sense of ordinary speech. Slang shows a different movement: a marked form can become familiar through repeated use. Both reveal where a language draws its boundaries and how those boundaries change.

Resilient faces both questions.

As a dialect of JavaScript it uses familiar forms to make agreements visible: a signature establishes a boundary, a default gives absence a meaning, an operation makes a demand, and a return carries a result forward. Those forms make ordinary code easier to inspect. But ordinary code is not every program.

Third-party utilities and libraries can require a promise chain to preserve their delivery and rejection behavior. A loop may preserve an order of effects that a transformation would hide. An external API may treat omission as meaningful: an absent argument differs from `{}`, and an absent callback differs from a supplied no-op function.

The question is not whether the rule should win anyway. It is how the program can say, clearly and locally, that this is one of the places where the ordinary form is not the right one.

> A useful exception is not a hole in the grammar. It is a visible claim about a boundary the grammar does not fully describe.

## A marked form still has meaning

Consider the usual preference for `async` and `await`. In most application code, the sequential form makes both the result and the failure path easier to read:

```js
const getName = async () => {
    const { name = '' } = await fetchUser();

    return name;
};
```

That preference is not a claim that `.then()` is invalid JavaScript. Here, `stream` is a library-owned chunk pipeline whose chain is part of its delivery and failure protocol. Rewriting it to satisfy a style preference can change timing, receiver behavior, returned values, or rejection ownership.

```js
// eslint-disable-next-line resilient/prefer-async-await -- Required by the stream adapter; it owns chunk delivery and rejection flow.
stream.then(handleChunk).catch(reportError);
```

The directive says three useful things. It names the rule being relaxed. It limits the departure to the statement that needs it. And it records the behavior the author believes the alternative preserves.

ESLint already provides this [directive syntax](https://eslint.org/docs/latest/use/configure/rules). That matters because a dialect should not ask developers to learn a second permission language when the existing tool already names the rule, locates the scope, and carries a reason.

The reason is a claim, not a proof. “Needed here” tells a reviewer nothing. “Required by the stream adapter” gives the reviewer a boundary to inspect. Tests and runtime behavior still decide whether the claim holds.

## A narrow exception stays narrow

Marked language depends on limits. A swear may fit a particular moment; it does not follow that every form of speech is acceptable. Resilient's exceptions have the same hard edge: each must name every rule it relaxes, give a concrete reason, and cover only the code that needs the departure.

In the Resilient dialect, `// eslint-disable-next-line` by itself is invalid, as is `/* eslint-disable */`. A named block disable must be closed and may cover exactly one syntactic statement or declaration. File-wide disables, configuration-wide suppressions, and other ways of switching off scrutiny globally are forbidden. They erase the context that makes an exception intelligible and can hide violations in code written later.

Even a valid directive settles only the questions it names. Keeping a loop because iteration order is observable says nothing about whether mutation inside it is safe. Keeping a library-owned promise chain says nothing about whether its rejection is handled. Every other rule still gets to inspect the code.

## The grammar needs to hear disagreement

Not every difficult case needs a directive. The rule may already accept the form, or a clearer signature, guard, transformation, or boundary model may express the contract directly. A recurring legitimate form belongs in the rule’s accepted grammar; a specific boundary that those forms cannot express warrants a local, reasoned exception.

That makes exceptions useful evidence. Once each directive identifies its rules, scope, and reason, a codebase can ask better questions:

- Which rules receive the most departures?
- Are they concentrated at a particular kind of boundary?
- How much code does each departure cover?
- Do the same reasons recur in unrelated places?
- Does a reason remain true after its surrounding code changes?

Resilient also audits exceptions in its own source. It checks rule names, reasons, permitted directive forms, and syntactic scope, then inventories departures by rule. That gives review a catalog to begin with. It does not establish that each reason is true, or count the lint findings a directive actually suppressed. Even a large inventory may be justified if each entry marks a distinct contract; the count alone cannot decide that.

A project using Resilient can measure its own code with `resilient-measure`. The command runs under that project's ESLint configuration and reports active lint findings, findings ESLint suppressed, and directive sites separately. A directive is not counted as if it were one finding; it may suppress several, or none. Comparing those observations as a project changes can show where a rule repeatedly meets a boundary and deserves another look.

Imagine one next-line directive naming `no-console` and `no-undef` above a legacy diagnostic that prints a host-provided value absent from the project's ESLint configuration. It is one site and can suppress two findings. Once the diagnostic is rewritten, a forgotten directive is still one site but suppresses none; ESLint may also report it as an active unused-directive finding. The separate counts reveal whether the exception still does any work.

Here the distinction between swearing and slang matters. A local exception gets its meaning from one context. A repeated departure may expose a form the dialect has no way to express. The counts cannot decide whether that form is legitimate; they point maintainers to the code and contracts they need to examine.

## Tolerance remains accountable

An exception is a claim about one boundary, not a verdict on the code around it. Review must still ask whether the stated contract is real and whether the implementation preserves it. A reason that fails those tests cannot justify the directive; one that holds only for this boundary stays local.

When the same justified departure recurs across unrelated sites, the rule itself needs review. Resilient should compare those cases, identify their shared contract, and admit a new form only if it can recognize that contract without excusing other failures. Otherwise, the departures remain local. A dialect can learn from its slang without mistaking every swear for a new rule.

## The Resilient series

Read the series on [DEV](https://dev.to/augurone):

- [The Code Is the Contract](https://dev.to/augurone/the-code-is-the-contract-mk1)
- [Software as an “Agreement Engine”](https://dev.to/augurone/software-as-an-agreement-engine-3b6a)
- [The Fallacy of the “Unknown Cliff”](https://dev.to/augurone/the-fallacy-of-the-unknown-cliff-in-modern-web-applications-40il)
- [Let’s Define Undefined](https://dev.to/augurone/lets-define-undefined-3ej)
- [Style Is Grammar: Making Agreement Visible in Native ECMAScript](https://dev.to/augurone/style-is-grammar-4m49)
