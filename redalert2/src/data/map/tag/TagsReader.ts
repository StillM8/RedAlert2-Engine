import { TagRepeatType } from './TagRepeatType';
import { IniSection } from '@/data/IniSection';
export interface ParsedTag {
    id: string;
    lifetime: TagRepeatType;
    repeatType: TagRepeatType;
    name: string;
    triggerId: string;
}
export class TagsReader {
    read(section: IniSection): ParsedTag[] {
        const result: ParsedTag[] = [];
        for (const [id, rawValue] of section.entries) {
            if (typeof rawValue !== 'string') {
                continue;
            }
            const parts = rawValue.split(',');
            if (parts.length < 2) {
                console.warn(`Invalid tag ${id}=${rawValue}. Skipping.`);
                continue;
            }
            const hasLifetime = parts.length >= 3;
            const lifetime = (hasLifetime ? Number(parts[0]) : TagRepeatType.Volatile) as TagRepeatType;
            if (![TagRepeatType.Volatile, TagRepeatType.SemiPersistent, TagRepeatType.Persistent].includes(lifetime)) {
                console.warn(`Invalid lifetime value ${parts[0]} for tag id ${id}. Skipping.`);
                continue;
            }
            const name = (hasLifetime ? parts[1] : parts[0]).trim();
            const triggerId = hasLifetime ? parts.slice(2).join(',').trim() : parts[1].trim();
            if (!hasLifetime && triggerId.toLocaleLowerCase("en-US") !== '<none>') {
                console.warn(`Invalid tag ${id}=${rawValue}. Skipping.`);
                continue;
            }
            result.push({
                id,
                lifetime,
                repeatType: lifetime,
                name,
                triggerId,
            });
        }
        return result;
    }
}
