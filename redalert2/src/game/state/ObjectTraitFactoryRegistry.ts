/**
 * Registry for traits that are attached to an object at runtime (not built by
 * `ObjectFactory` from authored rules), so a world checkpoint can reconstruct
 * them. Factory-built traits are deliberately absent: re-creating those would
 * duplicate the ones the object factory already installs.
 *
 * A trait opts in by declaring a `runtimeAttachKey` static that is registered
 * here with a factory able to rebuild the trait from a captured context.
 */
export interface ObjectTraitFactory {
    (context: any, game: any): any;
}

const factories = new Map<string, ObjectTraitFactory>();

export function registerObjectTraitFactory(key: string, factory: ObjectTraitFactory): void {
    if (typeof key !== "string" || key.length === 0) {
        throw new Error("Object trait factory key must be a non-empty string");
    }
    if (typeof factory !== "function") {
        throw new Error(`Object trait factory "${key}" must be a function`);
    }
    if (factories.has(key) && factories.get(key) !== factory) {
        throw new Error(`Object trait factory "${key}" is already registered`);
    }
    factories.set(key, factory);
}

export function getObjectTraitFactory(key: string): ObjectTraitFactory | undefined {
    return factories.get(key);
}

export function isRegisteredObjectTraitKey(key: unknown): key is string {
    return typeof key === "string" && factories.has(key);
}

/** Stable attach key for a trait instance, or undefined when factory-built. */
export function getRuntimeAttachKey(trait: any): string | undefined {
    const key = (trait?.constructor as any)?.runtimeAttachKey;
    return isRegisteredObjectTraitKey(key) ? key : undefined;
}
