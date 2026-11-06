import { CsfFile } from "@/data/CsfFile";
import type { VirtualFileSystem } from "@/data/vfs/VirtualFileSystem";
import type { GameProfileDescriptor, GameProfileId } from "@/engine/GameProfile";
import type { CampaignStringResolver, CampaignText } from "./CampaignTypes";

function key(value: string): string {
    return value.toLocaleLowerCase("en-US");
}

export class CampaignCsfResolver implements CampaignStringResolver {
    private readonly values = new Map<string, string>();
    private readonly fallback?: CampaignStringResolver;

    constructor(
        fallback?: CampaignStringResolver,
        vfs?: VirtualFileSystem,
        profile: GameProfileId | GameProfileDescriptor = "ra2",
    ) {
        this.fallback = fallback;
        if (vfs) {
            this.load(vfs, profile);
        }
    }

    private load(vfs: VirtualFileSystem, profile: GameProfileId | GameProfileDescriptor): void {
        const id = typeof profile === "string" ? profile : profile.id;
        const descriptor = typeof profile === "string" ? undefined : profile;
        const seen = new Set<string>();
        const candidates = [
            "ra2.csf",
            "general.csf",
            ...(id === "yr" || id === "mental-omega"
                ? ["ra2md.csf", "generalmd.csf", "stringtable00.csf", "stringtable01.csf"]
                : []),
            ...(id === "mental-omega"
                ? ["ra2mo.csf", "stringtable09.csf", "stringtable10.csf", "stringtable11.csf"]
                : []),
            ...(descriptor?.stringFileCandidates ?? []),
        ].filter((value) => {
            const normalized = value.toLocaleLowerCase("en-US");
            if (seen.has(normalized)) {
                return false;
            }
            seen.add(normalized);
            return true;
        });
        for (const fileName of candidates) {
            try {
                if (!vfs.fileExists(fileName)) {
                    continue;
                }
                const csf = new CsfFile(vfs.openFile(fileName));
                for (const [label, value] of Object.entries(csf.data)) {
                    this.values.set(key(label), value);
                }
            }
            catch {
            }
        }
    }

    has(label: string): boolean {
        const normalized = key(label);
        if (this.values.has(normalized)) {
            return true;
        }
        return this.fallback?.has?.(label) ?? (this.fallback ? this.fallback.get(label) !== label : false);
    }

    get(label: string, ...args: any[]): string {
        const normalized = key(label);
        const value = this.values.get(normalized);
        if (value !== undefined) {
            return value;
        }
        if (this.fallback) {
            return this.fallback.get(label, ...args);
        }
        return label;
    }
}

export function resolveCampaignLabel(
    rawValue: string | undefined,
    fallbackLabel: string,
    resolver?: CampaignStringResolver,
    fallbackValue?: string,
): CampaignText {
    if (rawValue !== undefined && rawValue.trim() === "") {
        return {
            label: "",
            value: "",
            resolved: true,
        };
    }
    const label = rawValue?.trim() || fallbackLabel;
    if (/^NOSTR:/i.test(label)) {
        return {
            label,
            value: label.slice(6),
            resolved: true,
        };
    }
    if (resolver) {
        const resolved = resolver.get(label);
        const known = resolver.has?.(label) ?? resolved !== label;
        if (known || resolved !== label) {
            return {
                label,
                value: resolved,
                resolved: true,
            };
        }
    }
    return {
        label,
        value: fallbackValue ?? label,
        resolved: false,
    };
}

export function createCampaignStringResolver(
    strings?: CampaignStringResolver,
    vfs?: VirtualFileSystem,
    profile: GameProfileId | GameProfileDescriptor = "ra2",
): CampaignStringResolver {
    return new CampaignCsfResolver(strings, vfs, profile);
}
