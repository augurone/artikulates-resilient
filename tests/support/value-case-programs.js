const transfers = [
    ['alias', 'const selected=candidate;'],
    ['record', 'const {selected}={...{selected:candidate}};'],
    ['capture', 'const relay=()=>candidate;const selected=relay();']
];
const invocations = [
    ['direct', 'selected()'], ['call', 'selected.call(null)'], ['apply', 'selected.apply(null,[])'],
    ['map', '[1].map(selected).at(0)'], ['reduce', '[1].reduce(selected,0)']
];

export const identityPrograms = transfers.flatMap(([transfer = '', transport = ''] = []) => [true, false].flatMap(guarded => (
    invocations.map(([invocation = '', call = ''] = []) => ({
        name: `origins ${transfer} ${invocation} ${guarded ? 'guarded' : 'unguarded'}`,
        guarded,
        required: !guarded || transfer !== 'alias',
        source: `const use=({a,b,c}={},p=false,q=false)=>{const first=p?a:b;const candidate=q?first:c;${transport}${guarded ? 'if(typeof selected!=="function")return;' : ''}${call};};`,
        runtime: 'use({},p,q);'
    }))
)));

export const callablePrograms = transfers.flatMap(([transfer = '', transport = ''] = []) => [true, false].flatMap(conflict => (
    invocations.map(([invocation = '', call = ''] = []) => ({
        name: `callees ${transfer} ${invocation} ${conflict ? 'conflicting' : 'valid'}`,
        conflict,
        inferred: transfer !== 'capture',
        source: `const read=(p=false,q=false)=>{const a=()=>${conflict ? '42' : '"ok"'};const b=()=>"ok";const c=()=>"ok";const first=p?a:b;const candidate=q?first:c;${transport}return ${call};};`,
        runtime: 'read(p,q).trim();'
    }))
)));
