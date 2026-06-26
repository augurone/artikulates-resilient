# Coding Instructions

Read [docs/CODING_STANDARDS.md](../docs/CODING_STANDARDS.md) before any code work.

**Every code change must pass `nvm use stable && npm run lint` before being presented. Fix failures yourself — never show the user lint errors.**

---

## Forbidden Patterns

**1. Optional chaining `?.`** — Use defensive destructuring with defaults.
```javascript
// ❌
const name = user?.profile?.name;

// ✅
const { profile: { name = '' } = {} } = user;
```

**2. Destructuring `||` fallback** — Give objects safe defaults upstream in the function signature.
```javascript
// ❌
const { count = 0 } = data || {};

// ✅
const process = ({ data: { count = 0 } = {} } = {}) => count;
```

**3. `.length > 0` or `.length === 0`** — Use truthy/falsy.
```javascript
// ❌  if (items.length > 0)   if (items.length === 0)
// ✅  if (items.length)       if (!items.length)
```

**4. `for` / `while` loops** — Use `map`, `reduce`, `filter`, `find`, `some`.

**5. `if-else` blocks** — Use early returns. Every branch adds cyclomatic complexity and cognitive load.

No `else`:
```javascript
// ❌
if (condition) { return a; } else { return b; }

// ✅
if (!condition) return b;
return a;
```

No `else if` chains — use early returns for each guard:
```javascript
// ❌
if (type === 'a') {
    return handleA();
} else if (type === 'b') {
    return handleB();
} else {
    return handleDefault();
}

// ✅
if (type === 'a') return handleA();
if (type === 'b') return handleB();
return handleDefault();
```

No nested `if` blocks — flatten with early returns:
```javascript
// ❌
if (user) {
    if (user.active) {
        if (user.role === 'admin') {
            return doAdminThing();
        }
    }
}

// ✅
if (!user) return;
if (!user.active) return;
if (user.role !== 'admin') return;
return doAdminThing();
```

**6. Classes** — Banned. Use function expressions.

**7. Nested ternaries** — Extract to named variables.

---

## Required Patterns

**Destructure in the function signature, not the body.**
```javascript
// ❌
const process = (data) => { const { name = '' } = data; };

// ✅
const process = ({ name = '' } = {}) => { };
```

**Default every destructuring level.**
```javascript
const { a: { b = 'default' } = {} } = obj;
```

**Use computed property destructuring for dynamic access.**
```javascript
// ❌
const value = obj[key];

// ✅
const { [key]: value } = obj;
```

**Use `Object.entries()` for object iteration.**
```javascript
// ❌
Object.keys(obj).forEach(k => { const v = obj[k]; });

// ✅
Object.entries(obj).forEach(([key, value]) => { });
```

**Return the expected type — never `null` or `undefined`.**
```javascript
// ❌  return null;   return undefined;
// ✅  return {};     return [];     return '';     return false;
```

**Check empty objects with `Object.keys().length` — not `!obj`.**

Functions return `{}` when empty, so `!obj` never triggers. Use:
```javascript
const config = getConfig(name);

// ❌ — config is {}, this never triggers
if (!config) throw new Error('missing');

// ❌ — violates truthy check rule
if (Object.keys(config).length > 0) { }

// ✅
if (!Object.keys(config).length) throw new Error('missing');
```

**Async: `Promise.all` is not always right.**

Use `Promise.all(items.map(...))` for independent concurrent work.
Use sequential `reduce` when order matters, the upstream has rate limits, or the work is stateful:
```javascript
// ✅ concurrent — items are independent
const results = await Promise.all(items.map(item => process(item)));

// ✅ sequential — order or rate limits matter
const results = await items.reduce(
    async (accPromise, item) => {
        const acc = await accPromise;
        const result = await process(item);
        return [...acc, result];
    },
    Promise.resolve([])
);
```

---

## `||` Is Only Forbidden as a Destructuring Fallback

`const { x } = obj || {}` is the **only** forbidden `||` pattern.
Everything else is valid — do not change it:

```javascript
const name = firstName || lastName;    // ✅ value selection — DO NOT CHANGE
const value = input || 0;             // ✅ const default — DO NOT CHANGE
if (a || b) { }                       // ✅ boolean logic — DO NOT CHANGE
{ prop: value1 || value2 }            // ✅ object construction — DO NOT CHANGE
const hasX = a || b;                  // ✅ boolean assignment — DO NOT CHANGE
```

**Do not convert `||` to ternary.**
```javascript
// ❌
const x = value ? value : 'default';
// ✅
const x = value || 'default';
```

When you see `||`, ask one question: is this `} = something ||`?
- **Yes** → violation, fix it
- **No** → valid, leave it alone

---

## Before Completing Any Code Change

```bash
grep -n "\?\." file.js           # must return 0 matches
grep -n "} = .* ||" file.js      # must return 0 matches
grep -n "\.length > 0" file.js   # must return 0 matches
nvm use stable && npm run lint   # must pass with 0 errors
```

- [ ] No `?.` in the file
- [ ] No `} = something ||` in the file
- [ ] No `.length > 0` or `.length === 0` in the file
- [ ] All function parameters use deep destructuring
- [ ] No `for`/`while` loops
- [ ] No `else` blocks
- [ ] `npm run lint` passes with 0 errors

If lint fails — fix it immediately. Do not present failing code to the user.

## Exceptions

Require explicit user approval and a `// EXCEPTION: reason` comment in the code.

---

## Reference

- [Full Standards](../docs/CODING_STANDARDS.md)
- [ESLint Config](../eslint.config.js)

