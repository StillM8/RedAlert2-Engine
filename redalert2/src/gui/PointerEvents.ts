import { CompositeDisposable } from '../util/disposable/CompositeDisposable';
import { equals } from '../util/array';
import { clamp } from '../util/math';
import * as THREE from 'three';
interface PointerPosition {
    x: number;
    y: number;
}
interface CanvasMetrics {
    x: number;
    y: number;
    width: number;
    height: number;
    toCanvasPosition(pageX: number, pageY: number): PointerPosition;
    toCanvasClientPosition(clientX: number, clientY: number): PointerPosition;
    toCanvasOffset(offsetX: number, offsetY: number): PointerPosition;
}
interface LockModePointer {
    x: number;
    y: number;
}
interface Renderer {
    getCanvas(): HTMLCanvasElement;
    getScenes(): Scene[];
}
interface Scene {
    get3DObject(): THREE.Object3D;
    scene: THREE.Scene;
    camera: THREE.Camera;
    viewport: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
}
interface TouchStartBuffer {
    cb: () => void;
    timeoutId: number;
}
interface FakeMouseEvent extends Partial<MouseEvent> {
    offsetX: number;
    offsetY: number;
    button: number;
    isTouch: boolean;
    detail: number;
    altKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
    timeStamp: number;
    touchDuration?: number;
    /** Set when a gesture is aborted (touchcancel / finger-count change): the
     * synthetic mouseup must release state but never execute a click action. */
    cancelled?: boolean;
    deltaY?: number;
}
interface PointerEventData {
    type: string;
    target?: THREE.Object3D;
    pointer: PointerPosition;
    intersection?: THREE.Intersection;
    button: number;
    isTouch: boolean;
    touchDuration?: number;
    cancelled?: boolean;
    clicks: number;
    altKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
    timeStamp: number;
    wheelDeltaY: number;
    stopPropagation: () => void;
}
interface EventHandler {
    callback: (event: PointerEventData) => void;
    useCapture: boolean;
}
interface EventContext {
    handlers: Map<string, EventHandler[]>;
}
function isVisibleInScene(obj: THREE.Object3D, sceneRoot: THREE.Object3D): boolean {
    return !!obj.visible && (obj === sceneRoot || (!!obj.parent && isVisibleInScene(obj.parent, sceneRoot)));
}
export class PointerEvents {
    private renderer: Renderer;
    private lockModePointer: LockModePointer;
    private document: Document;
    private canvasMetrics: CanvasMetrics;
    private canvas: HTMLCanvasElement;
    private disposables: CompositeDisposable;
    private canvasContext: EventContext;
    private objectContexts: Map<THREE.Object3D, EventContext>;
    private intersectionsEnabled: boolean;
    private clickPaths: Map<number, THREE.Object3D[]>;
    private touchFingers: number;
    private currentHoverPath?: THREE.Object3D[];
    private initialTouchEvent?: TouchEvent;
    private touchStartBuffer?: TouchStartBuffer;
    private primaryTouchId?: number;
    private singleTouchDownSent = false;
    private lastSingleTouchPos?: PointerPosition;
    private twoFingerActive = false;
    private lastCentroid?: PointerPosition;
    private lastPinchDist?: number;
    private pinchAccum = 0;
    /** After a two-finger gesture ends with one finger still down, that finger
     * stays inert until lifted so it can't issue accidental orders. */
    private gestureConsumed = false;
    /** True while a gesture began in the small safe-area strip outside the
     * transformed canvas. Android delivers those touches to BODY, so without
     * this bridge they never enter the RTS gesture engine. */
    private edgeTouchActive = false;
    setIntersectionsEnabled(enabled: boolean): void {
        this.intersectionsEnabled = enabled;
    }
    constructor(renderer: Renderer, lockModePointer: LockModePointer, document: Document, canvasMetrics: CanvasMetrics) {
        this.renderer = renderer;
        this.lockModePointer = lockModePointer;
        this.document = document;
        this.canvasMetrics = canvasMetrics;
        this.disposables = new CompositeDisposable();
        this.canvasContext = { handlers: new Map() };
        this.objectContexts = new Map();
        this.intersectionsEnabled = true;
        this.clickPaths = new Map();
        this.touchFingers = 0;
        const canvas = renderer.getCanvas();
        this.canvas = canvas;
        canvas.addEventListener('dblclick', this.onDblClick, false);
        canvas.addEventListener('mousemove', this.onMouseMove, false);
        canvas.addEventListener('mousedown', this.onMouseDown, false);
        canvas.addEventListener('mouseup', this.onMouseUp, false);
        canvas.addEventListener('touchmove', this.onTouchMove, false);
        canvas.addEventListener('touchstart', this.onTouchStart, false);
        canvas.addEventListener('touchend', this.onTouchEnd, false);
        canvas.addEventListener('touchcancel', this.onTouchCancel, false);
        canvas.addEventListener('wheel', this.onMouseWheel, { passive: true });
        // The Android shell reserves a side safe-area inset. The transformed
        // root starts after that inset, which means a one-finger tap on the
        // physical edge targets BODY instead of the canvas. Listen during
        // capture only for touches that really began outside the app root;
        // HTML menu controls and ordinary canvas touches keep their existing
        // native/event paths.
        this.document.addEventListener('touchstart', this.onEdgeTouchStart, { capture: true, passive: false });
        this.document.addEventListener('touchmove', this.onEdgeTouchMove, { capture: true, passive: false });
        this.document.addEventListener('touchend', this.onEdgeTouchEnd, { capture: true, passive: false });
        this.document.addEventListener('touchcancel', this.onEdgeTouchCancel, { capture: true, passive: false });
        this.disposables.add(() => {
            canvas.removeEventListener('dblclick', this.onDblClick, false);
            canvas.removeEventListener('mousemove', this.onMouseMove, false);
            canvas.removeEventListener('mousedown', this.onMouseDown, false);
            canvas.removeEventListener('mouseup', this.onMouseUp, false);
            canvas.removeEventListener('touchmove', this.onTouchMove, false);
            canvas.removeEventListener('touchstart', this.onTouchStart, false);
            canvas.removeEventListener('touchend', this.onTouchEnd, false);
            canvas.removeEventListener('touchcancel', this.onTouchCancel, false);
            canvas.removeEventListener('wheel', this.onMouseWheel, false);
            this.document.removeEventListener('touchstart', this.onEdgeTouchStart, true);
            this.document.removeEventListener('touchmove', this.onEdgeTouchMove, true);
            this.document.removeEventListener('touchend', this.onEdgeTouchEnd, true);
            this.document.removeEventListener('touchcancel', this.onEdgeTouchCancel, true);
            this.edgeTouchActive = false;
        });
    }
    private onDblClick = (event: MouseEvent): void => {
        if (event.button === 0) {
            this.onMouseEvent('dblclick', event);
        }
    };
    private onMouseMove = (event: MouseEvent): void => {
        const pointerPos = this.getPointerPosition(event);
        if (this.intersectionsEnabled) {
            const previousHoverPath = this.currentHoverPath ? [...this.currentHoverPath] : undefined;
            const previousTarget = previousHoverPath?.[0];
            const intersection = this.findObjectUnderPointer(pointerPos);
            const currentTarget = intersection?.object;
            this.currentHoverPath = undefined;
            if (currentTarget) {
                this.currentHoverPath = [currentTarget];
                currentTarget.traverseAncestors((ancestor) => {
                    this.currentHoverPath!.push(ancestor);
                });
            }
            if (!equals(this.currentHoverPath ?? [], previousHoverPath ?? [])) {
                if (previousHoverPath) {
                    for (const obj of previousHoverPath) {
                        if (!(this.currentHoverPath && this.currentHoverPath.includes(obj))) {
                            this.notify('mouseleave', obj, pointerPos, event, undefined, false);
                        }
                    }
                }
                if (this.currentHoverPath) {
                    for (const obj of this.currentHoverPath) {
                        if (!(previousHoverPath && previousHoverPath.includes(obj))) {
                            this.notify('mouseenter', obj, pointerPos, event, intersection, false);
                        }
                    }
                }
                if (previousTarget) {
                    this.notify('mouseout', previousTarget, pointerPos, event);
                }
                if (currentTarget) {
                    this.notify('mouseover', currentTarget, pointerPos, event, intersection);
                }
            }
            if (currentTarget) {
                this.notify('mousemove', currentTarget, pointerPos, event, intersection);
            }
            else {
                this.renderer.getScenes().forEach((scene) => {
                    this.notify('mousemove', scene.get3DObject(), pointerPos, event);
                });
            }
        }
        this.notify('mousemove', 'canvas', pointerPos, event);
    };
    private onMouseDown = (event: MouseEvent): void => {
        this.onMouseEvent('mousedown', event);
    };
    private onMouseUp = (event: MouseEvent): void => {
        this.onMouseEvent('mouseup', event);
    };
    private onMouseWheel = (event: WheelEvent): void => {
        this.onMouseEvent('wheel', event);
    };
    private isTouchOutsideRoot(event: TouchEvent): boolean {
        const root = this.canvas.closest('#ra2web-root');
        const target = event.target;
        return !!root && !(target instanceof Node && root.contains(target));
    };
    private onEdgeTouchStart = (event: TouchEvent): void => {
        if (!this.isTouchOutsideRoot(event)) {
            return;
        }
        this.edgeTouchActive = true;
        this.onTouchStart(event);
    };
    private onEdgeTouchMove = (event: TouchEvent): void => {
        if (this.edgeTouchActive) {
            this.onTouchMove(event);
        }
    };
    private onEdgeTouchEnd = (event: TouchEvent): void => {
        if (!this.edgeTouchActive) {
            return;
        }
        this.onTouchEnd(event);
        if (event.touches.length === 0) {
            this.edgeTouchActive = false;
        }
    };
    private onEdgeTouchCancel = (event: TouchEvent): void => {
        if (!this.edgeTouchActive) {
            return;
        }
        this.onTouchCancel(event);
        this.edgeTouchActive = false;
    };
    // --- Touch gesture engine (Generals-style RTS semantics) ---
    // 1 finger: tap = left click, drag = left drag (box select / UI).
    // 2 fingers: drag = right-drag camera pan (map grab), pinch = zoom,
    //            quick tap = right click (deselect).
    // Aborted gestures (touchcancel, finger-count changes) release state with a
    // `cancelled` mouseup that never executes a click.
    private static readonly PINCH_STEP_PX = 40;
    private resetTouchState(): void {
        if (this.touchStartBuffer) {
            clearTimeout(this.touchStartBuffer.timeoutId);
            this.touchStartBuffer = undefined;
        }
        this.touchFingers = 0;
        this.initialTouchEvent = undefined;
        this.primaryTouchId = undefined;
        this.singleTouchDownSent = false;
        this.lastSingleTouchPos = undefined;
        this.twoFingerActive = false;
        this.lastCentroid = undefined;
        this.lastPinchDist = undefined;
        this.pinchAccum = 0;
        this.gestureConsumed = false;
    }
    private touchCentroid(touches: TouchList): PointerPosition {
        let x = 0;
        let y = 0;
        for (let i = 0; i < touches.length; i++) {
            const pos = this.computeTouchPosition(touches[i]);
            x += pos.x;
            y += pos.y;
        }
        return { x: x / touches.length, y: y / touches.length };
    }
    private static touchDistance(touches: TouchList): number {
        const dx = touches[0].pageX - touches[1].pageX;
        const dy = touches[0].pageY - touches[1].pageY;
        return Math.sqrt(dx * dx + dy * dy);
    }
    private findTrackedTouch(touches: TouchList): Touch | undefined {
        for (let i = 0; i < touches.length; i++) {
            if (touches[i].identifier === this.primaryTouchId) {
                return touches[i];
            }
        }
        return undefined;
    }
    private onTouchStart = (event: TouchEvent): void => {
        event.preventDefault();
        const touches = event.touches;
        if (touches.length === 1) {
            this.resetTouchState();
            this.primaryTouchId = touches[0].identifier;
            this.initialTouchEvent = event;
            this.lastSingleTouchPos = this.computeTouchPosition(touches[0]);
            const callback = () => {
                this.touchStartBuffer = undefined;
                this.touchFingers = 1;
                this.singleTouchDownSent = true;
                const fakeEvent = this.fakeMouseEventFromTouch(touches[0], event, 0);
                this.onMouseEvent('mousedown', fakeEvent as unknown as MouseEvent);
            };
            // Short buffer so a second finger can upgrade the gesture before any
            // left-button state is committed.
            const timeoutId = setTimeout(callback, 50);
            this.touchStartBuffer = { cb: callback, timeoutId };
        }
        else if (touches.length === 2 && !this.twoFingerActive && !this.gestureConsumed) {
            if (this.touchStartBuffer) {
                clearTimeout(this.touchStartBuffer.timeoutId);
                this.touchStartBuffer = undefined;
            }
            if (this.singleTouchDownSent) {
                // A left-down already went out; release it without a click.
                const cancelEvent = this.fakeMouseEventAt(this.lastSingleTouchPos!, event, 0);
                cancelEvent.cancelled = true;
                this.onMouseEvent('mouseup', cancelEvent as unknown as MouseEvent);
                this.singleTouchDownSent = false;
            }
            this.twoFingerActive = true;
            this.touchFingers = 2;
            this.initialTouchEvent ||= event;
            this.lastCentroid = this.touchCentroid(touches);
            this.lastPinchDist = PointerEvents.touchDistance(touches);
            this.pinchAccum = 0;
            const fakeEvent = this.fakeMouseEventAt(this.lastCentroid, event, 2);
            this.onMouseEvent('mousedown', fakeEvent as unknown as MouseEvent);
        }
    };
    private onTouchMove = (event: TouchEvent): void => {
        event.preventDefault();
        if (this.twoFingerActive) {
            const touches = event.touches;
            if (touches.length < 2) {
                return;
            }
            this.lastCentroid = this.touchCentroid(touches);
            const moveEvent = this.fakeMouseEventAt(this.lastCentroid, event, 2);
            this.onMouseMove(moveEvent as unknown as MouseEvent);
            const dist = PointerEvents.touchDistance(touches);
            if (this.lastPinchDist !== undefined) {
                this.pinchAccum += dist - this.lastPinchDist;
                while (Math.abs(this.pinchAccum) >= PointerEvents.PINCH_STEP_PX) {
                    const direction = Math.sign(this.pinchAccum);
                    this.pinchAccum -= direction * PointerEvents.PINCH_STEP_PX;
                    const wheelEvent = this.fakeMouseEventAt(this.lastCentroid, event, 0);
                    // Fingers apart = zoom in = negative deltaY (wheel-up convention).
                    wheelEvent.deltaY = -direction * 120;
                    this.onMouseEvent('wheel', wheelEvent as unknown as MouseEvent);
                }
            }
            this.lastPinchDist = dist;
            return;
        }
        if (this.gestureConsumed || this.primaryTouchId === undefined) {
            return;
        }
        const tracked = this.findTrackedTouch(event.changedTouches);
        if (!tracked) {
            return;
        }
        if (this.touchStartBuffer) {
            clearTimeout(this.touchStartBuffer.timeoutId);
            this.touchStartBuffer.cb();
            this.touchStartBuffer = undefined;
        }
        this.lastSingleTouchPos = this.computeTouchPosition(tracked);
        const fakeEvent = this.fakeMouseEventFromTouch(tracked, event, 0);
        this.onMouseMove(fakeEvent as unknown as MouseEvent);
    };
    private onTouchEnd = (event: TouchEvent): void => {
        event.preventDefault();
        if (this.twoFingerActive) {
            if (event.touches.length < 2) {
                const upEvent = this.fakeMouseEventAt(this.lastCentroid!, event, 2);
                upEvent.touchDuration = event.timeStamp - (this.initialTouchEvent?.timeStamp ?? event.timeStamp);
                this.onMouseEvent('mouseup', upEvent as unknown as MouseEvent);
                if (event.touches.length > 0) {
                    // A finger remains; keep it inert until everything lifts.
                    this.twoFingerActive = false;
                    this.lastPinchDist = undefined;
                    this.gestureConsumed = true;
                }
                else {
                    this.resetTouchState();
                }
            }
            return;
        }
        if (this.gestureConsumed) {
            if (event.touches.length === 0) {
                this.resetTouchState();
            }
            return;
        }
        if (this.primaryTouchId === undefined) {
            return;
        }
        const ended = this.findTrackedTouch(event.changedTouches);
        if (!ended) {
            return;
        }
        if (this.touchStartBuffer) {
            clearTimeout(this.touchStartBuffer.timeoutId);
            this.touchStartBuffer.cb();
            this.touchStartBuffer = undefined;
        }
        const fakeEvent = this.fakeMouseEventFromTouch(ended, event, 0);
        fakeEvent.touchDuration = event.timeStamp - (this.initialTouchEvent?.timeStamp ?? event.timeStamp);
        this.resetTouchState();
        this.onMouseEvent('mouseup', fakeEvent as unknown as MouseEvent);
    };
    private onTouchCancel = (event: TouchEvent): void => {
        if (this.twoFingerActive && this.lastCentroid) {
            const upEvent = this.fakeMouseEventAt(this.lastCentroid, event, 2);
            upEvent.cancelled = true;
            this.onMouseEvent('mouseup', upEvent as unknown as MouseEvent);
        }
        else if (this.singleTouchDownSent && this.lastSingleTouchPos) {
            const upEvent = this.fakeMouseEventAt(this.lastSingleTouchPos, event, 0);
            upEvent.cancelled = true;
            this.onMouseEvent('mouseup', upEvent as unknown as MouseEvent);
        }
        this.resetTouchState();
    };
    addEventListener(target: THREE.Object3D | 'canvas', eventType: string, callback: (event: PointerEventData) => void, useCapture: boolean = false): () => void {
        const context = target === 'canvas'
            ? this.canvasContext
            : this.getOrCreateObjectContext(target);
        let handlers = context.handlers.get(eventType);
        if (!handlers) {
            handlers = [];
            context.handlers.set(eventType, handlers);
        }
        handlers.push({ callback, useCapture });
        return () => this.removeEventListener(target, eventType, callback, useCapture);
    }
    removeEventListener(target: THREE.Object3D | 'canvas', eventType: string, callback: (event: PointerEventData) => void, useCapture: boolean = false): void {
        const context = target === 'canvas'
            ? this.canvasContext
            : this.objectContexts.get(target as THREE.Object3D);
        if (context && context.handlers.has(eventType)) {
            let handlers = context.handlers.get(eventType)!;
            handlers = handlers.filter((handler) => !(handler.callback === callback && handler.useCapture === useCapture));
            if (handlers.length) {
                context.handlers.set(eventType, handlers);
            }
            else {
                context.handlers.delete(eventType);
            }
            if (!context.handlers.size && target !== 'canvas') {
                this.objectContexts.delete(target as THREE.Object3D);
            }
        }
    }
    private getOrCreateObjectContext(obj: THREE.Object3D): EventContext {
        if (!obj) {
            throw new Error('Undefined Object3D instance.');
        }
        let context = this.objectContexts.get(obj);
        if (!context) {
            context = { handlers: new Map() };
            this.objectContexts.set(obj, context);
        }
        return context;
    }
    private fakeMouseEventFromTouch(touch: Touch, event: TouchEvent, button: number = 0): FakeMouseEvent {
        return this.fakeMouseEventAt(this.computeTouchPosition(touch), event, button);
    }
    private fakeMouseEventAt(position: PointerPosition, event: TouchEvent, button: number): FakeMouseEvent {
        return {
            offsetX: position.x,
            offsetY: position.y,
            button,
            isTouch: true,
            detail: 1,
            altKey: event.altKey,
            ctrlKey: event.ctrlKey,
            metaKey: event.metaKey,
            shiftKey: event.shiftKey,
            timeStamp: event.timeStamp,
        };
    }
    private computeTouchPosition(touch: Touch): PointerPosition {
        // clientX/clientY and getBoundingClientRect() share the same viewport
        // coordinate space. pageX/pageY can include a WebView/document offset
        // when Android applies or removes display-cutout insets.
        let position = this.canvasMetrics.toCanvasClientPosition(touch.clientX, touch.clientY);
        position.x = clamp(position.x, 0, this.canvasMetrics.width - 1);
        position.y = clamp(position.y, 0, this.canvasMetrics.height - 1);
        return position;
    }
    private onMouseEvent(eventType: string, event: MouseEvent | WheelEvent): void {
        const pointerPos = this.getPointerPosition(event);
        const intersection = this.findObjectUnderPointer(pointerPos);
        if (intersection) {
            this.notify(eventType, intersection.object, pointerPos, event, intersection);
        }
        else {
            this.renderer.getScenes().forEach((scene) => {
                this.notify(eventType, scene.get3DObject(), pointerPos, event);
            });
        }
        this.notify(eventType, 'canvas', pointerPos, event);
        if (eventType === 'mousedown' || eventType === 'mouseup') {
            const targetObj = intersection?.object;
            let clickPath: THREE.Object3D[] = [];
            if (targetObj) {
                clickPath = [targetObj];
                targetObj.traverseAncestors((ancestor) => {
                    clickPath.push(ancestor);
                });
            }
            if (eventType === 'mousedown') {
                this.clickPaths.set((event as MouseEvent).button, clickPath);
            }
            else {
                const downPath = this.clickPaths.get((event as MouseEvent).button);
                this.clickPaths.delete((event as MouseEvent).button);
                let clickHandled = false;
                for (const obj of clickPath) {
                    if (downPath?.includes(obj)) {
                        this.notify('click', obj, pointerPos, event, intersection);
                        clickHandled = true;
                        break;
                    }
                }
                if (!clickHandled) {
                    this.renderer.getScenes().forEach((scene) => {
                        this.notify('click', scene.get3DObject(), pointerPos, event);
                    });
                    this.notify('click', 'canvas', pointerPos, event);
                }
            }
        }
    }
    private getPointerPosition(event: MouseEvent | WheelEvent): PointerPosition {
        if (this.document.pointerLockElement) {
            return this.lockModePointer;
        }
        if ((event as unknown as FakeMouseEvent).isTouch) {
            return { x: (event as MouseEvent).offsetX, y: (event as MouseEvent).offsetY };
        }
        const clientX = (event as MouseEvent).clientX;
        const clientY = (event as MouseEvent).clientY;
        if (Number.isFinite(clientX) && Number.isFinite(clientY)) {
            return this.canvasMetrics.toCanvasClientPosition(clientX, clientY);
        }
        return this.canvasMetrics.toCanvasOffset((event as MouseEvent).offsetX, (event as MouseEvent).offsetY);
    }
    private findObjectUnderPointer(pointerPos: PointerPosition): THREE.Intersection | undefined {
        const scenes = this.renderer.getScenes();
        const objectsByScene = this.groupObjectsByScene();
        for (let i = scenes.length - 1; i >= 0; i--) {
            const raycaster = new THREE.Raycaster();
            const normalizedPointer = this.normalizePointer(pointerPos, scenes[i].viewport);
            raycaster.setFromCamera(normalizedPointer, scenes[i].camera);
            raycaster.layers.enable(1);
            const sceneObjects = objectsByScene
                .get(scenes[i].scene)!
                .filter((obj) => isVisibleInScene(obj, scenes[i].get3DObject()));
            const intersections = raycaster.intersectObjects(sceneObjects, true);
            if (intersections.length) {
                if (intersections.length === 1)
                    return intersections[0];
                const objectSet = new Set(intersections.map((intersection) => intersection.object));
                intersections.forEach((intersection) => {
                    if (objectSet.has(intersection.object)) {
                        intersection.object.traverseAncestors((ancestor) => {
                            if (objectSet.has(ancestor)) {
                                objectSet.delete(ancestor);
                            }
                        });
                    }
                });
                return intersections.filter((intersection) => objectSet.has(intersection.object))[0];
            }
        }
        return undefined;
    }
    private normalizePointer(pointerPos: PointerPosition, viewport: Scene['viewport']): THREE.Vector2 {
        return new THREE.Vector2(((pointerPos.x - viewport.x) / viewport.width) * 2 - 1, -((pointerPos.y - viewport.y) / viewport.height) * 2 + 1);
    }
    private groupObjectsByScene(): Map<THREE.Scene, THREE.Object3D[]> {
        const objectsByScene = new Map<THREE.Scene, THREE.Object3D[]>();
        this.renderer.getScenes().forEach((scene) => {
            objectsByScene.set(scene.get3DObject() as THREE.Scene, []);
        });
        [...this.objectContexts.keys()].forEach((obj) => {
            if (obj.type !== 'Scene') {
                let root = obj;
                while (root.parent) {
                    root = root.parent;
                }
                if (root.type === 'Scene') {
                    objectsByScene.get(root as THREE.Scene)!.push(obj);
                }
            }
        });
        return objectsByScene;
    }
    private notify(eventType: string, target: THREE.Object3D | 'canvas', pointerPos: PointerPosition, originalEvent: Event, intersection?: THREE.Intersection, bubble: boolean = true): void {
        const context = target === 'canvas'
            ? this.canvasContext
            : this.objectContexts.get(target as THREE.Object3D);
        const handlers = context?.handlers.get(eventType);
        if (!(handlers && handlers.length)) {
            if (target !== 'canvas' && (target as THREE.Object3D).parent && bubble) {
                this.notify(eventType, (target as THREE.Object3D).parent!, pointerPos, originalEvent, intersection);
            }
            return;
        }
        handlers.forEach((handler) => {
            let shouldContinueBubbling = true;
            const eventData: PointerEventData = {
                type: eventType,
                target: target !== 'canvas' ? (target as THREE.Object3D) : undefined,
                pointer: { ...pointerPos },
                intersection,
                button: (originalEvent as MouseEvent).button || 0,
                isTouch: !!(originalEvent as any).isTouch,
                touchDuration: (originalEvent as any).touchDuration,
                cancelled: !!(originalEvent as any).cancelled,
                clicks: (originalEvent as MouseEvent).detail || 1,
                altKey: (originalEvent as KeyboardEvent).altKey || false,
                ctrlKey: (originalEvent as KeyboardEvent).ctrlKey || false,
                metaKey: (originalEvent as KeyboardEvent).metaKey || false,
                shiftKey: (originalEvent as KeyboardEvent).shiftKey || false,
                timeStamp: originalEvent.timeStamp,
                wheelDeltaY: (originalEvent as WheelEvent).deltaY ?? 0,
                stopPropagation: () => {
                    shouldContinueBubbling = false;
                },
            };
            handler.callback(eventData);
            if (shouldContinueBubbling && target !== 'canvas' && !handler.useCapture &&
                (target as THREE.Object3D).parent && bubble) {
                this.notify(eventType, (target as THREE.Object3D).parent!, pointerPos, originalEvent, intersection);
            }
        });
    }
    dispose(): void {
        if (this.touchStartBuffer) {
            clearTimeout(this.touchStartBuffer.timeoutId);
            this.touchStartBuffer = undefined;
        }
        this.disposables.dispose();
    }
}
