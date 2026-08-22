import { CompositeDisposable } from '@/util/disposable/CompositeDisposable';
import { EventType } from '@/game/event/EventType';
import { SoundKey } from '@/engine/sound/SoundKey';
import { ChannelType } from '@/engine/sound/ChannelType';
import { SoundControl } from '@/engine/sound/SoundSpecs';
import { aiUiNames } from '@/game/gameopts/constants';
import { Coords } from '@/game/Coords';
import { PowerupType } from '@/game/type/PowerupType';
import { SuperWeaponType } from '@/game/type/SuperWeaponType';
import { RadarEventType } from '@/game/rules/general/RadarRules';
import { OrderFeedbackType } from '@/game/order/OrderFeedbackType';
import { QueueType, QueueStatus } from '@/game/player/production/ProductionQueue';
import { getAvailableBuildingSuperWeapon } from '@/game/gameobject/trait/SuperWeaponTrait';
import {
    resolveAresSuperWeaponMessageColor,
    resolveAresSuperWeaponEva,
    resolveAresSuperWeaponMessage,
} from '@/extensions/ares/AresSuperWeaponPresentation';

const detectedSuperWeaponEvaByType = new Map([
    [SuperWeaponType.MultiMissile, 'EVA_NuclearSiloDetected'],
    [SuperWeaponType.IronCurtain, 'EVA_IronCurtainDetected'],
    [SuperWeaponType.ChronoSphere, 'EVA_ChronosphereDetected'],
    [SuperWeaponType.LightningStorm, 'EVA_WeatherDeviceReady'],
    [SuperWeaponType.PsychicDominator, 'EVA_PsychicDominatorDetected'],
    [SuperWeaponType.GeneticConverter, 'EVA_GeneticMutatorDetected'],
]);

const superWeaponReadyEvaByType = new Map([
    [SuperWeaponType.MultiMissile, 'EVA_NuclearMissileReady'],
    [SuperWeaponType.IronCurtain, 'EVA_IronCurtainReady'],
    [SuperWeaponType.ChronoSphere, 'EVA_ChronosphereReady'],
    [SuperWeaponType.LightningStorm, 'EVA_LightningStormReady'],
    [SuperWeaponType.ParaDrop, 'EVA_ReinforcementsReady'],
    [SuperWeaponType.AmerParaDrop, 'EVA_ReinforcementsReady'],
    [SuperWeaponType.PsychicDominator, 'EVA_PsychicDominatorReady'],
    [SuperWeaponType.GeneticConverter, 'EVA_GeneticMutatorReady'],
    [SuperWeaponType.ForceShield, 'EVA_ForceShieldReady'],
    [SuperWeaponType.PsychicReveal, 'EVA_PsychicRevealReady'],
    [SuperWeaponType.SpyPlane, 'EVA_SpyPlaneReady'],
]);

const superWeaponActivateEvaByType = new Map([
    [SuperWeaponType.MultiMissile, 'EVA_NuclearMissileLaunched'],
    [SuperWeaponType.IronCurtain, 'EVA_IronCurtainActivated'],
    [SuperWeaponType.ChronoSphere, 'EVA_ChronosphereActivated'],
    [SuperWeaponType.LightningStorm, 'EVA_LightningStormCreated'],
    [SuperWeaponType.PsychicDominator, 'EVA_PsychicDominatorActivated'],
    [SuperWeaponType.GeneticConverter, 'EVA_GeneticMutatorActivated'],
    [SuperWeaponType.ForceShield, 'EVA_ForceShieldActivated'],
]);

const superWeaponActivateSoundByType = new Map([
    [SuperWeaponType.MultiMissile, SoundKey.DigSound],
]);

const superWeaponActivateMessageByType = new Map([
    [SuperWeaponType.LightningStorm, 'TXT_LIGHTNING_STORM_APPROACHING'],
]);

const crateSoundByType = new Map([
    [PowerupType.Veteran, SoundKey.CratePromoteSound],
    [PowerupType.Money, SoundKey.CrateMoneySound],
    [PowerupType.Reveal, SoundKey.CrateRevealSound],
    [PowerupType.Firepower, SoundKey.CrateFireSound],
    [PowerupType.Armor, SoundKey.CrateArmourSound],
    [PowerupType.Speed, SoundKey.CrateSpeedSound],
    [PowerupType.Unit, SoundKey.CrateUnitSound],
]);

