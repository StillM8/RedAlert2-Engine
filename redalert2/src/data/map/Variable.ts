export class Variable {
    name: string;
    value: any;
    isGlobal: boolean;
    constructor(name: string, value: any, isGlobal: boolean = false) {
        this.name = name;
        this.value = value;
        this.isGlobal = isGlobal;
    }
    clone(): Variable {
        return new Variable(this.name, this.value, this.isGlobal);
    }
}
