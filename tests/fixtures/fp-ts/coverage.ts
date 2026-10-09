// External-library behavioral corpus. Copied unchanged into both runtime mirrors.
// These are test inputs, not naming-based transformer special cases.
import * as fc from 'fast-check';
import * as A from '../src/Array';
import * as RA from '../src/ReadonlyArray';
import * as NEA from '../src/NonEmptyArray';
import * as RNEA from '../src/ReadonlyNonEmptyArray';
import * as RR from '../src/ReadonlyRecord';
import * as R from '../src/Record';
import * as I from '../src/Identity';
import * as O from '../src/Option';
import * as E from '../src/Either';
import * as H from '../src/These';
import * as N from '../src/number';
import * as S from '../src/string';
import * as Tu from '../src/Tuple';
import * as RTu from '../src/ReadonlyTuple';
import * as Tr from '../src/Tree';
import * as WT from '../src/WriterT';
import * as ST from '../src/StateT';
import * as RT from '../src/ReaderT';
import * as ET from '../src/EitherT';
import * as HT from '../src/TheseT';
import * as IO from '../src/IO';
import * as T from '../src/Task';
import * as Reader from '../src/Reader';
import * as FIO from '../src/FromIO';
import * as FT from '../src/FromTask';
import * as FR from '../src/FromReader';
import * as FE from '../src/FromEither';

const twice = (n: number) => n * 2;
const sum = (a: number, b: number) => a + b;
const positive = (n: number) => n > 0;
const optional = (n: number) => positive(n) ? O.some(n) : O.none;
const either = (n: number) => positive(n) ? E.right(n) : E.left(n);

