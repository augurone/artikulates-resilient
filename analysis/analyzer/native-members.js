import { receiver } from 'eslint-plugin-resilient/agreement';

export const collectionMethods = new Set(['map', 'filter', 'reduce', 'some', 'find', 'forEach']);

export const operationRequirements = new Map([
    'trim', 'toLowerCase', 'toUpperCase', 'replaceAll',
    'map', 'filter', 'reduce', 'some', 'find', 'forEach', 'test', 'call'
].map(operation => [operation, receiver({ operation })]));

export const objectPrototypeMembers = new Set([
    'constructor', '__defineGetter__', '__defineSetter__', 'hasOwnProperty', '__lookupGetter__', '__lookupSetter__',
    'isPrototypeOf', 'propertyIsEnumerable', 'toString', 'valueOf', '__proto__', 'toLocaleString'
]);

// These standard lookups can expose shared prototypes or their constructors.
// They invalidate the intrinsic premise; they never establish a result family.
export const prototypeAccessMembers = new Set(['constructor', '__proto__']);
export const reflectiveMembers = new Map([
    ['Object', new Set(['getPrototypeOf', 'getOwnPropertyDescriptor', 'getOwnPropertyDescriptors'])],
    ['Reflect', new Set(['getPrototypeOf', 'getOwnPropertyDescriptor', 'get'])]
]);
export const intrinsicFamilies = new Map([
    ['Array', 'array'], ['String', 'string'], ['Number', 'number'], ['Boolean', 'boolean'],
    ['RegExp', 'regexp'], ['Function', 'function'], ['Promise', 'promise']
]);
export const promiseFactories = new Set(['resolve', 'reject', 'all', 'allSettled', 'race', 'any']);
// Native results are established only on normal completion. Receiver-bound
// observations also depend on the call protocol; coercion and getters may fail.
export const nativeFunctions = new Map([
    ['String', 'string'], ['Number', 'number'], ['Boolean', 'boolean'],
    ['Object.entries', 'array'], ['Object.keys', 'array'], ['Object.values', 'array']
].map(([name = '', factory = ''] = []) => [name, Object.freeze({ factory })]).concat([
    ['Array.isArray', Object.freeze({ factory: 'boolean', predicate: 'array', observes: true })],
    ['Object.prototype.toString.call', Object.freeze({ factory: 'string', objectTag: true, receiverBound: true, dependencies: Object.freeze(['function']) })]
]));

export const nativeNamespaces = new Map([['Object.prototype', 'object'], ['Object.prototype.toString', 'function']]);
export const nativePaths = new Set([...nativeFunctions.keys(), ...nativeNamespaces.keys()]);
export const objectTags = new Map([
    ['Object', 'object'], ['Array', 'array'], ['Function', 'function'], ['RegExp', 'regexp']
]);

// Result contracts do not establish callback behavior or invocation success.
export const nativeResultFamily = new Map([
    ['trim', 'string'], ['toLowerCase', 'string'], ['toUpperCase', 'string'], ['replaceAll', 'string'],
    ['map', 'array'], ['filter', 'array'], ['some', 'boolean'], ['test', 'boolean']
]);
