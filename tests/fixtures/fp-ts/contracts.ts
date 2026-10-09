// Generated-only contract checks, separate from the unchanged upstream oracle.
import manifest from '../helpers.json';

const modules = import.meta.glob('../src/*.ts', { eager: true });
const models = [
    { _tag: 'None' }, { _tag: 'Some', value: 0 },
    { _tag: 'Left', left: '' }, { _tag: 'Right', right: false },
    { _tag: 'Both', left: '', right: 0 },
    { equals: (a: unknown, b: unknown) => a === b, compare: () => 0 },
    { show: () => '' }, { empty: 0 }
];
const contractInputs: Record<string, any> = {
    Some: { _tag: 'Some', value: 0 },
    Left: { _tag: 'Left', left: '' },
    Right: { _tag: 'Right', right: false },
    Both: { _tag: 'Both', left: '', right: 0 },
    Show: { show: () => '' },
    Monoid: { empty: 0 },
    Ord: { equals: (a: unknown, b: unknown) => a === b, compare: () => 0 }
};

manifest.forEach(({ file, helpers }) => {
    const api: any = modules[`../src/${file}`];
    helpers.forEach(({ name, resolver, falsifies }) => {
        it(`generated ${file}:${name} preserves its runtime boundary`, () => {
            const fn = api[name];
            expect(typeof fn).toBe('function');
            if (!resolver) {
                const contractInput = contractInputs[name];
                const empty = fn();
                expect(Object.getPrototypeOf(empty)).toBe(Object.prototype);
                [undefined, null, false, 0, '', [], /a/, new Date(0)].forEach((input) => {
                    expect(fn(input)).toEqual(empty);
                });
                const marker = {};
                const supplied = Object.freeze({ ...empty, extra: marker });
                const result = fn(supplied);
                expect(result).not.toBe(supplied);
                if (falsifies) {
                    expect(result).toEqual(empty);
                    expect('extra' in result).toBe(false);
                } else {
                    expect(result).toEqual(supplied);
                    expect(result.extra).toBe(marker);
                }
                const suppliedModel = contractInput || models[0];
                expect(fn(Object.freeze(suppliedModel))).toMatchObject(suppliedModel);
                return;
            }
            [undefined, null, false, 0, NaN, [], '', 'text', () => 3, {}, ...models].forEach(input => {
                const result = fn(input);
                expect(['any', 'string', 'function', 'object']).toContain(result.kind);
                if (result.kind === 'any') {
                    expect(result.value).toBe(input);
                    return;
                }
                if (result.kind === 'object') {
                    expect(Object.prototype.toString.call(result.value)).toBe('[object Object]');
                    expect(result.value).toMatchObject(input === undefined ? {} : input);
                    return;
                }
                expect(typeof result.value).toBe(result.kind);
                expect(result.value).toBe(input);
            });
            expect(fn(false)).toEqual({ kind: 'any', value: false });
        });
    });
});

it('string/RegExp resolution respects the native constructor boundary', () => {
    const { resolveStringRegExp }: any = modules['../src/string.ts'];
    const pattern = /a/g;
    expect(resolveStringRegExp(pattern)).toEqual({ kind: 'object', value: pattern });
    expect(resolveStringRegExp({})).toEqual({ kind: 'any', value: {} });
    expect(resolveStringRegExp('a')).toEqual({ kind: 'string', value: 'a' });
});

it('generated defaults cover absent object properties and alternate callable forms', () => {
    const Tr: any = modules['../src/Tree.ts'];
    const H: any = modules['../src/These.ts'];
    const RS: any = modules['../src/ReadonlySet.ts'];
    const STSet: any = modules['../src/Set.ts'];
    const Fn: any = modules['../src/function.ts'];
    const show = Tr.getShow({ show: String });
    expect(show.show({ value: 'root' })).toBe('make(root)');

    const eq = Tr.getEq({ equals: (a: any, b: any) => a === b });
    expect(eq.equals({ value: 1 }, { value: 1 })).toBe(true);
    expect(Tr.reduce(0, (b: number, a: number) => b + a)({ value: 2 })).toBe(2);
    expect(Tr.reduceRight(0, (a: number, b: number) => a + b)({ value: 2 })).toBe(2);
    expect(Tr.traverse(modules['../src/Option.ts'].Applicative)((value: number) => modules['../src/Option.ts'].some(value))({ value: 2 })).toEqual(
        modules['../src/Option.ts'].some({ value: 2, forest: [] })
    );
    expect(Tr.drawTree({ value: 'root' })).toBe('root');

    expect(H.matchW(() => 'left', () => 'right', () => 'both')({})).toBeUndefined();

    const equality = { equals: (a: any, b: any) => a === b };
    expect(RS.separate(equality, equality)(new Set([{}]))).toEqual({
        left: new Set(),
        right: new Set()
    });
    expect(STSet.separate(equality, equality)(new Set([{}]))).toEqual({
        left: new Set(),
        right: new Set()
    });

    const dataLast = Fn.dual((args: any[]) => args.length > 0, (value: any) => value);
    expect(dataLast(2)).toBe(2);
});
