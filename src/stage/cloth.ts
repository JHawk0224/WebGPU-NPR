import * as shaders from "../shaders/shaders";
import * as renderer from "../renderer";
import { vec3, vec2, Vec3 } from "wgpu-matrix";
import { VertexData, Scene } from "./scene";



export class ClothMesh {
    width: number;
    height: number;
    segmentsX: number;
    segmentsY: number;

    positionsArray: VertexData[] = [];
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
                const position = vec3.create(x * dx - this.width / 2, 1, y * dy - this.height / 2);
                const uv = vec2.create(x / this.segmentsX, y / this.segmentsY);
                this.positionsArray.push({ position, normal: vec3.create(0, 1, 0), uv });
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

    vertexBuffer!: GPUBuffer;
    previousPositionBuffer!: GPUBuffer;
    velocityBuffer!: GPUBuffer;
    uniformBuffer!: GPUBuffer;
    indexBuffer!: GPUBuffer;


    
    geometryBindGroupLayout!: GPUBindGroupLayout;
    geometryBindGroup!: GPUBindGroup;

    bindGroup!: GPUBindGroup;
    bindGroupLayout!: GPUBindGroupLayout;
    computePipeline!: GPUComputePipeline;

    constructor() {
        this.clothMesh = new ClothMesh(5, 5, 200, 200);

        this.createBuffers();
        this.createBindGroup();
        this.createComputePipeline();
    }

    createBuffers() {
        // Position Buffer
        const vertexData = new Float32Array(this.clothMesh.positionsArray.length * 12);
        const previousPositionData = new Float32Array(this.clothMesh.previousPositionsArray.length * 3);
        const velocityData = new Float32Array(this.clothMesh.velocitiesArray.length * 3);

        for (let i = 0; i < this.clothMesh.positionsArray.length; i++) {
            vertexData.set(this.clothMesh.positionsArray[i].position, i * 4 * 3);
            vertexData.set(this.clothMesh.positionsArray[i].normal, i * 4 * 3 + 4);
            vertexData.set(this.clothMesh.positionsArray[i].uv, i * 4 * 3 + 8);
            previousPositionData.set(this.clothMesh.previousPositionsArray[i], i * 3);
            velocityData.set(this.clothMesh.velocitiesArray[i], i * 3);
        }

        const bufferSize = vertexData.byteLength;

        this.vertexBuffer = renderer.device.createBuffer({
            label: "cloth position buffer",
            size: bufferSize,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_SRC,
            mappedAtCreation: true,
        });
        new Float32Array(this.vertexBuffer.getMappedRange()).set(vertexData);
        this.vertexBuffer.unmap();

        this.previousPositionBuffer = renderer.device.createBuffer({
            label: "cloth previous position buffer",
            size: bufferSize,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
            mappedAtCreation: true,
        });
        new Float32Array(this.previousPositionBuffer.getMappedRange()).set(previousPositionData);
        this.previousPositionBuffer.unmap();

        this.velocityBuffer = renderer.device.createBuffer({
            label: "cloth velocity buffer",
            size: bufferSize,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
            mappedAtCreation: true,
        });
        new Float32Array(this.velocityBuffer.getMappedRange()).set(velocityData);
        this.velocityBuffer.unmap();

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
                { binding: 0, resource: { buffer: this.vertexBuffer } },
                { binding: 1, resource: { buffer: this.previousPositionBuffer } },
                { binding: 2, resource: { buffer: this.velocityBuffer } },
                { binding: 3, resource: { buffer: this.uniformBuffer } },            ],
        });


        this.geometryBindGroupLayout = renderer.device.createBindGroupLayout({
            label: "geometry bind group layout",
            entries: [
                // Vertex buffer
                {
                    binding: 0,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: "read-only-storage" },
                },
                // Triangle buffer
                {
                    binding: 1,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: "read-only-storage" },
                },
                // Geom buffer
                {
                    binding: 2,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: "read-only-storage" },
                },
                // BVH nodes
                {
                    binding: 3,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: "read-only-storage" },
                },
            ],
        });



    }

    createComputePipeline() {
        this.computePipeline = renderer.device.createComputePipeline({
            label: "cloth simulation compute pipeline",
            layout: renderer.device.createPipelineLayout({
                bindGroupLayouts: [this.bindGroupLayout, this.geometryBindGroupLayout],
            }),
            compute: {
                module: renderer.device.createShaderModule({
                    code: shaders.clothSimComputeSrc,
                }),
                entryPoint: "simulateCloth",
            },
        });
    }
}
