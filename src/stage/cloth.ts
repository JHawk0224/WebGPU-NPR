import * as shaders from "../shaders/shaders";
import * as renderer from "../renderer";
import { vec3, vec2, Vec3, Vec2 } from "wgpu-matrix";

export class ClothMesh {
    width: number;
    height: number;
    segmentsX: number;
    segmentsY: number;

    positionsArray: Vec3[] = [];
    normalsArray: Vec3[] = [];
    uvsArray: Vec2[] = [];
    previousPositionsArray: Vec3[] = [];
    velocitiesArray: Vec3[] = [];
    indices: Uint32Array;

    constructor(width: number, height: number, segmentsX: number, segmentsY: number) {
        this.width = width;
        this.height = height;
        this.segmentsX = segmentsX;
        this.segmentsY = segmentsY;
        this.indices = new Uint32Array(segmentsX * segmentsY * 6);
        this.createMesh();
    }

    createMesh() {
        const dx = this.width / this.segmentsX;
        const dy = this.height / this.segmentsY;

        // Generate vertices
        for (let y = 0; y <= this.segmentsY; y++) {
            for (let x = 0; x <= this.segmentsX; x++) {
                const position = vec3.create(x * dx - this.width / 2, 0, y * dy - this.height / 2);
                const uv = vec2.create(x / this.segmentsX, y / this.segmentsY);
                this.positionsArray.push(position);
                this.normalsArray.push(vec3.create(0, 1, 0));
                this.uvsArray.push(uv);
                this.previousPositionsArray.push(position);
                this.velocitiesArray.push(vec3.create(0, 0, 0));
            }
        }

        // Generate indices
        let offset = 0;
        for (let y = 0; y < this.segmentsY; y++) {
            for (let x = 0; x < this.segmentsX; x++) {
                const i0 = y * (this.segmentsX + 1) + x;
                const i1 = i0 + 1;
                const i2 = i0 + (this.segmentsX + 1);
                const i3 = i2 + 1;

                // Triangle 1
                this.indices[offset++] = i0;
                this.indices[offset++] = i2;
                this.indices[offset++] = i1;

                // Triangle 2
                this.indices[offset++] = i1;
                this.indices[offset++] = i2;
                this.indices[offset++] = i3;
            }
        }
    }
}

export class ClothSimulator {
    clothMesh: ClothMesh;

    positionBuffer!: GPUBuffer;
    previousPositionBuffer!: GPUBuffer;
    velocityBuffer!: GPUBuffer;
    uniformBuffer!: GPUBuffer;
    readbackPositionBuffer!: GPUBuffer;
    readbackPreviousPositionBuffer!: GPUBuffer;
    readbackVelocityBuffer!: GPUBuffer;
    indexBuffer!: GPUBuffer;
    bindGroup!: GPUBindGroup;
    bindGroupLayout!: GPUBindGroupLayout;
    computePipeline!: GPUComputePipeline;

    constructor() {
        this.clothMesh = new ClothMesh(5, 5, 50, 50);

        this.createBuffers();
        this.createBindGroup();
        this.createComputePipeline();
    }

    createBuffers() {
        // Position Buffer
        const positionData = new Float32Array(this.clothMesh.positionsArray.length * 3);
        const previousPositionData = new Float32Array(this.clothMesh.previousPositionsArray.length * 3);
        const velocityData = new Float32Array(this.clothMesh.velocitiesArray.length * 3);

        for (let i = 0; i < this.clothMesh.positionsArray.length; i++) {
            positionData.set(this.clothMesh.positionsArray[i], i * 3);
            previousPositionData.set(this.clothMesh.previousPositionsArray[i], i * 3);
            velocityData.set(this.clothMesh.velocitiesArray[i], i * 3);
        }

        const bufferSize = positionData.byteLength;

        this.positionBuffer = renderer.device.createBuffer({
            label: "cloth position buffer",
            size: bufferSize,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
            mappedAtCreation: true,
        });
        new Float32Array(this.positionBuffer.getMappedRange()).set(positionData);
        this.positionBuffer.unmap();

        this.readbackPositionBuffer = renderer.device.createBuffer({
            label: "cloth readback position buffer",
            size: bufferSize,
            usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_SRC,
        });

        this.previousPositionBuffer = renderer.device.createBuffer({
            label: "cloth previous position buffer",
            size: bufferSize,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            mappedAtCreation: true,
        });
        new Float32Array(this.previousPositionBuffer.getMappedRange()).set(previousPositionData);
        this.previousPositionBuffer.unmap();

        this.readbackPreviousPositionBuffer = renderer.device.createBuffer({
            label: "cloth readback previous position buffer",
            size: bufferSize,
            usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_SRC,
        });

        this.velocityBuffer = renderer.device.createBuffer({
            label: "cloth velocity buffer",
            size: bufferSize,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            mappedAtCreation: true,
        });
        new Float32Array(this.velocityBuffer.getMappedRange()).set(velocityData);
        this.velocityBuffer.unmap();

        this.readbackVelocityBuffer = renderer.device.createBuffer({
            label: "cloth readback velocity buffer",
            size: bufferSize,
            usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_SRC,
        });

        // Index Buffer
        const indexData = this.clothMesh.indices;
        this.indexBuffer = renderer.device.createBuffer({
            label: "cloth index buffer",
            size: indexData.byteLength,
            usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
            mappedAtCreation: true,
        });
        new Uint32Array(this.indexBuffer.getMappedRange()).set(indexData);
        this.indexBuffer.unmap();
    }

