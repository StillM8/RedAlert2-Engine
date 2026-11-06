export class SpecialFlags {
    initialVeteran: boolean;
    fixedAlliance: boolean;
    read(data: {
        getBool: (key: string, defaultValue?: boolean) => boolean;
    }): SpecialFlags {
        this.initialVeteran = data.getBool("InitialVeteran");
        this.fixedAlliance = data.getBool("FixedAlliance");
        return this;
    }
}
