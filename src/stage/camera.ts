import { Mat4, mat4, Vec2, vec2, Vec3, vec3 } from "wgpu-matrix";
import { toRadians } from "../math_util";
import { device, canvas, fovYDegrees, aspectRatio } from "../renderer";

class CameraUniforms {
    readonly buffer = new ArrayBuffer(368);
    private readonly floatView = new Float32Array(this.buffer);

    set viewProjMat(mat: Float32Array) {
        for (let i = 0; i < 16; i++) {
            this.floatView[i] = mat[i];
        }
    }

    set viewMat(mat: Float32Array) {
        for (let i = 0; i < 16; i++) {
            this.floatView[i + 16] = mat[i];
        }
    }

    set projMat(mat: Float32Array) {
        for (let i = 0; i < 16; i++) {
            this.floatView[i + 32] = mat[i];
        }
    }

    set projInvMat(mat: Float32Array) {
        for (let i = 0; i < 16; i++) {
            this.floatView[i + 48] = mat[i];
        }
    }

    set front(front: Vec3) {
        for (let i = 0; i < 3; i++) {
            this.floatView[i + 64] = front[i];
        }
    }

    set up(up: Vec3) {
        for (let i = 0; i < 3; i++) {
            this.floatView[i + 68] = up[i];
        }
    }

    set right(right: Vec3) {
        for (let i = 0; i < 3; i++) {
            this.floatView[i + 72] = right[i];
        }
    }

    set depth(depth: f32) {
        this.floatView[75] = depth;
    }

    set nearFar(nearFar: Vec2) {
        for (let i = 0; i < 2; i++) {
            this.floatView[i + 76] = nearFar[i];
        }
    }

    set resolution(resolution: Vec2) {
        for (let i = 0; i < 2; i++) {
            this.floatView[i + 78] = resolution[i];
        }
    }

    set pixelLength(pixelLength: Vec2) {
        for (let i = 0; i < 2; i++) {
            this.floatView[i + 80] = pixelLength[i];
        }
    }

    set cameraPos(cameraPos: Vec3) {
        for (let i = 0; i < 3; i++) {
            this.floatView[i + 84] = cameraPos[i];
        }
    }

    set numSamples(numSamples: f32) {
        this.floatView[87] = numSamples;
    }

    set seed(seed: Vec3) {
        for (let i = 0; i < 3; i++) {
            this.floatView[i + 88] = seed[i];
        }
    }
}

export class Camera {
    uniforms: CameraUniforms = new CameraUniforms();
    uniformsBuffer: GPUBuffer;

    projMat: Mat4 = mat4.create();
    cameraPos: Vec3 = vec3.create(-7, 2, 0);
    cameraFront: Vec3 = vec3.create(0, 0, -1);
    cameraUp: Vec3 = vec3.create(0, 1, 0);
    cameraRight: Vec3 = vec3.create(1, 0, 0);
    yaw: number = 0;
    pitch: number = 0;
    moveSpeed: number = 0.004;
    sensitivity: number = 0.15;

    static readonly nearPlane = 0.1;
    static readonly farPlane = 1000;

    rayDepth: number = 8;
    samples: number = 1;

    keys: { [key: string]: boolean } = {};

