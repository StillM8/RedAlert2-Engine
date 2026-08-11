import { IniSection } from './IniSection';
import { IniParser } from './IniParser';
import { VirtualFile } from './vfs/VirtualFile';
export { IniSection } from './IniSection';
export class IniFile {
    public sections: Map<string, IniSection>;
    private sectionKeys = new Map<string, string>();
    constructor(source?: VirtualFile | Record<string, any> | string) {
        this.sections = new Map();
        if (source instanceof VirtualFile) {
            this.fromVirtualFile(source);
        }
        else if (typeof source === 'string') {
            this.fromString(source);
        }
        else if (typeof source === 'object' && source !== null) {
            this.fromJson(source);
        }
        else if (source === undefined) {
        }
        else {
            console.warn("IniFile: Constructor called with unknown source type.");
        }
    }
    public fromVirtualFile(virtualFile: VirtualFile): this {
        return this.fromString(virtualFile.readAsString());
    }
    public fromString(iniString: string): this {
        const parser = new IniParser();
        const parsedSectionsObject = parser.parse(iniString);
        return this.fromJson(parsedSectionsObject);
    }
    public fromJson(sectionsObject: Record<string, any>): this {
        this.sections.clear();
        this.sectionKeys.clear();
        for (const sectionName in sectionsObject) {
            if (sectionsObject.hasOwnProperty(sectionName)) {
                const sectionData = sectionsObject[sectionName];
                if (sectionData instanceof IniSection) {
                    this.getOrCreateSection(sectionName).mergeWith(sectionData);
                }
                else if (typeof sectionData === 'object' && sectionData !== null) {
                    const newSection = this.getOrCreateSection(sectionName);
                    newSection.fromJson(sectionData);
                }
                else {
                    console.warn(`IniFile.fromJson: Section data for "${sectionName}" is not a valid object or IniSection instance.`);
                }
            }
        }
        return this;
    }
    public toString(): string {
        const sectionStrings: string[] = [];
        this.sections.forEach(section => {
            sectionStrings.push(section.toString());
        });
        return sectionStrings.join("\r\n");
    }
    public clone(): IniFile {
        const newIniFile = new IniFile();
        this.sections.forEach((section, sectionName) => {
            newIniFile.getOrCreateSection(sectionName).mergeWith(section);
        });
        return newIniFile;
    }
    private canonicalSectionName(sectionName: string): string {
        return sectionName.toLocaleLowerCase('en-US');
    }
    private findSectionKey(sectionName: string): string | undefined {
        const normalized = this.canonicalSectionName(sectionName);
        const indexedSectionName = this.sectionKeys.get(normalized);
        if (indexedSectionName !== undefined && this.sections.has(indexedSectionName)) {
            return indexedSectionName;
        }
        if (this.sections.has(sectionName)) {
            this.sectionKeys.set(normalized, sectionName);
            return sectionName;
        }
        if (this.sectionKeys.size !== this.sections.size) {
            const existingSectionName = [...this.sections.keys()].find((candidate) =>
                this.canonicalSectionName(candidate) === normalized);
            if (existingSectionName !== undefined) {
                this.sectionKeys.set(normalized, existingSectionName);
            }
            return existingSectionName;
        }
        return undefined;
    }
    public getOrCreateSection(sectionName: string): IniSection {
        const existingSectionName = this.findSectionKey(sectionName);
        let section = existingSectionName === undefined ? undefined : this.sections.get(existingSectionName);
        if (!section) {
            section = new IniSection(sectionName);
            this.sections.set(sectionName, section);
            this.sectionKeys.set(this.canonicalSectionName(sectionName), sectionName);
        }
        return section;
    }
    public getSection(sectionName: string): IniSection | undefined {
        const existingName = this.findSectionKey(sectionName);
        return existingName === undefined ? undefined : this.sections.get(existingName);
    }
    public getOrderedSections(): IniSection[] {
        return Array.from(this.sections.values());
    }
    public mergeWith(otherIniFile: IniFile): this {
        otherIniFile.sections.forEach((otherSection, sectionName) => {
            const localSection = this.getOrCreateSection(sectionName);
            localSection.mergeWith(otherSection);
        });
        return this;
    }
}
