import { SelectionModel } from './SelectionModel';
import { fnv32a } from '@/util/math';
import { GameObject } from '../GameObject';
export class UnitSelection {
    private selectedUnits: Set<GameObject>;
    private selectionModelsByUnit: Map<GameObject, SelectionModel>;
    private groups: Map<number, Set<GameObject>>;
    private hashNeedsUpdate: boolean;
    private hash: number;
    private selectionEventSink?: (unit: GameObject) => void;
    constructor() {
        this.selectedUnits = new Set();
        this.selectionModelsByUnit = new Map();
        this.groups = new Map();
        this.hashNeedsUpdate = true;
    }
    setEventSink(sink: ((unit: GameObject) => void) | undefined): void {
        this.selectionEventSink = sink;
    }
    getOrCreateSelectionModel(unit: GameObject): SelectionModel {
        let model = this.selectionModelsByUnit.get(unit);
        if (!model) {
            model = new SelectionModel(unit);
            this.selectionModelsByUnit.set(unit, model);
        }
        return model;
    }
    deselectAll(): void {
        this.selectedUnits.forEach(unit => this.selectionModelsByUnit.get(unit)?.setSelected(false));
        this.selectedUnits.clear();
        this.hashNeedsUpdate = true;
    }
    addToSelection(unit: GameObject): void {
        const wasSelected = this.selectedUnits.has(unit);
        this.selectedUnits.add(unit);
        this.getOrCreateSelectionModel(unit).setSelected(true);
        this.hashNeedsUpdate = true;
        if (!wasSelected) {
            this.selectionEventSink?.(unit);
        }
    }
    removeFromSelection(units: GameObject[]): void {
        units.forEach(unit => {
            this.selectedUnits.delete(unit);
            this.getOrCreateSelectionModel(unit).setSelected(false);
        });
        this.hashNeedsUpdate = true;
    }
    getSelectedUnits(): GameObject[] {
        return [...this.selectedUnits].filter(unit => !unit.isDestroyed && !unit.isCrashing && !unit.isDisposed && unit.isSpawned);
    }
    isSelected(unit: GameObject): boolean {
        return this.selectedUnits.has(unit);
    }
    cleanupUnit(unit: GameObject): void {
        this.selectionModelsByUnit.delete(unit);
        this.selectedUnits.delete(unit);
        this.removeUnitsFromGroup([unit]);
        this.hashNeedsUpdate = true;
    }
    updateHash(): void {
        this.hash = fnv32a([...this.selectedUnits].map(unit => unit.id));
    }
    getHash(): number {
        if (this.hashNeedsUpdate) {
            this.updateHash();
            this.hashNeedsUpdate = false;
        }
        return this.hash;
    }
    createGroup(groupNumber: number): void {
        this.addUnitsToGroup(groupNumber, this.getSelectedUnits());
    }
    addUnitsToGroup(groupNumber: number, units: GameObject[], clearExisting: boolean = true): void {
        this.removeUnitsFromGroup(units);
        let group = this.groups.get(groupNumber);
        if (!group) {
            group = new Set();
            this.groups.set(groupNumber, group);
        }
        if (clearExisting) {
            [...group.values()].forEach(unit => this.selectionModelsByUnit.get(unit)?.setControlGroupNumber(undefined));
            group.clear();
        }
        for (const unit of units) {
            group.add(unit);
            this.getOrCreateSelectionModel(unit).setControlGroupNumber(groupNumber);
        }
    }
    addGroupToSelection(groupNumber: number): void {
        if (this.groups.has(groupNumber)) {
            for (const unit of [...this.groups.get(groupNumber)!]) {
                this.addToSelection(unit);
            }
        }
    }
    selectGroup(groupNumber: number): void {
        this.deselectAll();
        this.addGroupToSelection(groupNumber);
    }
    getGroupUnits(groupNumber: number): GameObject[] {
        return [...(this.groups.get(groupNumber) ?? [])];
    }
    removeUnitsFromGroup(units: GameObject[]): void {
        for (const group of this.groups.values()) {
            for (const unit of units) {
                group.delete(unit);
                this.selectionModelsByUnit.get(unit)?.setControlGroupNumber(undefined);
            }
        }
    }
    captureState(): { selected: number[]; groups: [number, number[]][] } {
        return {
            selected: [...this.selectedUnits].map(unit => unit.id).sort((a, b) => a - b),
            groups: [...this.groups.entries()]
                .map(([group, units]) => [group, [...units].map(unit => unit.id).sort((a, b) => a - b)] as [number, number[]])
                .sort((a, b) => a[0] - b[0]),
        };
    }
    restoreState(state: unknown, context: { resolveObjectById: (id: number) => GameObject; strict?: boolean }): void {
        if (!state || typeof state !== "object" || !Array.isArray((state as any).selected) ||
            !Array.isArray((state as any).groups)) {
            throw new Error("Invalid selection state");
        }
        const selected: GameObject[] = [];
        const selectedIds = new Set<number>();
        for (const id of (state as any).selected) {
            if (!Number.isSafeInteger(id) || selectedIds.has(id)) {
                throw new Error("Invalid selected unit id");
            }
            const unit = context.resolveObjectById(id);
            if (!unit) {
                if (context.strict) throw new Error(`Cannot restore selected unit ${id}: unresolved`);
                continue;
            }
            selectedIds.add(id);
            selected.push(unit);
        }
        const groups: [number, GameObject[]][] = [];
        for (const entry of (state as any).groups) {
            if (!Array.isArray(entry) || !Number.isSafeInteger(entry[0]) || !Array.isArray(entry[1])) {
                throw new Error("Invalid selection group");
            }
            const units: GameObject[] = [];
            for (const id of entry[1]) {
                const unit = context.resolveObjectById(id);
                if (!unit) {
                    if (context.strict) throw new Error(`Cannot restore selection group unit ${id}: unresolved`);
                    continue;
                }
                units.push(unit);
            }
            groups.push([entry[0], units]);
        }
        this.deselectAll();
        this.groups.clear();
        for (const unit of selected) {
            this.selectedUnits.add(unit);
            this.getOrCreateSelectionModel(unit).setSelected(true);
        }
        for (const [group, units] of groups) {
            this.groups.set(group, new Set(units));
            for (const unit of units) {
                this.getOrCreateSelectionModel(unit).setControlGroupNumber(group);
            }
        }
        this.hashNeedsUpdate = true;
    }
}
