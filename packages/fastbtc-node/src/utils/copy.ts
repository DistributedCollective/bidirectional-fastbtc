export function deepcopy<T = any>(thing: T): T {
    return JSON.parse(JSON.stringify(thing));
}
