import { Expand, isDefined, isNotNull, Mode, typeOrUndefined } from "../utils"
import * as t from "io-ts"
import { GRID_STEP, inRect } from "../drawutils"
import { mode, setCanvasNeedsRedraw } from "../simulator"
import { ModifierObject } from "../htmlgen"

export interface DrawContext {
    isMouseOver: boolean
    inNonTransformedFrame(f: (ctx: DrawContextExt) => unknown): void
}

export interface DrawContextExt extends DrawContext {
    rotatePoint(x: number, y: number): readonly [x: number, y: number]
}

class _DrawContextImpl implements DrawContext, DrawContextExt {

    private readonly entranceTransform: DOMMatrix
    private readonly componentTransform: DOMMatrix

    constructor(
        private comp: Drawable,
        private g: CanvasRenderingContext2D,
        public readonly isMouseOver: boolean,
    ) {
        this.entranceTransform = g.getTransform()
        comp.applyDrawTransform(g)
        this.componentTransform = g.getTransform()
    }

    exit() {
        this.g.setTransform(this.entranceTransform)
    }

    inNonTransformedFrame(f: (ctx: DrawContextExt) => unknown) {
        this.g.setTransform(this.entranceTransform)
        f(this)
        this.g.setTransform(this.componentTransform)
    }

    rotatePoint(x: number, y: number): readonly [x: number, y: number] {
        const t1 = this.componentTransform
        const t2 = this.entranceTransform.inverse()
        return mult(t2, ...mult(t1, x, y))
    }

}

function mult(m: DOMMatrix, x: number, y: number): [x: number, y: number] {
    return [
        m.a * x + m.c * y + m.e,
        m.b * x + m.d * y + m.f,
    ]
}

export abstract class Drawable {

    protected constructor() {
        this.setNeedsRedraw("newly created")
    }

    protected setNeedsRedraw(reason: string) {
        setCanvasNeedsRedraw(this.constructor.name + " – " + reason)
    }

    public draw(g: CanvasRenderingContext2D, mouseOverComp: Drawable | null) {
        const ctx = new _DrawContextImpl(this, g, this === mouseOverComp)
        this.doDraw(g, ctx)
        ctx.exit()
    }

    public applyDrawTransform(__g: CanvasRenderingContext2D) {
        // by default, do nothing
    }

    protected abstract doDraw(g: CanvasRenderingContext2D, ctx: DrawContext): void

    public abstract isOver(x: number, y: number): boolean

    public get cursorWhenMouseover(): string | undefined {
        return undefined
    }

    toString(): string {
        return `${this.constructor.name}(${this.toStringDetails()})`
    }

    protected toStringDetails(): string {
        return ""
    }

    public makeTooltip(): ModifierObject | undefined {
        return undefined
    }

    // Return { lockMouseOver: true } (default) to signal the component
    // wants to get all mouseDragged and the final mouseUp event. Useful to
    // return false to allow drag destinations to get a mouseUp
    public mouseDown(__: MouseEvent | TouchEvent): { lockMouseOver: boolean } {
        // empty default implementation
        return { lockMouseOver: true }
    }

    public mouseDragged(__: MouseEvent | TouchEvent) {
        // empty default implementation
    }

    public mouseUp(__: MouseEvent | TouchEvent) {
        // empty default implementation
    }

    // Return true to indicate it was handled and had an effect
    // (and presumably doesn't need to be handled any more)
    public mouseDoubleClick(__: MouseEvent | TouchEvent): boolean {
        // empty default implementation
        return false
    }

}


// implemented by components with no array to hold the members
// for direct access for performance
export interface HasPosition {

    readonly posX: number
    readonly posY: number

}

export const Orientations = {
    "e": null,
    "s": null,
    "w": null,
    "n": null,
} as const

export type Orientation = keyof typeof Orientations

export function isOrientationVertical(orient: Orientation): orient is "s" | "n" {
    return orient === "s" || orient === "n"
}


// for compact JSON repr, pos is an array
export const PositionSupportRepr = t.type({
    pos: t.readonly(t.tuple([t.number, t.number])),
    orient: typeOrUndefined(t.keyof(Orientations)),
})

export type PositionSupportRepr = Expand<t.TypeOf<typeof PositionSupportRepr>>


export const DEFAULT_ORIENTATION: Orientation = "e"

export abstract class DrawableWithPosition extends Drawable implements HasPosition {

    private _posX: number
    private _posY: number
    private _orient: Orientation

    protected constructor(savedData: PositionSupportRepr | null) {
        super()

        // using null and not undefined to prevent subclasses from
        // unintentionally skipping the parameter

        if (isNotNull(savedData)) {
            // restoring from saved object
            this._posX = savedData.pos[0]
            this._posY = savedData.pos[1]
            this._orient = savedData.orient ?? DEFAULT_ORIENTATION
        } else {
            // creating new object
            this._posX = Math.max(0, mouseX)
            this._posY = mouseY
            this._orient = DEFAULT_ORIENTATION
        }
    }

    public get posX() {
        return this._posX
    }

    public get posY() {
        return this._posY
    }

    public get orient() {
        return this._orient
    }

    protected setOrient(newOrient: Orientation) {
        // can't be a setter, which would require being public
        this._orient = newOrient
        this.setNeedsRedraw("orientation changed")
    }

    public get width(): number {
        return isOrientationVertical(this._orient) ? this.unrotatedHeight : this.unrotatedWidth
    }

    public get height(): number {
        return isOrientationVertical(this._orient) ? this.unrotatedWidth : this.unrotatedHeight
    }

    public abstract get unrotatedWidth(): number

    public abstract get unrotatedHeight(): number

    public applyDrawTransform(g: CanvasRenderingContext2D) {
        const rotation = (() => {
            switch (this._orient) {
                case "e": return undefined
                case "s": return Math.PI / 2
                case "w": return Math.PI
                case "n": return -Math.PI / 2
            }
        })()

        if (isDefined(rotation)) {
            g.translate(this.posX, this.posY)
            g.rotate(rotation)
            g.translate(-this.posX, -this.posY)
        }
    }

    public isOver(x: number, y: number) {
        return mode >= Mode.CONNECT && inRect(this._posX, this._posY, this.width, this.height, x, y)
    }

    protected setPosition(posX: number, posY: number, snapToGrid: boolean): undefined | [number, number] {
        if (snapToGrid) {
            posX = Math.round(posX / GRID_STEP) * GRID_STEP
            posY = Math.round(posY / GRID_STEP) * GRID_STEP
        }
        if (posX !== this._posX || posY !== this.posY) {
            this._posX = posX
            this._posY = posY
            this.setNeedsRedraw("position changed")
            return [posX, posY]
        }
        return undefined
    }

}
