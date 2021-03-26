import { backToEdit, currMouseAction } from "../menutools.js"
import { mode, modifierKeys, startedMoving, stoppedMoving } from "../simulator.js"
import { asArray, FixedArray, FixedArraySize, FixedArraySizeNonZero, isArray, isDefined, isNotNull, isNumber, isUndefined, Mode, MouseAction, toTriStateRepr, TriStateRepr } from "../utils.js"
import { Node } from "./Node.js"
import { NodeManager } from "../NodeManager.js"
import { PositionSupport, PositionSupportRepr } from "./Position.js"


// Node IDs are just represented by a non-negative number
type NodeID = number

// Input nodes are represented by just the ID; output nodes can be forced
// to a given value to bypass their naturally computed value
export type InputNodeRepr = { id: NodeID }
export type OutputNodeRepr = { id: NodeID, force?: TriStateRepr | undefined }

// Allows collapsing an array of 1 element into the element itself,
// used for compact JSON representation. Does not work well if T itself is
// an array
type FixedArrayOrDirect<T, N extends FixedArraySizeNonZero> =
    N extends 1 ? T : FixedArray<T, N>


// Defines how the JSON looks like depending on the number of inputs and outputs.
// If only inputs or only outputs, all IDs are put into an "id" field.
// If both inputs and outputs are present, we have separate "in" and "out" fields.

// These are just 3 intermediate types
type OnlyInNodeIds<N extends FixedArraySizeNonZero> = { id: FixedArrayOrDirect<NodeID | InputNodeRepr, N> }
type OnlyOutNodeIds<N extends FixedArraySizeNonZero> = { id: FixedArrayOrDirect<NodeID | OutputNodeRepr, N> }
type InAndOutNodeIds<N extends FixedArraySizeNonZero, M extends FixedArraySizeNonZero> = {
    in: FixedArrayOrDirect<NodeID | InputNodeRepr, N>
    out: FixedArrayOrDirect<NodeID | OutputNodeRepr, M>
}

// This is the final conditional type showing what the JSON representation
// will look like depending on number of inputs and outputs
export type NodeIDsRepr<NumInputs extends FixedArraySize, NumOutputs extends FixedArraySize> =
    NumInputs extends FixedArraySizeNonZero
    ? /* NumInputs != 0 */ (
        NumOutputs extends FixedArraySizeNonZero
        ? /* NumInputs != 0, NumOutputs != 0 */ InAndOutNodeIds<NumInputs, NumOutputs>
        : /* NumInputs != 0, NumOutputs == 0 */ OnlyInNodeIds<NumInputs>
    )
    : /* NumInputs == 0 */  (
        NumOutputs extends FixedArraySizeNonZero
        ? /* NumInputs == 0, NumOutputs != 0 */ OnlyOutNodeIds<NumOutputs>
        // eslint-disable-next-line @typescript-eslint/ban-types
        : /* NumInputs == 0, NumOutputs == 0 */ {}
    )

// Tests

// type IDs_00 = Expand<NodeIDsRepr<0, 0>>
// type IDs_01 = Expand<NodeIDsRepr<0, 1>>
// type IDs_10 = Expand<NodeIDsRepr<1, 0>>
// type IDs_11 = Expand<NodeIDsRepr<1, 1>>
// type IDs_02 = Expand<NodeIDsRepr<0, 2>>
// type IDs_20 = Expand<NodeIDsRepr<2, 0>>
// type IDs_12 = Expand<NodeIDsRepr<1, 2>>
// type IDs_21 = Expand<NodeIDsRepr<2, 1>>
// type IDs_22 = Expand<NodeIDsRepr<2, 2>>

// A generic component is represented by its position
// and the representation of its nodes
export type ComponentRepr<NumInputs extends FixedArraySize, NumOutputs extends FixedArraySize> =
    PositionSupportRepr & NodeIDsRepr<NumInputs, NumOutputs>

