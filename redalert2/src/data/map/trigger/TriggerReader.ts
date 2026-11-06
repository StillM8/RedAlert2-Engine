import { TriggerEventType } from './TriggerEventType';
import { TriggerActionType } from './TriggerActionType';
import { IniSection } from '@/data/IniSection';
export class TriggerReader {
    read(triggers: IniSection, events: IniSection, actions: IniSection, tags: Array<any>) {
        const triggerList = this.readTriggers(triggers);
        const { events: eventMap, unknownEventTypes } = this.readEvents(events);
        const { actions: actionMap, unknownActionTypes } = this.readActions(actions);
        const tagList = [...tags.values?.() ?? tags];
        const rootTriggers = new Set(triggerList);
        for (const trigger of triggerList.values()) {
            const triggerEvents = eventMap.get(trigger.id);
            if (triggerEvents) {
                trigger.events.push(...triggerEvents);
            }
            const triggerActions = actionMap.get(trigger.id);
            if (triggerActions) {
                trigger.actions.push(...triggerActions);
            }
            if (trigger.attachedTriggerId) {
                const attachedReference = String(trigger.attachedTriggerId).toLocaleLowerCase("en-US");
                const attachedTrigger = triggerList.find(t =>
                    String(t.id).toLocaleLowerCase("en-US") === attachedReference ||
                    String(t.name).toLocaleLowerCase("en-US") === attachedReference);
                if (attachedTrigger) {
                    trigger.attachedTrigger = attachedTrigger;
                    rootTriggers.delete(attachedTrigger);
                }
            }
        }
        for (const rootTrigger of rootTriggers) {
            const rootId = String(rootTrigger.id).toLocaleLowerCase("en-US");
            const rootName = String(rootTrigger.name).toLocaleLowerCase("en-US");
            const tag = tagList.find(t => {
                const reference = String(t.triggerId).toLocaleLowerCase("en-US");
                return reference === rootId || reference === rootName;
            });
            if (tag) {
                let currentTrigger = rootTrigger;
                const seen = new Set<any>();
                while (currentTrigger && !seen.has(currentTrigger)) {
                    seen.add(currentTrigger);
                    currentTrigger.tag = tag;
                    currentTrigger = currentTrigger.attachedTrigger;
                }
            }
            else {
                let currentTrigger = rootTrigger;
                const seen = new Set<any>();
                while (currentTrigger && !seen.has(currentTrigger)) {
                    seen.add(currentTrigger);
                    console.warn(`Trigger ${currentTrigger.id} has no associated tag or valid root trigger. Skipping.`);
                    const index = triggerList.indexOf(currentTrigger);
                    if (index !== -1) {
                        triggerList.splice(index, 1);
                    }
                    currentTrigger = currentTrigger.attachedTrigger;
                }
            }
        }
        return {
            triggers: triggerList,
            unknownEventTypes,
            unknownActionTypes,
        };
    }
    private readTriggers(triggers: IniSection) {
        const result: any[] = [];
        for (const [id, raw] of triggers.entries) {
            if (typeof raw !== 'string')
                continue;
            const parts = raw.split(',');
            if (parts.length < 8) {
                console.warn(`Invalid trigger ${id}=${raw}. Skipping.`);
            }
            else {
                const trigger = {
                    id,
                    houseName: parts[0],
                    attachedTriggerId: parts[1].trim().toLocaleLowerCase("en-US") !== '<none>'
                        ? parts[1].trim()
                        : undefined,
                    attachedTrigger: undefined,
                    name: parts[2],
                    disabled: Boolean(Number(parts[3])),
                    difficulties: {
                        easy: Boolean(Number(parts[4])),
                        medium: Boolean(Number(parts[5])),
                        hard: Boolean(Number(parts[6])),
                    },
                    mustTransfer: Boolean(Number(parts[7])),
                    events: [],
                    actions: [],
                    tag: undefined,
                };
                result.push(trigger);
            }
        }
        return result;
    }
    private readEvents(events: IniSection) {
        const eventMap = new Map();
        const unknownTypes = new Set();
        for (const [triggerId, raw] of events.entries) {
            if (typeof raw !== 'string')
                continue;
            const parts = raw.split(',');
            if (parts.length < 4) {
                console.warn(`Invalid event ${triggerId}=${raw}. Skipping.`);
            }
            else {
                const eventCount = Number(parts.shift());
                const eventList = [];
                for (let i = 0; i < eventCount; i++) {
                    const type = Number(parts.shift());
                    const paramCount = Number(parts.shift());
                    const params = parts.splice(0, paramCount === 2 ? 2 : 1);
                    if (TriggerEventType[type] !== undefined) {
                        const event = {
                            triggerId,
                            eventIndex: i,
                            type,
                            params: [paramCount, ...params.map(p => p || '0')],
                        };
                        eventList.push(event);
                    }
                    else {
                        unknownTypes.add(type);
                        console.warn(`Unknown event type ${type} for trigger id ${triggerId}. Skipping.`);
                    }
                }
                eventMap.set(triggerId, eventList);
            }
        }
        return { events: eventMap, unknownEventTypes: unknownTypes };
    }
    private readActions(actions: IniSection) {
        const actionMap = new Map();
        const unknownTypes = new Set();
        for (const [triggerId, raw] of actions.entries) {
            if (typeof raw !== 'string')
                continue;
            const parts = raw.split(',');
            if (parts.length < 9) {
                console.warn(`Invalid action ${triggerId}=${raw}. Skipping.`);
            }
            else {
                const actionCount = Number(parts.shift());
                if (parts.length < 8 * actionCount) {
                    console.warn(`Invalid action ${triggerId}=${raw}. Skipping.`);
                }
                else {
                    const actionList = [];
                    for (let i = 0; i < actionCount; i++) {
                        const type = Number(parts.shift());
                        const params = parts.splice(0, 7);
                        if (TriggerActionType[type] !== undefined) {
                            const action = {
                                triggerId,
                                index: i,
                                type,
                                params: [
                                    Number(params[0] || '0'),
                                    params[1] || '0',
                                    params[2] || '0',
                                    params[3] || '0',
                                    params[4] || '0',
                                    params[5] || '0',
                                    params[6] || type === TriggerActionType.SetObjectTechLevel
                                        ? this.readActionP7(params[6], type)
                                        : 0,
                                ],
                            };
                            actionList.push(action);
                        }
                        else {
                            unknownTypes.add(type);
                            console.warn(`Unknown action type ${type} for trigger id "${triggerId}". Skipping.`);
                        }
                    }
                    actionMap.set(triggerId, actionList);
                }
            }
        }
        return { actions: actionMap, unknownActionTypes: unknownTypes };
    }
    private readActionP7(param: string | undefined, actionType: number): number {
        const strict = actionType === TriggerActionType.SetObjectTechLevel;
        const value = param?.trim() ?? "";
        if (/^[+-]?\d+$/.test(value)) {
            const numeric = Number(value);
            if (Number.isSafeInteger(numeric) && (!strict || numeric >= -1)) {
                return numeric;
            }
            if (strict) {
                throw new Error(`Invalid P7 tech level: ${param}`);
            }
            return 0;
        }
        if (!/^[A-Z]+$/i.test(value)) {
            if (strict) {
                throw new Error(`Invalid P7 tech level: ${param}`);
            }
            return 0;
        }
        let column = 0;
        for (const character of value.toUpperCase()) {
            column = column * 26 + character.charCodeAt(0) - 'A'.charCodeAt(0) + 1;
        }
        const decoded = column - 1;
        if (!Number.isSafeInteger(decoded)) {
            if (strict) {
                throw new Error(`Invalid P7 tech level: ${param}`);
            }
            return 0;
        }
        return decoded;
    }
}
