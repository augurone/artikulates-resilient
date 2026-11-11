export function runTask(make: () => [() => number, unknown]) {
    const [callback, value] = make();

    return [callback(), value];
}