// Node offsets are not stored in JSON, but provided by the concrete
// subclasses to the Component superclass to indicate where to place
// the input and output nodes. Strong typing allows us to check the
// size of the passed arrays in the super() call.
export type NodeOffsets<NumInputs extends FixedArraySize, NumOutputs extends FixedArraySize>
    // eslint-disable-next-line @typescript-eslint/ban-types
    = (NumInputs extends 0 ? {} : { inOffsets: FixedArray<[number, number], NumInputs> })
    // eslint-disable-next-line @typescript-eslint/ban-types
    & (NumOutputs extends 0 ? {} : { outOffsets: FixedArray<[number, number], NumOutputs> })


export enum ComponentState {
    SPAWNING,
    SPAWNED,
    DEAD
}

// Simplified, generics-free representation of a component
export type Component = ComponentBase<FixedArraySize, FixedArraySize, ComponentRepr<FixedArraySize, FixedArraySize>>

export abstract class ComponentBase<
    NumInputs extends FixedArraySize, // statically know the number of inputs
    NumOutputs extends FixedArraySize, // statically know the number of outputs
    Repr extends ComponentRepr<NumInputs, NumOutputs> // JSON representation, varies according to input/output number
    > extends PositionSupport {

    private _state: ComponentState
    private _isMovingWithMouseOffset: undefined | [number, number] = undefined
    protected readonly inputs: FixedArray<Node, NumInputs>
    protected readonly outputs: FixedArray<Node, NumOutputs>

    protected constructor(savedData: Repr | null, nodeOffsets: NodeOffsets<NumInputs, NumOutputs>) {
        super(savedData)

        // hack to get around the inOffsets and outOffsets properties
        // being inferred as nonexistant (basically, the '"key" in savedData'
        // check fails to provide enough info for type narrowing)
        type NodeOffsetsKey = keyof NodeOffsets<1, 0> | keyof NodeOffsets<0, 1>
        function get(key: NodeOffsetsKey): ReadonlyArray<[number, number]> {
            if (key in nodeOffsets) {
                return (nodeOffsets as any as NodeOffsets<1, 1>)[key]
            } else {
                return [] as const
            }
        }

        const inOffsets = get("inOffsets")
        const outOffsets = get("outOffsets")
        const numInputs = inOffsets.length as NumInputs
        const numOutputs = outOffsets.length as NumOutputs

        if (isNotNull(savedData)) {
            // restoring
            this._state = ComponentState.SPAWNED

        } else {
            // newly placed
            this._state = ComponentState.SPAWNING
            startedMoving(this)
        }

        // build node specs either from scratch if new or from saved data
        const [inputSpecs, outputSpecs] = this.nodeSpecsFromRepr(savedData, numInputs, numOutputs)

        // generate the input and output nodes
        this.inputs = this.makeNodes(inOffsets, inputSpecs, false) as FixedArray<Node, NumInputs>
        this.outputs = this.makeNodes(outOffsets, outputSpecs, true) as FixedArray<Node, NumOutputs>
    }

    public abstract toJSON(): Repr

    // typically used by subclasses to provide only their specific JSON,
    // splatting in the result of super.toJSONBase() in the object
    protected toJSONBase(): ComponentRepr<NumInputs, NumOutputs> {
        return {
            pos: [this.posX, this.posY] as const,
            ...this.buildNodesRepr(),
        }
    }

    // creates the input/output nodes based on array of offsets (provided
    // by subclass) and spec (either loaded from JSON repr or newly generated)
    private makeNodes(offsets: readonly [number, number][], specs: readonly (InputNodeRepr | OutputNodeRepr)[], isOutput: boolean): readonly Node[] {
        const nodes: Node[] = []
        for (let i = 0; i < offsets.length; i++) {
            const gridOffset = offsets[i]
            nodes.push(new Node(specs[i], this, gridOffset[0], gridOffset[1], isOutput))
        }
        return nodes
    }

    // generates two arrays of normalized node specs either as loaded from
    // JSON or obtained with default values when _repr is null and we're
    // creating a new component from scratch
    private nodeSpecsFromRepr(_repr: NodeIDsRepr<NumInputs, NumOutputs> | null, numInputs: number, numOutputs: number): [InputNodeRepr[], OutputNodeRepr[]] {
        const inputSpecs: InputNodeRepr[] = []
        const outputSpecs: OutputNodeRepr[] = []

        if (_repr === null) {
            // build default spec for nodes
            for (let i = 0; i < numInputs; i++) {
                inputSpecs.push({ id: NodeManager.newID() })
            }
            for (let i = 0; i < numOutputs; i++) {
                outputSpecs.push({ id: NodeManager.newID() })
            }

        } else {
            // parse from cast repr according to cases

            // the next two functions take either a single ID or an array of them and
            // generate the corresponding node specs from it
            const genOutSpecs = function (outReprs: FixedArrayOrDirect<NodeID | OutputNodeRepr, FixedArraySizeNonZero>) {
                const pushOne = (outRepr: NodeID | OutputNodeRepr) => outputSpecs.push(isNumber(outRepr)
                    ? { id: outRepr }
                    : { id: outRepr.id, force: outRepr.force }
                )
                if (isArray(outReprs)) {
                    for (const outRepr of outReprs) {
                        pushOne(outRepr)
                    }
                } else {
                    pushOne(outReprs)
                }
            }
            const genInSpecs = function (inReprs: FixedArrayOrDirect<NodeID | InputNodeRepr, FixedArraySizeNonZero>) {
                const pushOne = (inRepr: NodeID | InputNodeRepr) =>
                    inputSpecs.push({ id: isNumber(inRepr) ? inRepr : inRepr.id })
                if (isArray(inReprs)) {
                    for (const inRepr of inReprs) {
                        pushOne(inRepr)
                    }
                } else {
                    pushOne(inReprs)
                }
            }

            // manually distinguishing the cases where we have no inputs or no
            // outputs as we then have a more compact JSON representation
            if (numInputs !== 0) {
                if (numOutputs !== 0) {
                    // NumInputs != 0, NumOutputs != 0
                    const repr: InAndOutNodeIds<FixedArraySizeNonZero, FixedArraySizeNonZero> = _repr as any
                    genInSpecs(repr.in)
                    genOutSpecs(repr.out)
                } else {
                    // NumInputs != 0, NumOutputs == 0
                    const repr: OnlyInNodeIds<FixedArraySizeNonZero> = _repr as any
                    genInSpecs(repr.id)
                }
            } else if (numOutputs !== 0) {
                // NumInputs == 0, NumOutputs != 0
                const repr: OnlyOutNodeIds<FixedArraySizeNonZero> = _repr as any
                genOutSpecs(repr.id)
            }

            // id availability check
            for (const specs of [inputSpecs, outputSpecs]) {
                for (const spec of specs) {
                    NodeManager.markIDUsed(spec.id)
                }
            }
        }

        return [inputSpecs, outputSpecs]
    }

    // from the known nodes, builds the JSON representation of them,
    // using the most compact form available
    private buildNodesRepr(): NodeIDsRepr<NumInputs, NumOutputs> {
        const numInputs = this.inputs.length as NumInputs
        const numOutputs = this.outputs.length as NumOutputs

        // these two functions return either an array of JSON
        // representations, or just the element skipping the array
        // if there is only one
        function inNodeReprs(nodes: readonly Node[]): FixedArrayOrDirect<NodeID, FixedArraySizeNonZero> {
            const reprOne = (node: Node) => node.id
            if (nodes.length === 1) {
                return reprOne(nodes[0])
            } else {
                return nodes.map(reprOne) as any
            }
        }
        function outNodeReprs(nodes: readonly Node[]): FixedArrayOrDirect<NodeID | OutputNodeRepr, FixedArraySizeNonZero> {
            const reprOne = (node: Node) => {
                if (isUndefined(node.forceValue)) {
                    return node.id
                } else {
                    return { id: node.id, force: toTriStateRepr(node.forceValue) }
                }
            }
            if (nodes.length === 1) {
                return reprOne(nodes[0])
            } else {
                return nodes.map(reprOne) as any
            }
        }

        let result: any = {}

        // manually distinguishing the cases where we have no inputs or no
        // outputs as we then have a more compact JSON representation
        if (numInputs !== 0) {
            const inRepr = inNodeReprs(this.inputs)

            if (numOutputs !== 0) {
                // NumInputs != 0, NumOutputs != 0
                const outRepr = outNodeReprs(this.outputs)
                const repr: InAndOutNodeIds<FixedArraySizeNonZero, FixedArraySizeNonZero> =
                    { in: inRepr as any, out: outRepr as any }
                result = repr

            } else {
                // NumInputs != 0, NumOutputs == 0
                const repr: OnlyOutNodeIds<FixedArraySizeNonZero> = { id: inRepr as any }
                result = repr
            }
        } else if (numOutputs !== 0) {
            // NumInputs == 0, NumOutputs != 0
            const outRepr = outNodeReprs(this.outputs)
            const repr: OnlyOutNodeIds<FixedArraySizeNonZero> = { id: outRepr as any }
            result = repr
        }

        return result
    }

    private get allNodes(): Node[] {
        return [...this.inputs, ...this.outputs]
    }

    public get state() {
        return this._state
    }

    public get isMoving() {
        return isDefined(this._isMovingWithMouseOffset)
    }

    protected updatePositionIfNeeded(): undefined | [number, number] {
        const newPos = this.updateSelfPositionIfNeeded()
        const posChanged = isDefined(newPos)
        if (posChanged) {
            for (const node of this.allNodes) {
                node.updatePositionFromParent()
            }
        }
        return newPos
    }

    private updateSelfPositionIfNeeded(): undefined | [number, number] {
        const snapToGrid = !modifierKeys.isCommandDown
        if (this._state === ComponentState.SPAWNING) {
            return this.setPosition(mouseX, mouseY, snapToGrid)
        }
        if (isDefined(this._isMovingWithMouseOffset)) {
            const [mouseOffsetX, mouseOffsetY] = this._isMovingWithMouseOffset
            const changedPos = this.setPosition(mouseX + mouseOffsetX, mouseY + mouseOffsetY, snapToGrid)
            if (isDefined(changedPos)) {
                startedMoving(this)
            }
            return changedPos
        }
        return undefined
    }

    mousePressed() {
        if (this._state === ComponentState.SPAWNING) {
            const snapToGrid = !modifierKeys.isCommandDown
            this.setPosition(mouseX, mouseY, snapToGrid)
            this._state = ComponentState.SPAWNED
            stoppedMoving(this)
            backToEdit()
            return
        }

        if (mode >= Mode.CONNECT && (currMouseAction === MouseAction.MOVE || this.isMouseOver())) {
            if (isUndefined(this._isMovingWithMouseOffset)) {
                this._isMovingWithMouseOffset = [this.posX - mouseX, this.posY - mouseY]
            }
        }
    }

    mouseReleased() {
        if (isDefined(this._isMovingWithMouseOffset)) {
            this._isMovingWithMouseOffset = undefined
            stoppedMoving(this)
        }
    }

    destroy() {
        this._state = ComponentState.DEAD
        for (const node of this.allNodes) {
            node.destroy()
        }
    }

    public abstract draw(): void

    public abstract isMouseOver(): boolean

    // TODO implement mouseClicked here?
    public abstract mouseClicked(): boolean

    public doubleClicked() {
        // forward to output nodes
        for (const node of asArray(this.outputs)) {
            node.doubleClicked()
        }
    }

}

export const INPUT_OUTPUT_DIAMETER = 25