const crateEvaByType = new Map([
    [PowerupType.Armor, 'EVA_UnitArmorUpgraded'],
    [PowerupType.Firepower, 'EVA_UnitFirePowerUpgraded'],
    [PowerupType.Speed, 'EVA_UnitSpeedUpgraded'],
]);

export class SoundHandler {
    private lastAvailableObjectNames: string[] = [];
    private lastQueueStatuses = new Map();
    private lastAvailableNames?: Set<string>;
    private triggerSoundHandles = new Map();
    private disposables = new CompositeDisposable();
    private lastFeedbackTime?: number;
    private weaponLoopHandles = new Map<any, { handle: any; soundName: string }>();
    // Report -> is it a Loop/Ambient spec. getSoundSpec() is not memoised and
    // console.warn()s for every report with no sound.ini section (e.g.
    // GuardianGIDeployedAttack, SILENCER, JUMPJET1), so resolving it per shot
    // on the hottest event in the game is a real cost on device.
    private loopingReportCache = new Map<string, boolean>();
    // sound.ini caps GattlingGunAttackLoop1/2/3 at Limit=2 each; anything past
    // ~6 loops is hard-muted by WorldSound yet still schedules audio forever.
    private static readonly MAX_WEAPON_LOOPS = 6;
    private weaponLoopTimer?: ReturnType<typeof setInterval>;
    constructor(private game: any, private worldSound: any, private eva: any, private sound: any, private gameEvents: any, private messageList: any, private strings: any, private player: any) { }
    init(): void {
        this.disposables.add(this.gameEvents.subscribe((event: any) => this.handleGameEvent(event)));
        // Looping weapon reports (gattling) have no cease-fire event; poll the
        // shooter's sim state to spin the loop down when firing stops.
        this.weaponLoopTimer = setInterval(() => this.updateWeaponLoops(), 100);
    }
    dispose(): void {
        this.disposables.dispose();
        if (this.weaponLoopTimer !== undefined) {
            clearInterval(this.weaponLoopTimer);
            this.weaponLoopTimer = undefined;
        }
        for (const [, loop] of this.weaponLoopHandles) {
            loop.handle.stop();
        }
        this.weaponLoopHandles.clear();
    }
    private handleGameEvent(event: any): void {
        switch (event.type) {
            case EventType.Cheer:
                this.sound.play(SoundKey.CheerSound, ChannelType.Effect);
                break;
            case EventType.UnitDeployUndeploy:
                const isUndeploy = event.deployType === 'undeploy';
                const unit = event.unit;
                const deploySound = isUndeploy ? unit.rules.undeploySound : unit.rules.deploySound;
                if (deploySound) {
                    this.worldSound.playEffect(deploySound, unit, unit.owner);
                }
                break;
            case EventType.WeaponFire:
                this.handleWeaponFireSound(event);
                break;
            case EventType.AresIvanBombAttach:
                this.handleAresIvanBombAttachSound(event);
                break;
            case EventType.AresBountyAward:
                this.handleAresBountyAwardEvent(event);
                break;
            case EventType.TriggerEva:
                // Trigger/script "play speech" actions (including Ares
                // restored triggers) reference an EVA dialog name; route it
                // through the side-appropriate EVA voice table.
                if (event.soundId) {
                    this.eva.play(event.soundId);
                }
                break;
            case EventType.InflictDamage:
                this.handleDamageSound(event);
                break;
            case EventType.RadarEvent:
                this.handleRadarEventSound(event);
                break;
            case EventType.SuperWeaponReady:
                this.handleSuperWeaponReadySound(event);
                break;
            case EventType.SuperWeaponActivate:
                this.handleSuperWeaponActivateSound(event);
                break;
            case EventType.AresSuperWeaponEffect:
                this.handleAresSuperWeaponEffectSound(event);
                break;
            case EventType.AresSuperWeaponMessage:
                this.handleAresSuperWeaponMessageEvent(event);
                break;
            case EventType.LightningStormManifest:
                this.handleLightningStormManifestSound(event);
                break;
            case EventType.WarheadDetonate:
                this.handleWarheadDetonateSound(event);
                break;
            case EventType.ObjectDestroy:
                this.handleObjectDestroySound(event);
                const destroyedLoop = this.weaponLoopHandles.get(event.target);
                if (destroyedLoop) {
                    destroyedLoop.handle.stop();
                    this.weaponLoopHandles.delete(event.target);
                }
                break;
            case EventType.ObjectSpawn:
                this.handleObjectSpawnSound(event);
                break;
            case EventType.BuildingPlace:
                this.handleBuildingPlaceSound(event);
                break;
            case EventType.PlayerDefeated:
                this.handlePlayerDefeatedSound(event);
                break;
            case EventType.UnitPromote:
                this.handleUnitPromoteSound(event);
                break;
            case EventType.CratePickup:
                this.handleCratePickupSound(event);
                break;
            case EventType.FactoryProduceUnit:
                if (event.unit?.owner === this.player) {
                    this.eva.play('EVA_UnitReady');
                }
                break;
            case EventType.PowerLow:
                if (event.target === this.player) {
                    this.eva.play('EVA_LowPower');
                }
                break;
            default:
                break;
        }
    }
    /**
     * Called by CombatantUi whenever the buildable set may have changed;
     * announces newly unlocked tech.
     */
    handleAvailableObjectsUpdate(availableObjects: any[]): void {
        const names = new Set<string>(availableObjects.map((obj: any) => obj.name));
        const previous = this.lastAvailableNames;
        this.lastAvailableNames = names;
        if (!previous) {
            return;
        }
        for (const name of names) {
            if (!previous.has(name)) {
                this.eva.play('EVA_NewConstructionOptions');
                break;
            }
        }
    }
    /** Called by CombatantUi on production queue updates. */
    handleProductionQueueUpdate(queue: any): void {
        const previousStatus = this.lastQueueStatuses.get(queue.type);
        this.lastQueueStatuses.set(queue.type, queue.status);
        if (previousStatus === queue.status) {
            return;
        }
        if (queue.status === QueueStatus.Ready &&
            (queue.type === QueueType.Structures || queue.type === QueueType.Armory)) {
            this.eva.play('EVA_ConstructionComplete');
        }
        else if (queue.status === QueueStatus.OnHold) {
            this.eva.play('EVA_OnHold');
        }
    }
    private handleWeaponFireSound(event: any): void {
        const weapon = event.weapon;
        const gameObject = event.gameObject;
        if (!weapon.rules.report?.length) {
            return;
        }
        const volume = weapon.warhead.rules.electricAssault ? 0.25 : 1;
        const soundIndex = Math.floor(Math.random() * weapon.rules.report.length);
        const soundName = weapon.rules.report[soundIndex];
        let isLoop = this.loopingReportCache.get(soundName);
        if (isLoop === undefined) {
            const spec = this.sound.getSoundSpec?.(soundName);
            isLoop = !!spec && (spec.control.has(SoundControl.Loop) || spec.control.has(SoundControl.Ambient));
            this.loopingReportCache.set(soundName, isLoop);
        }
        if (!isLoop) {
            this.worldSound.playEffect(soundName, gameObject.position.worldPosition, gameObject.owner, volume);
            return;
        }
        // Looping report (gattling GattlingGunAttackLoop*): keep exactly one
        // loop per shooter instead of stacking a new infinite loop per shot.
        const existing = this.weaponLoopHandles.get(gameObject);
        if (existing) {
            if (existing.handle.isPlaying() && weapon.rules.report.includes(existing.soundName)) {
                return; // same gattling stage still firing: let the loop run
            }
            existing.handle.stop(); // stage changed: retire the old loop (plays its decay tail)
            this.weaponLoopHandles.delete(gameObject);
        }
        // Refuse to open more loops than can physically be audible.
        if (this.weaponLoopHandles.size >= SoundHandler.MAX_WEAPON_LOOPS) {
            return;
        }
        // Pass the game object itself so the loop follows the shooter and is
        // auto-stopped by WorldSound.handleObjectRemoved on death/removal.
        const handle = this.worldSound.playEffect(soundName, gameObject, gameObject.owner, volume);
        if (handle) {
            this.weaponLoopHandles.set(gameObject, { handle, soundName });
        }
    }
    private handleAresBountyAwardEvent(event: any): void {
        // Ares Bounty.Display surfaces the signed credit award as a combat
        // message. Retail shows floating text at the victim; the shared HUD
        // message channel is this engine's equivalent presentation path.
        // Awards keep the killer's house color, matching the shared-world
        // presentation of superweapon messages.
        const amount = event.amount as number;
        if (!amount) return;
        const killerColor: string | { color: { asHexString(): string } } =
            event.player?.color ?? event.player ?? 'grey';
        const label = amount > 0 ? 'TXT_BOUNTY_RECEIVED' : 'TXT_BOUNTY_LOST';
        const text = this.strings.has?.(label)
            ? this.strings.get(label, String(Math.abs(amount)))
            : `${amount > 0 ? '+' : ''}${amount}`;
        this.messageList.addSystemMessage(text, killerColor);
    }
    private handleAresIvanBombAttachSound(event: any): void {
        if (!event.soundName || !event.target?.position?.worldPosition) return;
        this.worldSound.playEffect(
            event.soundName,
            event.target.position.worldPosition,
            event.player,
        );
    }
    /** Stop looping weapon reports whose shooter is gone or disengaged. */
    private updateWeaponLoops(): void {
        for (const [gameObject, loop] of this.weaponLoopHandles) {
            if (!loop.handle.isPlaying()) {
                this.weaponLoopHandles.delete(gameObject);
                continue;
            }
            // Mirror GattlingTrait's engagement predicate.
            const attackTrait = gameObject.attackTrait;
            const currentTask = gameObject.unitOrderTrait?.getCurrentTask?.();
            const engaged = !gameObject.isDestroyed &&
                !gameObject.isCrashing &&
                !!attackTrait &&
                !attackTrait.isDisabled() &&
                ((!!currentTask && (currentTask as any)[Symbol.for("ra2.isAttackTask")] === true) ||
                    !attackTrait.isIdle() ||
                    !!attackTrait.opportunityFireTask);
            if (!engaged) {
                loop.handle.stop(); // AudioLoop.stop() plays the spin-down (decay) sound
                this.weaponLoopHandles.delete(gameObject);
            }
        }
    }
    private handleDamageSound(event: any): void {
        if (event.target.isBuilding() && !event.target.wallTrait) {
            const damagePercent = (event.damageHitPoints / event.target.healthTrait.maxHitPoints) * 100;
            const rules = this.game.rules.audioVisual;
            const redThreshold = 100 * rules.conditionRed;
            const yellowThreshold = 100 * rules.conditionYellow;
            const health = event.target.healthTrait.health;
            if ((health <= yellowThreshold && yellowThreshold < health + damagePercent) ||
                (health <= redThreshold && redThreshold < health + damagePercent)) {
                this.worldSound.playEffect(SoundKey.BuildingDamageSound, event.target, event.target.owner);
            }
        }
    }
    private handleRadarEventSound(event: any): void {
        if (event.radarEventType === RadarEventType.BaseUnderAttack || event.radarEventType === 'BaseUnderAttack') {
            if (event.target === this.player) {
                this.eva.play('EVA_OurBaseIsUnderAttack');
                this.sound.play(SoundKey.BaseUnderAttackSound, ChannelType.Effect);
            }
            else if (this.player && this.game.alliances.areAllied(this.player, event.target)) {
                this.eva.play('EVA_OurAllyIsUnderAttack');
                this.sound.play(SoundKey.BaseUnderAttackSound, ChannelType.Effect);
            }
        }
        else if (event.radarEventType === RadarEventType.HarvesterUnderAttack || event.radarEventType === 'HarvesterUnderAttack') {
            if (event.target === this.player) {
                this.eva.play('EVA_OreMinerUnderAttack');
            }
        }
        else if ((event.radarEventType === RadarEventType.EnemyObjectSensed || event.radarEventType === 'EnemyObjectSensed') && event.target === this.player) {
            const building = this.game.map.getGroundObjectsOnTile(event.tile).find((object: any) => object.isBuilding() && object.superWeaponTrait);
            const superWeapon = getAvailableBuildingSuperWeapon(building)?.superWeapon;
            const ares = event.metadata?.superWeaponRules?.ares ?? superWeapon?.rules?.ares;
            const customEva = ares
                ? resolveAresSuperWeaponEva(ares, "detected")
                : undefined;
            const eva = customEva !== undefined
                ? customEva ?? undefined
                : detectedSuperWeaponEvaByType.get(superWeapon?.rules?.type);
            if (eva) {
                this.eva.play(eva);
            }
            if (ares) {
                this.showAresSuperWeaponMessage(ares, "detected", event.metadata?.superWeaponOwner ?? superWeapon?.owner);
            }
        }
    }
    private handleSuperWeaponReadySound(event: any): void {
        const owner = event.target?.owner;
        if (owner === this.player) {
            const ares = event.target.rules?.ares;
            const customEva = ares
                ? resolveAresSuperWeaponEva(ares, "ready")
                : undefined;
            const eva = customEva !== undefined
                ? customEva ?? undefined
                : event.target.rules?.type !== undefined
                    ? superWeaponReadyEvaByType.get(event.target.rules.type)
                    : undefined;
            if (eva) {
                this.eva.play(eva);
            }
            if (ares) {
                this.showAresSuperWeaponMessage(ares, "ready", owner, true);
            }
        }
    }
    private handleSuperWeaponActivateSound(event: any): void {
        const ares = event.rules?.ares;
        if (!event.noSfxWarning) {
            const customEva = ares
                ? resolveAresSuperWeaponEva(ares, "activated")
                : undefined;
            const eva = customEva !== undefined
                ? customEva ?? undefined
                : superWeaponActivateEvaByType.get(event.target);
            if (eva) {
                this.eva.play(eva, true);
            }
            const sound = superWeaponActivateSoundByType.get(event.target);
            if (sound) {
                this.worldSound.playEffect(sound, Coords.tile3dToWorld(event.atTile.rx, event.atTile.ry, event.atTile.z), event.owner);
            }
            const activationSound = ares?.swActivationSound;
            if (activationSound && event.atTile) {
                this.worldSound.playEffect(
                    activationSound,
                    Coords.tile3dToWorld(event.atTile.rx, event.atTile.ry, event.atTile.z),
                    event.owner,
                );
            }
        }
        if (ares) {
            this.showAresSuperWeaponMessage(ares, "launch", event.owner);
        }
        const message = superWeaponActivateMessageByType.get(event.target);
        if (message) {
            this.messageList.addSystemMessage(this.strings.get(message), this.player ?? 'grey');
        }
    }
    private handleAresSuperWeaponEffectSound(event: any): void {
        const ares = event.rules?.ares;
        if (ares) {
            this.showAresSuperWeaponMessage(ares, "activate", event.owner);
        }
        if (event.noSfxWarning || !event.atTile) return;
        const sound = ares?.swSound;
        if (!sound) return;
        this.worldSound.playEffect(
            sound,
            Coords.tile3dToWorld(event.atTile.rx, event.atTile.ry, event.atTile.z ?? 0),
            event.owner,
        );
    }
    private showAresSuperWeaponMessage(
        rules: any,
        stage: "detected" | "ready" | "launch" | "activate" | "abort" | "insufficientFunds" | "cannotFire",
        owner: any,
        ownerOnly = false,
    ): void {
        if (ownerOnly && owner !== this.player) return;
        const label = resolveAresSuperWeaponMessage(rules, stage);
        if (!label) return;
        const colorOrPlayer = resolveAresSuperWeaponMessageColor(
            rules,
            owner,
            this.player ?? "grey",
        );
        this.messageList.addSystemMessage(this.strings.get(label), colorOrPlayer);
    }
    private handleAresSuperWeaponMessageEvent(event: any): void {
        // Ares failure messages are addressed to the firing house only.  The
        // simulation event is still shared so non-audio hosts can consume the
        // same authored message without duplicating launch validation.
        if (event.owner !== this.player) return;
        this.showAresSuperWeaponMessage(event.rules?.ares ?? event.rules, event.stage, event.owner, true);
    }
    private handleLightningStormManifestSound(event: any): void {
        this.messageList.addSystemMessage(this.strings.get('TXT_LIGHTNING_STORM'), this.player ?? 'grey');
        this.worldSound.playEffect(SoundKey.StormSound, Coords.tile3dToWorld(event.target.rx, event.target.ry, event.target.z));
    }
    private handleWarheadDetonateSound(event: any): void {
        if (event.isLightningStrike) {
            this.worldSound.playEffect(SoundKey.LightningSounds, event.position);
        }
    }
    private handleObjectDestroySound(event: any): void {
        const target = event.target;
        let sound: string | undefined;
        if (target.isTechno()) {
            sound = target.rules.dieSound;
            if (!sound && target.isBuilding()) {
                sound = SoundKey.BuildingDieSound as any;
            }
        }
        if (sound) {
            this.worldSound.playEffect(sound, target.position.worldPosition, target.owner);
        }
        if (target.isUnit() && !target.rules.spawned && target.owner === this.player) {
            this.eva.play('EVA_UnitLost');
        }
    }
    private handleObjectSpawnSound(event: any): void {
        const gameObject = event.gameObject;
        if (gameObject.isTechno() && gameObject.rules.createSound) {
            this.worldSound.playEffect(gameObject.rules.createSound, gameObject, gameObject.owner);
        }
    }
    private handleBuildingPlaceSound(event: any): void {
        const building = event.target;
        this.worldSound.playEffect(building.rules.slamSound || SoundKey.BuildingSlam, building, building.owner);
    }
    private handlePlayerDefeatedSound(event: any): void {
        const player = event.target;
        if (player === this.player && !this.player.isObserver) {
            return;
        }
        if (!player.resigned) {
            const playerName = player.isAi
                ? this.strings.get(aiUiNames.get(player.aiDifficulty) ?? 'GUI:AIDummy')
                : player.name;
            this.eva.play(player !== this.player ? 'EVA_PlayerDefeated' : 'EVA_YouHaveLost');
            this.messageList.addSystemMessage(this.strings.get('TXT_PLAYER_DEFEATED', playerName), player);
        }
    }
    private handleUnitPromoteSound(event: any): void {
        if (event.target.owner === this.player) {
            const isElite = event.target.veteranLevel === 'Elite';
            this.sound.play(isElite ? SoundKey.UpgradeEliteSound : SoundKey.UpgradeVeteranSound, ChannelType.Effect);
            this.eva.play('EVA_UnitPromoted', true);
        }
    }
    private handleCratePickupSound(event: any): void {
        const crateType = event.target?.type;
        let sound = crateSoundByType.get(crateType);
        if (!sound && crateType === PowerupType.HealBase) {
            sound = this.game.rules.crateRules.healCrateSound;
        }
        const eva = crateEvaByType.get(crateType);
        const isHostilePickup = this.player &&
            !this.player.isObserver &&
            event.player !== this.player &&
            !this.game.alliances.areAllied(event.player, this.player);
        if (isHostilePickup) {
            return;
        }
        if (sound) {
            const position = Coords.tile3dToWorld(event.tile.rx, event.tile.ry, event.tile.z);
            this.worldSound.playEffect(sound, position, event.player);
        }
        if (eva) {
            this.eva.play(eva);
        }
    }
    handleOrderPushed(unit: any, orderType: any, feedbackType: any): void {
        const now = Date.now();
        if (!this.lastFeedbackTime || now - this.lastFeedbackTime >= 250) {
            let sound: string | undefined;
            // feedbackType is the numeric OrderFeedbackType enum (the old string
            // cases here never matched, silencing all order acknowledgments).
            switch (feedbackType) {
                case OrderFeedbackType.Attack:
                    sound = unit.rules.voiceAttack;
                    break;
                case OrderFeedbackType.Move:
                    sound = unit.rules.voiceMove;
                    break;
                case OrderFeedbackType.Enter:
                    sound = unit.rules.voiceEnter || unit.rules.voiceMove;
                    break;
                case OrderFeedbackType.Capture:
                    sound = unit.rules.voiceCapture || unit.rules.voiceSpecialAttack;
                    break;
                case OrderFeedbackType.SpecialAttack:
                    sound = unit.rules.voiceSpecialAttack || unit.rules.voiceAttack;
                    break;
                case OrderFeedbackType.Repair:
                    // Ares VoiceIFVRepair takes precedence over VoiceAttack
                    // when an IFV is ordered to repair something; otherwise
                    // fall back to VoiceAttack as documented.
                    sound = unit.rules.ares?.ifv?.voiceIfvRepair ??
                        unit.rules.voiceAttack;
                    break;
            }
            if (sound) {
                this.sound.play(sound, ChannelType.Effect);
                this.lastFeedbackTime = now;
            }
        }
    }
    handleSelectionChangeEvent(event: any): void {
        if (event.selection.length && event.selection[0].owner === this.player) {
            const now = Date.now();
            const canPlayFeedback = !this.lastFeedbackTime || now - this.lastFeedbackTime >= 250;
            if (canPlayFeedback) {
                this.lastFeedbackTime = now;
                event.selection.forEach((unit: any) => {
                    if (unit.rules.voiceSelect) {
                        this.sound.play(unit.rules.voiceSelect, ChannelType.Effect);
                    }
                });
            }
        }
    }
}
