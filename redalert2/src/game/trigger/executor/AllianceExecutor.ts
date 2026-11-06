import { AllianceStatus } from "@/game/Alliances";
import { AllianceChangeEvent, AllianceEventType } from "@/game/event/AllianceChangeEvent";
import { resolveHousePlayer, resolveTriggerHousePlayer } from "@/game/trigger/HouseReference";
import { TriggerExecutor } from "@/game/trigger/TriggerExecutor";

export class AllianceExecutor extends TriggerExecutor {
    constructor(action: any, trigger: any, private readonly formAlliance: boolean) {
        super(action, trigger);
    }

    execute(context: any): void {
        const source = resolveTriggerHousePlayer(context, this.trigger);
        const target = resolveHousePlayer(context, this.action.params[1]);
        if (!source || !target || source === target) {
            return;
        }
        if (this.formAlliance) {
            this.form(context, source, target);
        }
        else {
            this.break(context, source, target);
        }
    }

    private form(context: any, source: any, target: any): void {
        const alliances = context.alliances;
        const existing = alliances?.findByPlayers?.(source, target);
        if (existing?.status === AllianceStatus.Formed) {
            return;
        }
        if (existing?.status === AllianceStatus.Requested) {
            alliances.acceptRequest(existing.players.first, existing.players.second);
            context.onAllianceChange?.(existing, source, true);
            return;
        }
        let alliance = existing;
        if (!alliance) {
            try {
                alliance = alliances.setAlliance(source, target, AllianceStatus.Formed);
            }
            catch {
                const entries = (alliances as any).alliances as any[] | undefined;
                if (!entries) {
                    return;
                }
                const players = {
                    first: source,
                    second: target,
                    has: (player: any) => player === source || player === target,
                    equals: (other: any) =>
                        (other.first === source && other.second === target) ||
                        (other.first === target && other.second === source),
                };
                alliance = { players, status: AllianceStatus.Formed };
                entries.push(alliance);
            }
        }
        if (alliance) {
            context.onAllianceChange?.(alliance, source, true);
        }
    }

    private break(context: any, source: any, target: any): void {
        const alliances = context.alliances;
        const alliance = alliances?.findByPlayers?.(source, target);
        if (alliance?.status === AllianceStatus.Formed) {
            alliances.breakAlliance(source, target);
            context.onAllianceChange?.(alliance, source, false);
        }
        else if (alliance?.status === AllianceStatus.Requested) {
            alliances.cancelRequest(alliance.players.first, alliance.players.second);
            context.events?.dispatch?.(new AllianceChangeEvent(
                alliance,
                AllianceEventType.Broken,
                source,
            ));
        }
    }
}
