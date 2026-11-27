// An operation's facets are independent: a result family does not establish
// callback behavior, native dispatch, argument agreement or successful execution.
// Both analyzer directions and receiver requirements use these source contracts.
const arrayCallbacks = [
    ['map', 'array', 'map'], ['flatMap', 'array', 'flatMap'], ['filter', 'array', 'filter'],
    ['reduce', '', 'reduce'], ['reduceRight', '', 'reduce'],
    ['some', 'boolean', 'some'], ['every', 'boolean', 'every'],
    ['find', '', 'find'], ['findLast', '', 'find'], ['findIndex', 'number', 'findIndex'], ['findLastIndex', 'number', 'findIndex'],
    ['forEach', '', 'forEach'], ['sort', 'array', ''], ['toSorted', 'array', '']
];
const arrayData = [
    ['at', ''], ['concat', 'array'], ['copyWithin', 'array'], ['fill', 'array'], ['includes', 'boolean'],
    ['indexOf', 'number'], ['join', 'string'], ['keys', ''], ['lastIndexOf', 'number'], ['pop', ''], ['push', 'number'],
    ['reverse', 'array'], ['shift', ''], ['slice', 'array'], ['splice', 'array'], ['toLocaleString', 'string'],
    ['toReversed', 'array'], ['toSpliced', 'array'], ['toString', 'string'], ['unshift', 'number'], ['with', 'array']
];
const scalars = [
    ['trim', 'string', 'string'], ['toLowerCase', 'string', 'string'], ['toUpperCase', 'string', 'string'],
    ['replaceAll', 'string', 'string'], ['split', 'string', 'array'],
    ['test', 'regexp', 'boolean'], ['call', 'function', ''], ['apply', 'function', '']
];

export const operations = new Map([
    ...arrayCallbacks.map(([name = '', result = '', evaluation = ''] = []) => [name, Object.freeze({
        receiver: 'array', result, callback: true, evaluation, receiverQuestion: true,
        reverse: ['reduceRight', 'findLast', 'findLastIndex'].includes(name)
    })]),
    ...arrayData.map(([name = '', result = ''] = []) => [name, Object.freeze({ receiver: 'array', result, data: true, receiverQuestion: false })]),
    ...scalars.map(([name = '', receiver = '', result = ''] = []) => [name, Object.freeze({ receiver, result, receiverQuestion: true })])
]);