describe('additional fp-ts behavioral coverage', () => {
    [
        ['Array', A, A.array], ['ReadonlyArray', RA, RA.readonlyArray],
        ['NonEmptyArray', NEA, NEA.nonEmptyArray], ['ReadonlyNonEmptyArray', RNEA, RNEA.readonlyNonEmptyArray]
    ].forEach(([name, api, instance]: any) => {
        it(`${name}: legacy dictionaries agree with the pipeable API`, () => {
            const xs = [-1, 2, 3];
            expect(instance.map(xs, twice)).toEqual([-2, 4, 6]);
            expect(instance.mapWithIndex(xs, sum)).toEqual([-1, 3, 5]);
            expect(instance.ap([twice], xs)).toEqual([-2, 4, 6]);
            expect(instance.reduce(xs, 0, sum)).toBe(4);
            expect(instance.reduceRight(xs, 0, sum)).toBe(4);
            expect(instance.foldMap(N.MonoidSum)(xs, twice)).toBe(8);
            expect(instance.reduceWithIndex(xs, 0, (i, b, a) => i + b + a)).toBe(7);
            expect(instance.reduceRightWithIndex(xs, 0, (i, a, b) => i + a + b)).toBe(7);
            expect(instance.foldMapWithIndex(N.MonoidSum)(xs, sum)).toBe(7);
            expect(instance.traverse(O.Applicative)(xs, O.some)).toEqual(O.some(xs));
            expect(instance.traverseWithIndex(O.Applicative)(xs, (i, a) => O.some(i + a))).toEqual(O.some([-1, 3, 5]));
            expect(instance.extend(xs, a => a.length)).toEqual([3, 2, 1]);
            expect(instance.alt(xs, () => [4])).toEqual([-1, 2, 3, 4]);
            if (!instance.filter) return;
            expect(instance.filter(xs, positive)).toEqual([2, 3]);
            expect(instance.filterMap(xs, optional)).toEqual([2, 3]);
            expect(instance.partition(xs, positive)).toEqual({ left: [-1], right: [2, 3] });
            expect(instance.partitionMap(xs, either)).toEqual({ left: [-1], right: [2, 3] });
            expect(instance.filterWithIndex(xs, (i, a) => i + a > 0)).toEqual([2, 3]);
            expect(instance.filterMapWithIndex(xs, (i, a) => optional(i + a))).toEqual([3, 5]);
            expect(instance.partitionWithIndex(xs, (i, a) => i + a > 0)).toEqual({ left: [-1], right: [2, 3] });
            expect(instance.partitionMapWithIndex(xs, (i, a) => either(i + a))).toEqual({ left: [-1], right: [3, 5] });
        });
        it(`${name}: seeded map/chain algebra and curried concat`, () => {
            fc.assert(fc.property(fc.array(fc.integer({ min: -100, max: 100 }), { minLength: 1, maxLength: 30 }), xs => {
                expect(api.map(twice)(xs)).toEqual(xs.map(twice));
                expect(api.chain(n => [n, -n])(xs)).toEqual(xs.flatMap(n => [n, -n]));
                expect(api.concat([7])(xs)).toEqual([...xs, 7]);
            }), { seed: 20260907, numRuns: 250 });
        });
    });

    [['Record', R.record], ['ReadonlyRecord', RR.readonlyRecord]].forEach(([name, instance]: any) => {
        it(`${name}: indexed/foldable/filterable dictionary calls`, () => {
            const xs = { a: -1, b: 2 };
            expect(instance.mapWithIndex(xs, (k, a) => k + a)).toEqual({ a: 'a-1', b: 'b2' });
            expect(instance.reduce(xs, 0, sum)).toBe(1);
            expect(instance.reduceRight(xs, 0, sum)).toBe(1);
            expect(instance.foldMap(N.MonoidSum)(xs, twice)).toBe(2);
            expect(instance.reduceWithIndex(xs, '', (k, b, a) => b + k + a)).toBe('a-1b2');
            expect(instance.reduceRightWithIndex(xs, '', (k, a, b) => b + k + a)).toBe('b2a-1');
            expect(instance.foldMapWithIndex(S.Monoid)(xs, (k, a) => k + a)).toBe('a-1b2');
            expect(instance.filter(xs, positive)).toEqual({ b: 2 });
            expect(instance.filterMap(xs, optional)).toEqual({ b: 2 });
            expect(instance.partition(xs, positive)).toEqual({ left: { a: -1 }, right: { b: 2 } });
            expect(instance.partitionMap(xs, either)).toEqual({ left: { a: -1 }, right: { b: 2 } });
            expect(instance.filterWithIndex(xs, (k, a) => k === 'b' && a > 0)).toEqual({ b: 2 });
            expect(instance.filterMapWithIndex(xs, (k, a) => optional(a))).toEqual({ b: 2 });
            expect(instance.partitionWithIndex(xs, (k, a) => a > 0)).toEqual({ left: { a: -1 }, right: { b: 2 } });
            expect(instance.partitionMapWithIndex(xs, (k, a) => either(a))).toEqual({ left: { a: -1 }, right: { b: 2 } });
            expect(instance.traverse(O.Applicative)(xs, O.some)).toEqual(O.some(xs));
            expect(instance.traverseWithIndex(O.Applicative)(xs, (k, a) => O.some(k + a))).toEqual(O.some({ a: 'a-1', b: 'b2' }));
        });
    });

    [
        ['Identity', I.identity, (a: any) => a], ['Option', O.option, O.some],
        ['Either', E.either, E.right], ['These', H.these, H.right],
        ['Tuple', Tu.tuple, (a: any) => [a, 'log']], ['ReadonlyTuple', RTu.readonlyTuple, (a: any) => [a, 'log']],
        ['Tree', Tr.tree, Tr.of]
    ].forEach(([name, instance, wrap]: any) => {
        it(`${name}: foldable/traversable dictionary calls`, () => {
            const value = wrap(2);
            expect(instance.map(value, twice)).toEqual(wrap(4));
            expect(instance.reduce(value, 1, sum)).toBe(3);
            expect(instance.reduceRight(value, 1, sum)).toBe(3);
            expect(instance.foldMap(N.MonoidSum)(value, twice)).toBe(4);
            expect(instance.traverse(O.Applicative)(value, a => O.some(twice(a)))).toEqual(O.some(wrap(4)));
            if (instance.alt) expect(instance.alt(value, () => wrap(3))).toEqual(value);
            if (instance.extend) expect(instance.extend(value, () => 5)).toEqual(wrap(5));
            if (instance.bimap) expect(instance.bimap(value, s => s + '!', twice)).toEqual(name.includes('Tuple') ? [4, 'log!'] : wrap(4));
            if (instance.mapLeft) expect(instance.mapLeft(value, x => x)).toEqual(value);
        });
    });
    it('Tuple composition retains source and destination', () => {
        expect(Tu.tuple.compose([3, 2], [2, 1])).toEqual([3, 1]);
        expect(RTu.readonlyTuple.compose([3, 2], [2, 1])).toEqual([3, 1]);
    });

    it('WriterT: lazy execution, logs, mapping, application and chaining', () => {
        const W = WT.getWriterM(I.Monad);
        const calls: string[] = [];
        const fa = () => { calls.push('run'); return [2, 'a'] as const; };
        const mapped = W.map(fa, twice);
        expect(calls).toEqual([]);
        expect(mapped()).toEqual([4, 'a']);
        expect(calls).toEqual(['run']);
        expect(W.evalWriter(fa)).toBe(2);
        expect(W.execWriter(fa)).toBe('a');
        expect(W.tell('x')()).toEqual([undefined, 'x']);
        expect(W.listen(fa)()).toEqual([[2, 'a'], 'a']);
        expect(W.pass(() => [[2, (s: string) => s + '!'], 'a'])()).toEqual([2, 'a!']);
        expect(W.listens(fa, s => s.length)()).toEqual([[2, 1], 'a']);
        expect(W.censor(fa, s => s + '!')()).toEqual([2, 'a!']);
        const M = W.getMonad(S.Monoid);
        expect(M.of(2)()).toEqual([2, '']);
        expect(M.ap(() => [twice, 'f'], fa)()).toEqual([4, 'fa']);
        expect(M.chain(fa, n => () => [n + 1, 'b'])()).toEqual([3, 'ab']);
    });
    it('StateT: threaded state and native undefined effect results', () => {
        const M = ST.getStateM(I.Monad);
        const fa = (s: number) => [s + 1, s + 2] as const;
        expect(M.map(fa, twice)(2)).toEqual([6, 4]);
        expect(M.ap(M.of(twice), fa)(2)).toEqual([6, 4]);
        expect(M.chain(fa, a => s => [a + s, s + 1])(2)).toEqual([7, 5]);
        expect(M.get()(2)).toEqual([2, 2]);
        expect(M.put(4)(2)).toEqual([undefined, 4]);
        expect(M.modify(twice)(2)).toEqual([undefined, 4]);
        expect(M.gets(twice)(2)).toEqual([4, 2]);
        expect(M.fromState(fa)(2)).toEqual([3, 4]);
        expect(M.fromM(7)(2)).toEqual([7, 2]);
        expect(M.evalState(fa, 2)).toBe(3);
        expect(M.execState(fa, 2)).toBe(4);
    });
    it('ReaderT: closures retain the supplied environment', () => {
        const M = RT.getReaderM(I.Monad);
        const fa = (r: { n: number }) => r.n;
        const env = { n: 3 };
        expect(M.map(fa, twice)(env)).toBe(6);
        expect(M.ap(M.of(twice), fa)(env)).toBe(6);
        expect(M.chain(fa, a => r => a + r.n)(env)).toBe(6);
        expect(M.ask()(env)).toBe(env);
        expect(M.asks(fa)(env)).toBe(3);
        expect(M.local(fa, n => ({ n }))(4)).toBe(4);
        expect(M.fromReader(fa)(env)).toBe(3);
        expect(M.fromM(7)(env)).toBe(7);
    });
    it('EitherT: error recovery and effectful matching', () => {
        const M = ET.getEitherM(I.Monad);
        expect(M.map(E.right(2), twice)).toEqual(E.right(4));
        expect(M.ap(E.right(twice), E.right(2))).toEqual(E.right(4));
        expect(M.chain(E.right(2), n => E.right(n + 1))).toEqual(E.right(3));
        expect(M.alt(E.left('bad'), () => E.right(3))).toEqual(E.right(3));
        expect(M.bimap(E.left('bad'), s => s + '!', twice)).toEqual(E.left('bad!'));
        expect(M.mapLeft(E.left('bad'), s => s + '!')).toEqual(E.left('bad!'));
        expect(M.fold(E.left('bad'), s => s.length, twice)).toBe(3);
        expect(M.getOrElse(E.left('bad'), s => s.length)).toBe(3);
        expect(M.orElse(E.left('bad'), s => E.right(s.length))).toEqual(E.right(3));
        expect(ET.orElseFirst(I.Monad)(s => E.right(s.length))(E.left('bad'))).toEqual(E.left('bad'));
        expect(ET.orElseFirst(I.Monad)(() => E.left('replacement'))(E.left('bad'))).toEqual(E.left('replacement'));
    });
    it('TheseT: both branches and accumulated messages', () => {
        const M = HT.getTheseM(I.Monad);
        expect(M.map(H.both('a', 2), twice)).toEqual(H.both('a', 4));
        expect(M.bimap(H.both('a', 2), s => s + '!', twice)).toEqual(H.both('a!', 4));
        expect(M.mapLeft(H.left('a'), s => s + '!')).toEqual(H.left('a!'));
        expect(M.fold(H.both('a', 2), s => s.length, twice, (s, n) => s.length + n)).toBe(3);
        expect(M.toTuple(H.left('a'), '', 0)).toEqual(['a', 0]);
        expect(M.toTuple(H.right(2), '', 0)).toEqual(['', 2]);
        const monad = M.getMonad(S.Monoid);
        expect(monad.ap(H.both('f', twice), H.both('a', 2))).toEqual(H.both('fa', 4));
        expect(monad.chain(H.both('a', 2), n => H.both('b', n + 1))).toEqual(H.both('ab', 3));
    });
    it('FromIO/Task/Reader/Either: callbacks execute once, with the carried argument', async () => {
        const calls: number[] = [];
        const effect = (n: number) => () => { calls.push(n); return n * 2; };
        expect(FIO.chainIOK(IO.FromIO, IO.Chain)(effect)(IO.of(3))()).toBe(6);
        expect(FIO.chainFirstIOK(IO.FromIO, IO.Chain)(effect)(IO.of(3))()).toBe(3);
        expect(await FT.chainTaskK(T.FromTask, T.Chain)(n => async () => effect(n)())(T.of(3))()).toBe(6);
        expect(await FT.chainFirstTaskK(T.FromTask, T.Chain)(n => async () => effect(n)())(T.of(3))()).toBe(3);
        const fromReader = { fromReader: (reader: any) => reader };
        expect(FR.chainReaderK(fromReader, Reader.Chain)(n => r => n + r)(Reader.of(3))(4)).toBe(7);
        expect(FR.chainFirstReaderK(fromReader, Reader.Chain)(n => r => n + r)(Reader.of(3))(4)).toBe(3);
        expect(FE.chainFirstEitherK(E.FromEither, E.Chain)(n => E.right(n * 2))(E.right(3))).toEqual(E.right(3));
        expect(calls).toEqual([3, 3, 3, 3]);
    });
});
