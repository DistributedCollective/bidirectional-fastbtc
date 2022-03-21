export function setIntersection<T>(set1: Set<T>, set2: Set<T>): Set<T> {
    return new Set<T>([...set1].filter(x => set2.has(x)));
}

export function setDifference<T>(set1: Set<T>, set2: Set<T>): Set<T> {
    return new Set([...set1].filter(x => !set2.has(x)));
}

export function setUnion<T>(set1: Set<T>, set2: Set<T>): Set<T> {
    let _union = new Set(set1);
    for (let elem of set2) {
        _union.add(elem);
    }
    return _union;
}

export function setExtend<T>(target: Set<T>, newElements: Iterable<T>): Set<T> {
    for (const elem of newElements) {
        target.add(elem);
    }
    return target;
}

export function setIsSuperset<T>(set: Set<T>, subset: Set<T>): boolean {
    for (let elem of subset) {
        if (!set.has(elem)) {
            return false;
        }
    }
    return true;
}

export function setsEqual<T>(a: Set<T>, b: Set<T>): boolean {
    return a.size === b.size && [...a].every(value => b.has(value));
}
