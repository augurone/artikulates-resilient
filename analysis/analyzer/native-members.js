import { receiver } from 'eslint-plugin-resilient/agreement';

import { operations } from '../operations.js';

export const collectionMethods = new Set([...operations].filter(([, { evaluation = '' } = {}] = []) => evaluation).map(([name = ''] = []) => name));
// Native non-callback array operations. Receiver lookup and returned element
// transport remain separate contracts.
export const arrayDataMethods = new Set([...operations].filter(([, { data = false } = {}] = []) => data).map(([name = ''] = []) => name));

export const operationRequirements = new Map([...operations].filter(([, { receiverQuestion = false } = {}] = []) => receiverQuestion)
    .map(([operation = ''] = []) => [operation, receiver({ operation })]));

// Native data properties produce values without invoking a method.
export const nativePropertyFamily = ({ name = '', families = [], incomplete = false } = {}) => (
    name === 'length' && !incomplete && families.length && families.every(family => family === 'array' || family === 'string') ? 'number' : ''
);

export const objectPrototypeMembers = new Set([
    'constructor', '__defineGetter__', '__defineSetter__', 'hasOwnProperty', '__lookupGetter__', '__lookupSetter__',
    'isPrototypeOf', 'propertyIsEnumerable', 'toString', 'valueOf', '__proto__', 'toLocaleString'
]);

export const promiseFactories = new Set(['resolve', 'reject', 'all', 'allSettled', 'race', 'any']);
export const nativeFunctionNamespaces = new Set(['Array', 'String', 'Number', 'Boolean', 'Symbol', 'BigInt', 'Object', 'Function', 'RegExp', 'Promise', 'Date']);
// Native results are established only on normal completion. Receiver-bound
// observations also depend on the call protocol; coercion and getters may fail.
export const nativeFunctions = new Map([
    ['String', 'string'], ['Number', 'number'],
    ['Array.from', 'array'], ['Object.fromEntries', 'object'], ['Number.parseInt', 'number'], ['Date.now', 'number'],
    ['Math.abs', 'number'],
    ['Math.acos', 'number'],
    ['Math.acosh', 'number'],
    ['Math.asin', 'number'],
    ['Math.asinh', 'number'],
    ['Math.atan', 'number'],
    ['Math.atanh', 'number'],
    ['Math.atan2', 'number'],
    ['Math.ceil', 'number'],
    ['Math.cbrt', 'number'],
    ['Math.expm1', 'number'],
    ['Math.clz32', 'number'],
    ['Math.cos', 'number'],
    ['Math.cosh', 'number'],
    ['Math.exp', 'number'],
    ['Math.floor', 'number'],
    ['Math.fround', 'number'],
    ['Math.hypot', 'number'],
    ['Math.imul', 'number'],
    ['Math.log', 'number'],
    ['Math.log1p', 'number'],
    ['Math.log2', 'number'],
    ['Math.log10', 'number'],
    ['Math.max', 'number'],
    ['Math.min', 'number'],
    ['Math.pow', 'number'],
    ['Math.random', 'number'],
    ['Math.round', 'number'],
    ['Math.sign', 'number'],
    ['Math.sin', 'number'],
    ['Math.sinh', 'number'],
    ['Math.sqrt', 'number'],
    ['Math.tan', 'number'],
    ['Math.tanh', 'number'],
    ['Math.trunc', 'number'],
    ['Object.entries', 'array'], ['Object.keys', 'array'], ['Object.values', 'array'],
    ['Object.getOwnPropertyNames', 'array'], ['Object.getOwnPropertySymbols', 'array'],
    ['Object.hasOwn', 'boolean'], ['Object.isExtensible', 'boolean'], ['Object.isFrozen', 'boolean'], ['Object.isSealed', 'boolean'],
    ['Reflect.ownKeys', 'array'], ['Reflect.has', 'boolean'], ['Reflect.isExtensible', 'boolean'],
    ['Reflect.defineProperty', 'boolean'], ['Reflect.deleteProperty', 'boolean'], ['Reflect.preventExtensions', 'boolean'],
    ['Reflect.set', 'boolean'], ['Reflect.setPrototypeOf', 'boolean']
].map(([name = '', factory = ''] = []) => [name, Object.freeze({ factory })]).concat([
    // ToBoolean runs no user code: the result is true exactly when its input is truthy.
    ['Boolean', Object.freeze({ factory: 'boolean', truthOf: true })],
    ['JSON.stringify', Object.freeze({ stringify: true })],
    ['Array.isArray', Object.freeze({ factory: 'boolean', predicate: 'array', observes: true })],
    ['Object.prototype.toString.call', Object.freeze({ factory: 'string', objectTag: true, receiverBound: true })]
]));

export const nativeNamespaces = new Map([
    ['Math', 'object'], ['JSON', 'object'], ['Reflect', 'object'],
    ['Object.prototype', 'object'], ['Object.prototype.toString', 'function']
]);
export const nativePaths = new Set([...nativeFunctions.keys(), ...nativeNamespaces.keys()]);
export const objectTags = new Map([
    ['Object', 'object'], ['Array', 'array'], ['Function', 'function'], ['RegExp', 'regexp']
]);

// Result contracts do not establish callback behavior or invocation success.
export const nativeResultFamily = new Map([...operations].filter(([, { result = '' } = {}] = []) => result)
    .map(([name = '', { result = '' } = {}] = []) => [name, result]));
