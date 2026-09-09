import assert from 'node:assert/strict';

import {
    FUNCTION_TYPES,
    isFunction,
    isFunctionNode
} from '../rules/support/function.js';

assert.equal(isFunctionNode({ type: 'FunctionDeclaration' }), true);
assert.equal(isFunctionNode({ type: 'FunctionExpression' }), true);
assert.equal(isFunctionNode({ type: 'ArrowFunctionExpression' }), true);
assert.equal(isFunctionNode({ type: 'VariableDeclarator' }), false);
assert.equal(isFunctionNode(), false);
assert.equal(isFunction(() => {}), true);
assert.equal(isFunction({}), false);
assert.equal(FUNCTION_TYPES.has('ClassDeclaration'), false);