    createBindGroup() {
        // Create a buffer for uniforms
        const gridWidth = this.clothMesh.segmentsX + 1;
        const uniformData = new Uint32Array([gridWidth]);
        this.uniformBuffer = renderer.device.createBuffer({
            label: "cloth simulation uniform buffer",
            size: uniformData.byteLength,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            mappedAtCreation: true,
        });
        new Uint32Array(this.uniformBuffer.getMappedRange()).set(uniformData);
        this.uniformBuffer.unmap();

        this.bindGroupLayout = renderer.device.createBindGroupLayout({
            label: "cloth simulation bind group layout",
            entries: [
                {
                    binding: 0,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: "storage" },
                },
                {
                    binding: 1,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: "storage" },
                },
                {
                    binding: 2,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: "storage" },
                },
                {
                    binding: 3,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: "uniform" },
                },
            ],
        });

        this.bindGroup = renderer.device.createBindGroup({
            label: "cloth simulation bind group",
            layout: this.bindGroupLayout,
            entries: [
                { binding: 0, resource: { buffer: this.positionBuffer } },
                { binding: 1, resource: { buffer: this.previousPositionBuffer } },
                { binding: 2, resource: { buffer: this.velocityBuffer } },
                { binding: 3, resource: { buffer: this.uniformBuffer } },
            ],
        });
    }

    createComputePipeline() {
        this.computePipeline = renderer.device.createComputePipeline({
            label: "cloth simulation compute pipeline",
            layout: renderer.device.createPipelineLayout({
                bindGroupLayouts: [this.bindGroupLayout],
            }),
            compute: {
                module: renderer.device.createShaderModule({
                    code: shaders.clothSimComputeSrc,
                }),
                entryPoint: "simulateCloth",
            },
        });
    }

    async simulate() {
        const encoder = renderer.device.createCommandEncoder();

        const computePass = encoder.beginComputePass();
        computePass.setPipeline(this.computePipeline);
        computePass.setBindGroup(0, this.bindGroup);
        const workgroupSize = 256;
        const numVertices = this.clothMesh.positionsArray.length;
        computePass.dispatchWorkgroups(Math.ceil(numVertices / workgroupSize));
        computePass.end();

        const bufferSize = this.clothMesh.positionsArray.length * 3 * 4;
        encoder.copyBufferToBuffer(this.positionBuffer, 0, this.readbackPositionBuffer, 0, bufferSize);
        encoder.copyBufferToBuffer(this.previousPositionBuffer, 0, this.readbackPreviousPositionBuffer, 0, bufferSize);
        encoder.copyBufferToBuffer(this.velocityBuffer, 0, this.readbackVelocityBuffer, 0, bufferSize);

        renderer.device.queue.submit([encoder.finish()]);

        await renderer.device.queue.onSubmittedWorkDone();

        await this.readbackPositionBuffer.mapAsync(GPUMapMode.READ);
        const positionArrayBuffer = this.readbackPositionBuffer.getMappedRange();
        const positionData = new Float32Array(positionArrayBuffer);
        for (let i = 0; i < positionData.length; i += 3) {
            this.clothMesh.positionsArray[i / 3] = vec3.create(
                positionData[i],
                positionData[i + 1],
                positionData[i + 2]
            );
        }
        this.readbackPositionBuffer.unmap();

        await this.readbackPreviousPositionBuffer.mapAsync(GPUMapMode.READ);
        const previousPositionArrayBuffer = this.readbackPreviousPositionBuffer.getMappedRange();
        const previousPositionData = new Float32Array(previousPositionArrayBuffer);
        for (let i = 0; i < previousPositionData.length; i += 3) {
            this.clothMesh.previousPositionsArray[i / 3] = vec3.create(
                previousPositionData[i],
                previousPositionData[i + 1],
                previousPositionData[i + 2]
            );
        }
        this.readbackPreviousPositionBuffer.unmap();

        await this.readbackVelocityBuffer.mapAsync(GPUMapMode.READ);
        const velocityArrayBuffer = this.readbackVelocityBuffer.getMappedRange();
        const velocityData = new Float32Array(velocityArrayBuffer);
        for (let i = 0; i < velocityData.length; i += 3) {
            this.clothMesh.velocitiesArray[i / 3] = vec3.create(
                velocityData[i],
                velocityData[i + 1],
                velocityData[i + 2]
            );
        }
        this.readbackVelocityBuffer.unmap();
    }
}
