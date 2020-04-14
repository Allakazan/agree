export default class Blob {

    /**
     * 
     * @param {CanvasRenderingContext2D} context - The Canvas context
     */
    constructor(context) {
        //const TWO_PI = Math.PI * 2;
        const HALF_PI = Math.PI / 2;
        
        this.context = context;

        this.isMobile = window.innerWidth < 768;

        /** Use this to change the rate of the initial wobble increment */
        this.wobbleIncrement = this.isMobile ? 50 : 100;
        
        /** Use this to change the size of the blob */
        this.radius = 0;
        this.maxRadius = 1500;

        /** 
         * Number of conections in the `bezierSkin`
         *  think of this as detail level
         */
        this.segments = 12;
        this.step = HALF_PI / this.segments;
        this.anchors = [];
        this.radii = [];
        this.thetaOff = [];

        const bumpRadius = this.isMobile ? 50 : 150;
        const halfBumpRadius = bumpRadius / 2;

        for (let i = 0; i < this.segments + 2; i++) {
            this.anchors.push(0, 0);
            this.radii.push(Math.random() * bumpRadius - halfBumpRadius);
            this.thetaOff.push(Math.random() * 2 * Math.PI);
        }

        this.theta = 0;
        this.thetaRamp = 0;
        this.thetaRampDest = 15;
        this.rampDamp = 25;

        this.fillGradient = context.createLinearGradient(0, 0, 0, 1400);
        this.fillGradient.addColorStop(0, "#2f3136");
        this.fillGradient.addColorStop(1, "#36393f");
    }

    /**
     * Update function to be called every frame
     */
    update() {

        this.radius = this.clamp(this.radius += this.wobbleIncrement, 0, this.isMobile ? window.innerWidth * 1.75 : this.maxRadius)

        this.thetaRamp += (this.thetaRampDest - this.thetaRamp) / this.rampDamp;
        this.theta += 0.04;

        this.anchors = [0, this.radius];
        for (let i = 0; i <= this.segments + 2; i++) {
            const sine = Math.sin(this.thetaOff[i] + this.theta + this.thetaRamp);
            const rad = this.radius + this.radii[i] * sine;
            const x = rad * Math.sin(this.step * i);
            const y = rad * Math.cos(this.step * i);
            this.anchors.push(x, y);
        }

        this.context.save();
        this.context.translate(-10, -10);
        this.context.scale(0.5, 0.5);

        this.context.fillStyle = this.fillGradient;
        this.context.beginPath();
        this.context.moveTo(0, 0);
        this.bezierSkin(this.anchors, false);

        this.context.lineTo(0, 0);
        this.context.fill();
        this.context.restore();
    }

    /**
     * Clamp a number between a range of two values
     * @param {Number} num
     * @param {Number} min 
     * @param {Number} max 
     * @return {Number} The clamp value.
     */
    clamp(num, min, max) {
        return num <= min ? min : num >= max ? max : num
    }

    /**
     * Draws the bezier skin on the canvas
     * @param {Array} bez - array of xy coords
     * @param {Boolean} closed - close the bezier or not
     */
    bezierSkin(bez, closed = true) {
        const avg = this.calcAvgs(bez);
        const leng = bez.length;
    
        if (closed) {
            this.context.moveTo(avg[0], avg[1]);
            for (let i = 2; i < leng; i += 2) {
                let n = i + 1;
                this.context.quadraticCurveTo(bez[i], bez[n], avg[i], avg[n]);
            }
            this.context.quadraticCurveTo(bez[0], bez[1], avg[0], avg[1]);
        } else {
            this.context.moveTo(bez[0], bez[1]);
            this.context.lineTo(avg[0], avg[1]);
            for (let i = 2; i < leng - 2; i += 2) {
                let n = i + 1;
                this.context.quadraticCurveTo(bez[i], bez[n], avg[i], avg[n]);
            }
            this.context.lineTo(bez[leng - 2], bez[leng - 1]);
        }
    }

    /**
     * Create anchor points by averaging the control points
     * @param {Array} p - array of xy coords
     */
    calcAvgs(p) {
        const avg = [];
        const leng = p.length;
        let prev;
    
        for (let i = 2; i < leng; i++) {
            prev = i - 2;
            avg.push((p[prev] + p[i]) / 2);
        }
        // close
        avg.push((p[0] + p[leng - 2]) / 2, (p[1] + p[leng - 1]) / 2);
        return avg;
    }
    
}
