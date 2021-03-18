import { currMouseAction, backToEdit } from "../menutools.js"
import { any, gateImages, isCmdDown } from "../simulator.js"
import { GateType, Mode, MouseAction } from "./Enums.js"
import { Node } from "./Node.js"
import { colorMouseOver, fileManager, mode } from "../simulator.js"
import { Component } from "./Component.js"

export class Gate extends Component {

    private type = this.convertToType(this.strType)
    private width = gateImages[this.type].width
    private height = gateImages[this.type].height
    private isSpawned = false
    private offsetMouseX = 0
    private offsetMouseY = 0
    private isMoving = false
    private isSaved = false
    private input: Node[] = []
    private output: Node | undefined
    private nodeStartID: number

    constructor(
        private strType: string
    ) {
        super()
        this.input.push(new Node(this.posX + 2, this.posY + 15))
        if (this.type !== GateType.NOT) {
            this.input.push(new Node(this.posX + 2, this.posY + this.height - 15))
            this.input[0].brotherNode = this.input[1]
            this.input[1].brotherNode = this.input[0]
        }
        this.output = new Node(this.posX + this.width - 2, this.posY + this.height / 2, true)
        this.nodeStartID = this.input[0].id
    }

    static from(strType: string, pos: readonly [number, number], nodeStartID: number): Gate {
        const newObj = new Gate(strType)
        newObj.posX = pos[0]
        newObj.posY = pos[1]
        newObj.isSpawned = true
        newObj.isSaved = true
        newObj.nodeStartID = nodeStartID
        newObj.refreshNodes()
        return newObj
    }

    toJSON() {
        return {
            type: this.strType,
            id: this.nodeStartID,
            pos: [this.posX, this.posY] as const,
        }
    }

    public get outputValue(): boolean {
        return this.output?.value ?? false
    }

    public set input0(val: boolean) {
        this.input0 = val
    }

    public set input1(val: boolean) {
        this.input1 = val
    }

    /**
     * Destroy this gate
     * First destroy and delete all input
     * second destroy and delete the output
     */
    destroy() {
        for (let i = 0; i < this.input.length; i++) {
            this.input[i].destroy()
            delete this.input[i]
        }
        if (this.output) {
            this.output.destroy()
            delete this.output
        }
    }

    /**
     * Draw this gate:
     * If is not spawned, follow mouse
     *  Else if is not saved, save it and set isSaved to true.
     * If is moveing, follow mouse.
     * If this type is gateType.NOT update input[0] position
     *  Else update input[0] and input[1] postion
     * Update gate output.
     * If mouse is over, frame it.
     * Draw gate image and inputs.
     * Generate output and draw it.
     */
    draw() {
        if (!this.isSpawned) {
            this.posX = mouseX - (this.width / 2)
            this.posY = mouseY - (this.height / 2)
            if (!isCmdDown) {
                this.snapToGrid()
            }
        } else if (!this.isSaved) {
            fileManager.saveState()
            this.isSaved = true
        }

        if (this.isMoving) {
            this.posX = mouseX + this.offsetMouseX
            this.posY = mouseY + this.offsetMouseY
            if (!isCmdDown) {
                this.snapToGrid()
            }
        }

        if (this.type === GateType.NOT) {
            this.input[0].updatePosition(this.posX + 2, this.posY + this.height / 2)
        } else {
            this.input[0].updatePosition(this.posX + 2, this.posY + 15)
            this.input[1].updatePosition(this.posX + 2, this.posY + this.height - 15)
        }

        this.output?.updatePosition(this.posX + this.width - 2, this.posY + this.height / 2)

        if (this.isMouseOver()) {
            noFill()
            strokeWeight(2)
            stroke(colorMouseOver[0], colorMouseOver[1], colorMouseOver[2])
            rect(this.posX, this.posY, this.width, this.height)
        }

        image(gateImages[this.type], this.posX, this.posY)

        for (let i = 0; i < this.input.length; i++) {
            this.input[i].draw()
        }

        this.generateOutput()
        this.output?.draw()
    }

    refreshNodes() {
        let currentID = this.nodeStartID
        this.input[0].id = currentID++
        if (this.type !== GateType.NOT) {
            this.input[1].id = currentID++
        }
        if (this.output) {
            this.output.id = currentID++
        }
    }

    /**
     * Generate gate output
     */
    generateOutput() {
        if (this.output) {
            this.output.value = this.calculateValue()
        }
    }

    /**
     * Calculate gate output by type value
     */
    calculateValue(): boolean {
        switch (this.type) {
            case GateType.NOT:
                return !this.input[0].value

            case GateType.AND:
                return this.input[0].value && this.input[1].value

            case GateType.NAND:
                return !(this.input[0].value && this.input[1].value)

            case GateType.OR:
                return this.input[0].value || this.input[1].value

            case GateType.NOR:
                return !(this.input[0].value || this.input[1].value)

            case GateType.XOR:
                return this.input[0].value !== this.input[1].value

            case GateType.XNOR:
                return this.input[0].value === this.input[1].value
        }

        return false
    }

    convertToType(str: string): number {
        switch (str.toUpperCase()) {
            case "NOT":
                return GateType.NOT

            case "AND":
                return GateType.AND

            case "NAND":
                return GateType.NAND

            case "OR":
                return GateType.OR

            case "NOR":
                return GateType.NOR

            case "XOR":
                return GateType.XOR

            case "XNOR":
                return GateType.XNOR
        }

        return GateType.AND
    }

    /**
     * Check if mouse is over
     */
    isMouseOver(): boolean {
        if (mode >= Mode.CONNECT && mouseX > this.posX && mouseX < (this.posX + this.width)
            && mouseY > this.posY && mouseY < (this.posY + this.height)) {
            return true
        }
        return false
    }

    /**
     * When mouse is pressed if gate is not spawned, spawn it, then return 
     */
    mousePressed() {
        if (!this.isSpawned) {
            this.posX = mouseX - (this.width / 2)
            this.posY = mouseY - (this.height / 2)
            this.isSpawned = true
            backToEdit()
            return
        }

        if (this.isMouseOver() || currMouseAction === MouseAction.MOVE) {
            this.isMoving = true
            this.offsetMouseX = this.posX - mouseX
            this.offsetMouseY = this.posY - mouseY
        }
    }

    mouseReleased() {
        this.isMoving = false
    }

    mouseClicked() {
        const results = [
            this.isMouseOver(),
        ]

        for (let i = 0; i < this.input.length; i++) {
            results.push(this.input[i].mouseClicked())
        }

        if (this.output) {
            results.push(this.output.mouseClicked())
        }

        return any(results)
    }

}
