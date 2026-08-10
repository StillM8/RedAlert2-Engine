import { ActionType } from '@/game/action/ActionType';
import { UpdateType } from '@/game/action/UpdateQueueAction';
import { DebugCommand, DebugCommandType } from '@/game/action/DebugAction';
import { TargetBridgeMode } from '@/game/Target';
import { SuperWeaponType } from '@/game/type/SuperWeaponType';
interface Tile {
    x: number;
    y: number;
}
interface Target {
}
interface BuildingRules {
}
interface ObjectRules {
}
interface Player {
    name: string;
}
interface ActionFactory {
    create(actionType: ActionType): any;
}
interface ActionQueue {
    push(action: any): void;
}
interface Game {
    rules: {
        getBuilding(type: any): BuildingRules;
        getObject(type: any, subType: any): ObjectRules;
        getSuperWeaponActivationId(selector: any): number | undefined;
        getSuperWeaponByIndex(index: number): { type?: SuperWeaponType } | undefined;
    };
    getPlayerByName(name: string): Player;
    map: {
        tiles: {
            getByMapCoords(x: number, y: number): any;
        };
        tileOccupation: {
            getBridgeOnTile(tile: any): any;
        };
    };
    getWorld(): {
        hasObjectId(id: number): boolean;
    };
    getObjectById(id: number): any;
    createTarget(object: any, tile: any, bridgeMode?: TargetBridgeMode): Target;
}
interface LocalPlayer {
    name: string;
    getDebugMode(): boolean;
}
interface ChatApi {
    sayAll(playerName: string, message: string): void;
}
export class ActionsApi {
    private actionFactory: ActionFactory;
    private actionQueue: ActionQueue;
    private game: Game;
    private localPlayer: LocalPlayer;
    private chatApi?: ChatApi;
    constructor(game: Game, actionFactory: ActionFactory, actionQueue: ActionQueue, localPlayer: LocalPlayer, chatApi?: ChatApi) {
        this.game = game;
        this.actionFactory = actionFactory;
        this.actionQueue = actionQueue;
        this.localPlayer = localPlayer;
        this.chatApi = chatApi;
    }
    placeBuilding(buildingType: any, x: number, y: number): void {
        this.createAndPushAction(ActionType.PlaceBuilding, (action) => {
            action.buildingRules = this.game.rules.getBuilding(buildingType);
            action.tile = { x, y };
        });
    }
    sellObject(objectId: number): void {
        this.createAndPushAction(ActionType.SellObject, (action) => {
            action.objectId = objectId;
        });
    }
    sellBuilding(buildingId: number): void {
        this.sellObject(buildingId);
    }
    toggleRepairWrench(buildingId: any): void {
        this.createAndPushAction(ActionType.ToggleRepair, (action) => {
            action.buildingId = buildingId;
        });
    }
    toggleAlliance(playerName: string, toggle: boolean): void {
        this.createAndPushAction(ActionType.ToggleAlliance, (action) => {
            action.toPlayer = this.game.getPlayerByName(playerName);
            action.toggle = toggle;
        });
    }
    pauseProduction(queueType: any): void {
        this.createAndPushAction(ActionType.UpdateQueue, (action) => {
            action.queueType = queueType;
            action.updateType = UpdateType.Pause;
        });
    }
    resumeProduction(queueType: any): void {
        this.createAndPushAction(ActionType.UpdateQueue, (action) => {
            action.queueType = queueType;
            action.updateType = UpdateType.Resume;
        });
    }

    private normalizeObjectArgs(objectType: any, subType: any): {
        objectType: any;
        subType: any;
    } {
        // Compatibility: some third-party bots call queue APIs as (name, type)
        // while the game API expects (type, name).
        if (typeof objectType === 'string' && (typeof subType === 'number' || /^\d+$/.test(String(subType)))) {
            return {
                objectType: subType,
                subType: objectType,
            };
        }
        return { objectType, subType };
    }

