await Promise.all([
    './no-destructuring-fallback.test.js',
    './no-else.test.js',
    './no-length-comparison.test.js',
    './no-nested-if.test.js',
    './no-undefined-assignment.test.js',
    './prefer-falsey-returns.test.js',
    './prefer-prototype-methods.test.js',
    './prefer-safe-destructuring-defaults.test.js',
    './prefer-signature-destructuring.test.js'
].map(testFile => import(testFile)));