    constructor() {
        this.uniformsBuffer = device.createBuffer({
            label: "camera uniform buffer",
            size: this.uniforms.buffer.byteLength,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        this.projMat = mat4.perspective(toRadians(fovYDegrees), aspectRatio, Camera.nearPlane, Camera.farPlane);
        this.uniforms.projMat = this.projMat;
        this.uniforms.projInvMat = mat4.inverse(this.projMat);
        this.uniforms.nearFar = vec2.create(Camera.nearPlane, Camera.farPlane);
        this.uniforms.resolution = vec2.create(canvas.width, canvas.height);
        this.uniforms.depth = this.rayDepth;
        this.uniforms.numSamples = this.samples;

        let yscaled = Math.tan(fovYDegrees * (Math.PI / 180));
        let xscaled = (yscaled * canvas.width) / canvas.height;
        this.uniforms.pixelLength = vec2.create((2 * xscaled) / canvas.width, (2 * yscaled) / canvas.height);

        this.rotateCamera(0, 0); // set initial camera vectors

        window.addEventListener("keydown", (event) => this.onKeyEvent(event, true));
        window.addEventListener("keyup", (event) => this.onKeyEvent(event, false));
        window.onblur = () => (this.keys = {}); // reset keys on page exit so they don't get stuck (e.g. on alt + tab)

        canvas.addEventListener("mousedown", () => canvas.requestPointerLock());
        canvas.addEventListener("mouseup", () => document.exitPointerLock());
        canvas.addEventListener("mousemove", (event) => this.onMouseMove(event));
    }

    private onKeyEvent(event: KeyboardEvent, down: boolean) {
        this.keys[event.key.toLowerCase()] = down;
        if (this.keys["alt"]) {
            // prevent issues from alt shortcuts
            event.preventDefault();
        }
    }

    private rotateCamera(dx: number, dy: number) {
        this.yaw += dx;
        this.pitch -= dy;

        if (this.pitch > 89) {
            this.pitch = 89;
        }
        if (this.pitch < -89) {
            this.pitch = -89;
        }

        const front = mat4.create();
        front[0] = Math.cos(toRadians(this.yaw)) * Math.cos(toRadians(this.pitch));
        front[1] = Math.sin(toRadians(this.pitch));
        front[2] = Math.sin(toRadians(this.yaw)) * Math.cos(toRadians(this.pitch));

        this.cameraFront = vec3.normalize(front);
        this.cameraRight = vec3.normalize(vec3.cross(this.cameraFront, [0, 1, 0]));
        this.cameraUp = vec3.normalize(vec3.cross(this.cameraRight, this.cameraFront));
    }

    private onMouseMove(event: MouseEvent) {
        if (document.pointerLockElement === canvas) {
            this.rotateCamera(event.movementX * this.sensitivity, event.movementY * this.sensitivity);
        }
    }

    private processInput(deltaTime: number) {
        let moveDir = vec3.create(0, 0, 0);
        if (this.keys["w"]) {
            moveDir = vec3.add(moveDir, this.cameraFront);
        }
        if (this.keys["s"]) {
            moveDir = vec3.sub(moveDir, this.cameraFront);
        }
        if (this.keys["a"]) {
            moveDir = vec3.sub(moveDir, this.cameraRight);
        }
        if (this.keys["d"]) {
            moveDir = vec3.add(moveDir, this.cameraRight);
        }
        if (this.keys["q"]) {
            moveDir = vec3.sub(moveDir, this.cameraUp);
        }
        if (this.keys["e"]) {
            moveDir = vec3.add(moveDir, this.cameraUp);
        }

        let moveSpeed = this.moveSpeed * deltaTime;
        const moveSpeedMultiplier = 3;
        if (this.keys["shift"]) {
            moveSpeed *= moveSpeedMultiplier;
        }
        if (this.keys["alt"]) {
            moveSpeed /= moveSpeedMultiplier;
        }

        if (vec3.length(moveDir) > 0) {
            const moveAmount = vec3.scale(vec3.normalize(moveDir), moveSpeed);
            this.cameraPos = vec3.add(this.cameraPos, moveAmount);
        }
    }

    onFrame(deltaTime: number) {
        this.processInput(deltaTime);

        const lookPos = vec3.add(this.cameraPos, vec3.scale(this.cameraFront, 1));
        const viewMat = mat4.lookAt(this.cameraPos, lookPos, [0, 1, 0]);
        const viewProjMat = mat4.mul(this.projMat, viewMat);
        this.uniforms.viewProjMat = viewProjMat;
        this.uniforms.viewMat = viewMat;
        this.uniforms.front = this.cameraFront;
        this.uniforms.up = this.cameraUp;
        this.uniforms.right = this.cameraRight;
        this.uniforms.cameraPos = this.cameraPos;
        this.uniforms.seed = vec3.create(
            0xffffffff * Math.random(),
            0xffffffff * Math.random(),
            0xffffffff * Math.random()
        );

        device.queue.writeBuffer(this.uniformsBuffer, 0, this.uniforms.buffer);
    }
}