    queueForProduction(queueType: any, objectType: any, subType: any, quantity: number): void {
        const normalized = this.normalizeObjectArgs(objectType, subType);
        let item: any;
        try {
            item = this.game.rules.getObject(normalized.subType, normalized.objectType);
        } catch (e) {
            console.error(`[ActionsApi] queueForProduction failed: getObject("${normalized.subType}", ${normalized.objectType}) threw:`, e);
            return;
        }
        this.createAndPushAction(ActionType.UpdateQueue, (action) => {
            action.queueType = queueType;
            action.updateType = UpdateType.Add;
            action.item = item;
            action.quantity = quantity;
        });
    }
    unqueueFromProduction(queueType: any, objectType: any, subType: any, quantity: number): void {
        const normalized = this.normalizeObjectArgs(objectType, subType);
        let item: any;
        try {
            item = this.game.rules.getObject(normalized.subType, normalized.objectType);
        } catch (e) {
            console.error(`[ActionsApi] unqueueFromProduction failed: getObject("${normalized.subType}", ${normalized.objectType}) threw:`, e);
            return;
        }
        this.createAndPushAction(ActionType.UpdateQueue, (action) => {
            action.queueType = queueType;
            action.updateType = UpdateType.Cancel;
            action.item = item;
            action.quantity = quantity;
        });
    }
    activateSuperWeapon(superWeaponType: any, targetTile: {
        rx: number;
        ry: number;
    }, secondaryTile?: {
        rx: number;
        ry: number;
    }): void {
        // ChronoSphere REQUIRES a destination tile; without it the effect
        // throws inside deterministic tick processing (crash/desync), so
        // reject the malformed request here instead.
        const activationId = this.game.rules.getSuperWeaponActivationId(superWeaponType);
        const superWeaponRules = activationId === undefined
            ? undefined
            : this.game.rules.getSuperWeaponByIndex(activationId);
        if (activationId === undefined || !superWeaponRules) {
            console.warn(`[ActionsApi] Unknown superweapon selector "${String(superWeaponType)}"; ignored`);
            return;
        }
        if (superWeaponRules.type === SuperWeaponType.ChronoSphere && !secondaryTile) {
            console.warn('[ActionsApi] ChronoSphere activation requires a secondaryTile; ignored');
            return;
        }
        this.createAndPushAction(ActionType.ActivateSuperWeapon, (action) => {
            action.superWeaponType = activationId;
            action.tile = { x: targetTile.rx, y: targetTile.ry };
            action.tile2 = secondaryTile ? { x: secondaryTile.rx, y: secondaryTile.ry } : undefined;
        });
    }
    orderUnits(unitIds: any[], orderType: any, targetX?: any, targetY?: any, useBridge?: boolean): void {
        this.createAndPushAction(ActionType.SelectUnits, (action) => {
            action.unitIds = unitIds;
        });
        let target: Target | undefined;
        if (targetX !== undefined) {
            let targetObject: any;
            let targetTile: any;
            if (targetY !== undefined) {
                targetObject = undefined;
                const tile = this.game.map.tiles.getByMapCoords(targetX, targetY);
                if (!tile) {
                    // Never throw into a bot tick: a bot computing an off-map
                    // destination must lose ONE order, not abort its whole
                    // mission update. Same policy as ActivateSuperWeaponAction.
                    console.warn(`[ActionsApi] orderUnits: no tile at rx,ry=${targetX},${targetY}; order dropped`);
                    return;
                }
                targetTile = tile;
                if (useBridge) {
                    targetObject = this.game.map.tileOccupation.getBridgeOnTile(tile);
                }
            }
            else {
                if (!this.game.getWorld().hasObjectId(targetX)) {
                    return;
                }
                targetObject = this.game.getObjectById(targetX);
                targetTile = targetObject.tile;
            }
            const bridgeMode = targetY !== undefined && useBridge !== undefined
                ? (useBridge ? TargetBridgeMode.Bridge : TargetBridgeMode.Ground)
                : TargetBridgeMode.Auto;
            target = this.game.createTarget(targetObject, targetTile, bridgeMode);
        }
        this.createAndPushAction(ActionType.OrderUnits, (action) => {
            action.orderType = orderType;
            action.target = target;
        });
    }
    sayAll(message: string): void {
        this.chatApi?.sayAll(this.localPlayer.name, message);
    }
    setGlobalDebugText(text?: string): void {
        if (this.localPlayer.getDebugMode()) {
            this.createAndPushAction(ActionType.DebugCommand, (action) => {
                action.command = new DebugCommand(DebugCommandType.SetGlobalDebugText, { text: text || "" });
            });
        }
    }
    setUnitDebugText(unitId: number, label?: string): void {
        if (this.localPlayer.getDebugMode()) {
            this.createAndPushAction(ActionType.DebugCommand, (action) => {
                action.command = new DebugCommand(DebugCommandType.SetUnitDebugText, { unitId, label });
            });
        }
    }
    quitGame(): void {
        this.createAndPushAction(ActionType.ResignGame);
    }
    private createAndPushAction(actionType: ActionType, configureAction?: (action: any) => void): void {
        const action = this.actionFactory.create(actionType);
        action.player = this.game.getPlayerByName(this.localPlayer.name);
        configureAction?.(action);
        this.actionQueue.push(action);
    }
}
