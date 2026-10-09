export function readProvider<T>(provider: { read: (this: object) => T }) {
    return provider.read();
}
