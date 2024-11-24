import { mat4, vec4 } from "wgpu-matrix";
import * as renderer from "../renderer";
import * as shaders from "../shaders/shaders";
import { Stage } from "../stage/stage";

export class Pathtracer extends renderer.Renderer {
    sceneUniformsBindGroupLayout: GPUBindGroupLayout;
    sceneUniformsBindGroup: GPUBindGroup;

    depthTexture: GPUTexture;
    depthTextureView: GPUTextureView;

    emptyBuffer: GPUBuffer;

    static readonly numGeoms = 9;
    static readonly numFloatsPerGeom = 52;
    geomsArray = new Float32Array(Pathtracer.numFloatsPerGeom * Pathtracer.numGeoms);

    static readonly numMats = 8;
    static readonly numFloatsPerMat = 8;
    materialsArray = new Float32Array(Pathtracer.numFloatsPerMat * Pathtracer.numMats);

    pathSegmentsStorageBuffer: GPUBuffer;
    geomsStorageBuffer: GPUBuffer;
    materialsStorageBuffer: GPUBuffer;
    intersectionsStorageBuffer: GPUBuffer;

    pathtracerTempRenderTexture1: GPUTexture;
    pathtracerTempRenderTexture2: GPUTexture;
    pathtracerTempRenderTexture1View: GPUTextureView;
    pathtracerTempRenderTexture2View: GPUTextureView;

    pathtracerComputeBindGroupLayout: GPUBindGroupLayout;
    pathtracerComputeBindGroupTemp1: GPUBindGroup;
    pathtracerComputeBindGroupTemp2: GPUBindGroup;
    pathtracerComputePipelineGenerateRay: GPUComputePipeline;
    pathtracerComputePipelineComputeIntersections: GPUComputePipeline;
    pathtracerComputePipelineIntegrate: GPUComputePipeline;
    pathtracerComputePipelineFinalGather: GPUComputePipeline;
    pathtracerComputePipelineClearTexture: GPUComputePipeline;

    renderTextureBindGroupLayout: GPUBindGroupLayout;
    renderTextureBindGroupTemp1: GPUBindGroup;
    renderTextureBindGroupTemp2: GPUBindGroup;

    pipeline: GPURenderPipeline;

    constructor(stage: Stage) {
        super(stage);

        this.sceneUniformsBindGroupLayout = renderer.device.createBindGroupLayout({
            label: "scene uniforms bind group layout",
            entries: [
                {
                    // cameraSet
                    binding: 0,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: "uniform" },
                },
                {
                    // lightSet
                    binding: 1,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: "read-only-storage" },
                },
            ],
        });

        this.sceneUniformsBindGroup = renderer.device.createBindGroup({
            label: "scene uniforms bind group",
            layout: this.sceneUniformsBindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource: { buffer: this.camera.uniformsBuffer },
                },
                {
                    binding: 1,
                    resource: { buffer: this.lights.lightSetStorageBuffer },
                },
            ],
        });

        this.depthTexture = renderer.device.createTexture({
            size: [renderer.canvas.width, renderer.canvas.height],
            format: "depth24plus",
            usage: GPUTextureUsage.RENDER_ATTACHMENT,
        });
        this.depthTextureView = this.depthTexture.createView();

        this.emptyBuffer = renderer.device.createBuffer({
            label: "empty buffer",
            size: 192,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });

        // Pathtracer compute pipeline
        this.pathSegmentsStorageBuffer = renderer.device.createBuffer({
            label: "path segments",
            size: 64 * shaders.constants.maxResolutionWidth * shaders.constants.maxResolutionHeight,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });

        this.geomsStorageBuffer = renderer.device.createBuffer({
            label: "geoms",
            size: 16 + Pathtracer.numFloatsPerGeom * 4 * Pathtracer.numGeoms, // 16 + Pathtracer.numFloatsPerGeom * 4 * number of geoms
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });

        this.materialsStorageBuffer = renderer.device.createBuffer({
            label: "materials",
            size: 16 + Pathtracer.numFloatsPerMat * 4 * Pathtracer.numMats,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });

        this.intersectionsStorageBuffer = renderer.device.createBuffer({
            label: "intersections",
            size: 32 * shaders.constants.maxResolutionWidth * shaders.constants.maxResolutionHeight,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });

        this.pathtracerTempRenderTexture1 = renderer.device.createTexture({
            label: "render texture temp 1",
            size: {
                width: renderer.canvas.width,
                height: renderer.canvas.height,
            },
            format: "rgba8unorm",
            usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        });

        this.pathtracerTempRenderTexture2 = renderer.device.createTexture({
            label: "render texture temp 2",
            size: {
                width: renderer.canvas.width,
                height: renderer.canvas.height,
            },
            format: "rgba8unorm",
            usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        });

        this.pathtracerTempRenderTexture1View = this.pathtracerTempRenderTexture1.createView();
        this.pathtracerTempRenderTexture2View = this.pathtracerTempRenderTexture2.createView();

        this.pathtracerComputeBindGroupLayout = renderer.device.createBindGroupLayout({
            label: "pathtracer temp compute bind group layout",
            entries: [
                {
                    // render texture write
                    binding: 0,
                    visibility: GPUShaderStage.COMPUTE,
                    storageTexture: { format: "rgba8unorm" },
                },
                {
                    // render texture read
                    binding: 1,
                    visibility: GPUShaderStage.COMPUTE,
                    texture: {},
                },
                {
                    // path segments
                    binding: 2,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: "storage" },
                },
                {
                    // geoms
                    binding: 3,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: "storage" },
                },
                {
                    // materials
                    binding: 4,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: "storage" },
                },
                {
                    // intersections
                    binding: 5,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: "storage" },
                },
            ],
        });

        this.pathtracerComputeBindGroupTemp1 = renderer.device.createBindGroup({
            label: "pathtracer compute bind group temp 1",
            layout: this.pathtracerComputeBindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource: this.pathtracerTempRenderTexture1View,
                },
                {
                    binding: 1,
                    resource: this.pathtracerTempRenderTexture2View,
                },
                {
                    binding: 2,
                    resource: { buffer: this.pathSegmentsStorageBuffer },
                },
                {
                    binding: 3,
                    resource: { buffer: this.geomsStorageBuffer },
                },
                {
                    binding: 4,
                    resource: { buffer: this.materialsStorageBuffer },
                },
                {
                    binding: 5,
                    resource: { buffer: this.intersectionsStorageBuffer },
                },
            ],
        });

        this.pathtracerComputeBindGroupTemp2 = renderer.device.createBindGroup({
            label: "pathtracer temp 2 compute bind group",
            layout: this.pathtracerComputeBindGroupLayout,
            entries: [         
                {
                    binding: 0,
                    resource: this.pathtracerTempRenderTexture2View,
                },
                {
                    binding: 1,
                    resource: this.pathtracerTempRenderTexture1View,
                },
                {
                    binding: 2,
                    resource: { buffer: this.pathSegmentsStorageBuffer },
                },
                {
                    binding: 3,
                    resource: { buffer: this.geomsStorageBuffer },
                },
                {
                    binding: 4,
                    resource: { buffer: this.materialsStorageBuffer },
                },
                {
                    binding: 5,
                    resource: { buffer: this.intersectionsStorageBuffer },
                },
            ],
        });

        this.pathtracerComputePipelineGenerateRay = renderer.device.createComputePipeline({
            label: "pathtracer compute pipeline generate ray",
            layout: renderer.device.createPipelineLayout({
                label: "pathtracer compute pipeline layout generate ray",
                bindGroupLayouts: [this.sceneUniformsBindGroupLayout, this.pathtracerComputeBindGroupLayout],
            }),
            compute: {
                module: renderer.device.createShaderModule({
                    label: "pathtracer compute shader",
                    code: shaders.pathtracerComputeSrc,
                }),
                entryPoint: "generateRay",
            },
        });

        this.pathtracerComputePipelineComputeIntersections = renderer.device.createComputePipeline({
            label: "pathtracer compute pipeline compute intersections",
            layout: renderer.device.createPipelineLayout({
                label: "pathtracer compute pipeline layout intersections",
                bindGroupLayouts: [this.sceneUniformsBindGroupLayout, this.pathtracerComputeBindGroupLayout],
            }),
            compute: {
                module: renderer.device.createShaderModule({
                    label: "pathtracer compute shader",
                    code: shaders.pathtracerComputeSrc,
                }),
                entryPoint: "computeIntersections",
            },
        });

        this.pathtracerComputePipelineIntegrate = renderer.device.createComputePipeline({
            label: "pathtracer compute pipeline integrate",
            layout: renderer.device.createPipelineLayout({
                label: "pathtracer compute pipeline layout integrate",
                bindGroupLayouts: [this.sceneUniformsBindGroupLayout, this.pathtracerComputeBindGroupLayout],
            }),
            compute: {
                module: renderer.device.createShaderModule({
                    label: "pathtracer compute shader",
                    code: shaders.pathtracerComputeSrc,
                }),
                entryPoint: "integrate",
            },
        });
        
        this.pathtracerComputePipelineFinalGather = renderer.device.createComputePipeline({
            label: "pathtracer compute pipeline final gather",
            layout: renderer.device.createPipelineLayout({
                label: "pathtracer compute pipeline layout final gather",
                bindGroupLayouts: [this.sceneUniformsBindGroupLayout, this.pathtracerComputeBindGroupLayout],
            }),
            compute: {
                module: renderer.device.createShaderModule({
                    label: "pathtracer compute shader",
                    code: shaders.pathtracerComputeSrc,
                }),
                entryPoint: "finalGather",
            },
        });
        
        this.pathtracerComputePipelineClearTexture = renderer.device.createComputePipeline({
            label: "pathtracer compute pipeline clear texture",
            layout: renderer.device.createPipelineLayout({
                label: "pathtracer compute pipeline layout clear texture",
                bindGroupLayouts: [this.sceneUniformsBindGroupLayout, this.pathtracerComputeBindGroupLayout],
            }),
            compute: {
                module: renderer.device.createShaderModule({
                    label: "pathtracer compute shader",
                    code: shaders.pathtracerComputeSrc,
                }),
                entryPoint: "clearTexture",
            },
        });
        
        // Pathtracer render pipeline
        this.renderTextureBindGroupLayout = renderer.device.createBindGroupLayout({
            label: "render texture bind group layout",
            entries: [
                {
                    // render texture image
                    binding: 0,
                    visibility: GPUShaderStage.FRAGMENT,
                    texture: {},
                },
            ],
        });

        this.renderTextureBindGroupTemp1 = renderer.device.createBindGroup({
            label: "render texture bind group temp 1",
            layout: this.renderTextureBindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource: this.pathtracerTempRenderTexture1View,
                },
            ],
        });

        this.renderTextureBindGroupTemp2 = renderer.device.createBindGroup({
            label: "render texture bind group temp 2",
            layout: this.renderTextureBindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource: this.pathtracerTempRenderTexture2View,
                },
            ],
        });

        this.pipeline = renderer.device.createRenderPipeline({
            layout: renderer.device.createPipelineLayout({
                label: "pathtracer pipeline layout",
                bindGroupLayouts: [this.renderTextureBindGroupLayout],
            }),
            depthStencil: {
                depthWriteEnabled: true,
                depthCompare: "less",
                format: "depth24plus",
            },
            vertex: {
                module: renderer.device.createShaderModule({
                    label: "pathtracer vert shader",
                    code: shaders.pathtracerVertSrc,
                }),
                buffers: [renderer.vertexBufferLayout],
            },
            fragment: {
                module: renderer.device.createShaderModule({
                    label: "pathtracer frag shader",
                    code: shaders.pathtracerFragSrc,
                }),
                targets: [
                    {
                        format: renderer.canvasFormat,
                    },
                ],
            },
        });
        
        // geomType : f32, // 0 == CUBE, 1 == SPHERE
        // materialid : f32,
        // transform : mat4x4f,
        // inverseTransform : mat4x4f,
        // invTranspose : mat4x4f,
        const identityMat4 = mat4.transpose(mat4.create(1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0));
        for (let geomIdx = 0; geomIdx < Pathtracer.numGeoms; geomIdx++) {
            if (geomIdx == 0) {
                // A cube
                this.geomsArray.set(vec4.create(0, 4, 1, 0), Pathtracer.numFloatsPerGeom * geomIdx + 0);
                this.geomsArray.set(identityMat4, Pathtracer.numFloatsPerGeom * geomIdx + 4);
                this.geomsArray.set(mat4.inverse(identityMat4), Pathtracer.numFloatsPerGeom * geomIdx + 20);
                this.geomsArray.set(mat4.transpose(mat4.inverse(identityMat4)), Pathtracer.numFloatsPerGeom * geomIdx + 36);
            } else if (geomIdx == 1) {
                // Floor
                this.geomsArray.set(vec4.create(0, 0, 2, 0), Pathtracer.numFloatsPerGeom * geomIdx + 0);
                const scaleMat4 = mat4.create(10.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 10.0, 0.0, 0.0, 0.0, 0.0, 1.0);
                const rotateMat4 = identityMat4;
                const translateMat4 = mat4.create(1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, -2.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0);
                const transformMat4 = mat4.transpose(mat4.mul(mat4.mul(scaleMat4, rotateMat4), translateMat4));
                this.geomsArray.set(transformMat4, Pathtracer.numFloatsPerGeom * geomIdx + 4);
                this.geomsArray.set(mat4.inverse(transformMat4), Pathtracer.numFloatsPerGeom * geomIdx + 20);
                this.geomsArray.set(mat4.transpose(mat4.inverse(transformMat4)), Pathtracer.numFloatsPerGeom * geomIdx + 36);
            } else if (geomIdx == 2) {
                // Top light
                this.geomsArray.set(vec4.create(0, 3, 3, 0), Pathtracer.numFloatsPerGeom * geomIdx + 0);
                const scaleMat4 = mat4.create(10.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 10.0, 0.0, 0.0, 0.0, 0.0, 1.0);
                const rotateMat4 = identityMat4;
                const translateMat4 = mat4.create(1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 5.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0);
                const transformMat4 = mat4.transpose(mat4.mul(mat4.mul(scaleMat4, rotateMat4), translateMat4));
                this.geomsArray.set(transformMat4, Pathtracer.numFloatsPerGeom * geomIdx + 4);
                this.geomsArray.set(mat4.inverse(transformMat4), Pathtracer.numFloatsPerGeom * geomIdx + 20);
                this.geomsArray.set(mat4.transpose(mat4.inverse(transformMat4)), Pathtracer.numFloatsPerGeom * geomIdx + 36);
            } else if (geomIdx == 3) {
                // Back Wall
                this.geomsArray.set(vec4.create(0, 0, 4, 0), Pathtracer.numFloatsPerGeom * geomIdx + 0);
                const scaleMat4 = mat4.create(1.0, 0.0, 0.0, 0.0, 0.0, 10.0, 0.0, 0.0, 0.0, 0.0, 10.0, 0.0, 0.0, 0.0, 0.0, 1.0);
                const rotateMat4 = identityMat4;
                const translateMat4 = mat4.create(1.0, 0.0, 0.0, 5.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0);
                const transformMat4 = mat4.transpose(mat4.mul(mat4.mul(scaleMat4, rotateMat4), translateMat4));
                this.geomsArray.set(transformMat4, Pathtracer.numFloatsPerGeom * geomIdx + 4);
                this.geomsArray.set(mat4.inverse(transformMat4), Pathtracer.numFloatsPerGeom * geomIdx + 20);
                this.geomsArray.set(mat4.transpose(mat4.inverse(transformMat4)), Pathtracer.numFloatsPerGeom * geomIdx + 36);
            } else if (geomIdx == 4) {
                // Left Wall
                this.geomsArray.set(vec4.create(0, 1, 5, 0), Pathtracer.numFloatsPerGeom * geomIdx + 0);
                const scaleMat4 = mat4.create(10.0, 0.0, 0.0, 0.0, 0.0, 10.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0);
                const rotateMat4 = identityMat4;
                const translateMat4 = mat4.create(1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 5.0, 0.0, 0.0, 0.0, 1.0);
                const transformMat4 = mat4.transpose(mat4.mul(mat4.mul(scaleMat4, rotateMat4), translateMat4));
                this.geomsArray.set(transformMat4, Pathtracer.numFloatsPerGeom * geomIdx + 4);
                this.geomsArray.set(mat4.inverse(transformMat4), Pathtracer.numFloatsPerGeom * geomIdx + 20);
                this.geomsArray.set(mat4.transpose(mat4.inverse(transformMat4)), Pathtracer.numFloatsPerGeom * geomIdx + 36);
            } else if (geomIdx == 5) {
                // Right Wall
                this.geomsArray.set(vec4.create(0, 2, 6, 0), Pathtracer.numFloatsPerGeom * geomIdx + 0);
                const scaleMat4 = mat4.create(10.0, 0.0, 0.0, 0.0, 0.0, 10.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0);
                const rotateMat4 = identityMat4;
                const translateMat4 = mat4.create(1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, -5.0, 0.0, 0.0, 0.0, 1.0);
                const transformMat4 = mat4.transpose(mat4.mul(mat4.mul(scaleMat4, rotateMat4), translateMat4));
                this.geomsArray.set(transformMat4, Pathtracer.numFloatsPerGeom * geomIdx + 4);
                this.geomsArray.set(mat4.inverse(transformMat4), Pathtracer.numFloatsPerGeom * geomIdx + 20);
                this.geomsArray.set(mat4.transpose(mat4.inverse(transformMat4)), Pathtracer.numFloatsPerGeom * geomIdx + 36);
            } else if (geomIdx == 6) {
                // Left Mirror greyscale
                this.geomsArray.set(vec4.create(0, 6, 7, 0), Pathtracer.numFloatsPerGeom * geomIdx + 0);
                const scaleMat4 = mat4.create(3.0, 0.0, 0.0, 0.0, 0.0, 6.0, 0.0, 0.0, 0.0, 0.0, 3.0, 0.0, 0.0, 0.0, 0.0, 1.0);
                const rotateMat4 = mat4.create(0.7071, 0.0, 0.5, 0.0, 0.0, 1.0, 0.0, 0.0, -0.5, 0.0, 0.7071, 0.0, 0.0, 0.0, 0.0, 1.0); // 45 degrees
                // const rotateMat4 = mat4.create(0.866, 0.0, 0.5, 0.0, 0.0, 1.0, 0.0, 0.0, -0.5, 0.0, 0.866, 0.0, 0.0, 0.0, 0.0, 1.0); // 30 degrees
                const translateMat4 = mat4.create(1.0, 0.0, 0.0, 3.5, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, -3.6, 0.0, 0.0, 0.0, 1.0);
                const transformMat4 = mat4.transpose(mat4.mul(mat4.mul(scaleMat4, rotateMat4), translateMat4));
                this.geomsArray.set(transformMat4, Pathtracer.numFloatsPerGeom * geomIdx + 4);
                this.geomsArray.set(mat4.inverse(transformMat4), Pathtracer.numFloatsPerGeom * geomIdx + 20);
                this.geomsArray.set(mat4.transpose(mat4.inverse(transformMat4)), Pathtracer.numFloatsPerGeom * geomIdx + 36);
            } else if (geomIdx == 7) {
                // Middle Mirror regular 
                this.geomsArray.set(vec4.create(0, 5, 8, 0), Pathtracer.numFloatsPerGeom * geomIdx + 0);
                const scaleMat4 = mat4.create(3.0, 0.0, 0.0, 0.0, 0.0, 6.0, 0.0, 0.0, 0.0, 0.0, 3.0, 0.0, 0.0, 0.0, 0.0, 1.0);
                const rotateMat4 = identityMat4;
                const translateMat4 = mat4.create(1.0, 0.0, 0.0, 5.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0);
                const transformMat4 = mat4.transpose(mat4.mul(mat4.mul(scaleMat4, rotateMat4), translateMat4));
                this.geomsArray.set(transformMat4, Pathtracer.numFloatsPerGeom * geomIdx + 4);
                this.geomsArray.set(mat4.inverse(transformMat4), Pathtracer.numFloatsPerGeom * geomIdx + 20);
                this.geomsArray.set(mat4.transpose(mat4.inverse(transformMat4)), Pathtracer.numFloatsPerGeom * geomIdx + 36);
            } else if (geomIdx == 8) {
                // Right Mirror 
                this.geomsArray.set(vec4.create(0, 7, 9, 0), Pathtracer.numFloatsPerGeom * geomIdx + 0);
                const scaleMat4 = mat4.create(3.0, 0.0, 0.0, 0.0, 0.0, 6.0, 0.0, 0.0, 0.0, 0.0, 3.0, 0.0, 0.0, 0.0, 0.0, 1.0);
                const rotateMat4 = mat4.create(0.5, 0.0, 0.7071, 0.0, 0.0, 1.0, 0.0, 0.0, -0.7071, 0.0, 0.5, 0.0, 0.0, 0.0, 0.0, 1.0); // 45 degrees
                const translateMat4 = mat4.create(1.0, 0.0, 0.0, 3.5, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 3.6, 0.0, 0.0, 0.0, 1.0);
                const transformMat4 = mat4.transpose(mat4.mul(mat4.mul(scaleMat4, rotateMat4), translateMat4));
                this.geomsArray.set(transformMat4, Pathtracer.numFloatsPerGeom * geomIdx + 4);
                this.geomsArray.set(mat4.inverse(transformMat4), Pathtracer.numFloatsPerGeom * geomIdx + 20);
                this.geomsArray.set(mat4.transpose(mat4.inverse(transformMat4)), Pathtracer.numFloatsPerGeom * geomIdx + 36);
            }
        }

        renderer.device.queue.writeBuffer(this.geomsStorageBuffer, 0, new Uint32Array([Pathtracer.numGeoms]));
        renderer.device.queue.writeBuffer(this.geomsStorageBuffer, 16, this.geomsArray);

        // matType : u32, // 0 == emissive, 1 == lambertian, 2 == metal
        // emittance : f32,
        // roughness : f32,
        // styleType : f32
        // color : vec3f,
        for (let matIdx = 0; matIdx < Pathtracer.numMats; matIdx++) {
            if (matIdx == 0) { // white lambertian
                this.materialsArray.set(vec4.create(1.0, 0.0, 0.0, 0.0), Pathtracer.numFloatsPerMat * matIdx + 0);
                this.materialsArray.set(vec4.create(1.0, 1.0, 1.0, 1.0), Pathtracer.numFloatsPerMat * matIdx + 4);
            } else if (matIdx == 1) { // red lambertian
                this.materialsArray.set(vec4.create(1.0, 0.0, 0.0, 0.0), Pathtracer.numFloatsPerMat * matIdx + 0);
                this.materialsArray.set(vec4.create(1.0, 0.0, 0.0, 1.0), Pathtracer.numFloatsPerMat * matIdx + 4);
            } else if (matIdx == 2) { // green lambertian
                this.materialsArray.set(vec4.create(1.0, 0.0, 0.0, 0.0), Pathtracer.numFloatsPerMat * matIdx + 0);
                this.materialsArray.set(vec4.create(0.0, 1.0, 0.0, 1.0), Pathtracer.numFloatsPerMat * matIdx + 4);
            } else if (matIdx == 3) { // light source
                this.materialsArray.set(vec4.create(0.0, 1.0, 0.0, 0.0), Pathtracer.numFloatsPerMat * matIdx + 0);
                this.materialsArray.set(vec4.create(1.0, 1.0, 1.0, 1.0), Pathtracer.numFloatsPerMat * matIdx + 4);
            } else if (matIdx == 4) { // hero model lambertian
                    this.materialsArray.set(vec4.create(1.0, 0.0, 0.0, 0.0), Pathtracer.numFloatsPerMat * matIdx + 0);
                    this.materialsArray.set(vec4.create(1.0, 1.0, 0.0, 1.0), Pathtracer.numFloatsPerMat * matIdx + 4);
            } else if (matIdx == 5) { // perfect mirror
                this.materialsArray.set(vec4.create(2.0, 0.0, 0.0, 0.0), Pathtracer.numFloatsPerMat * matIdx + 0);
                this.materialsArray.set(vec4.create(1.0, 1.0, 1.0, 1.0), Pathtracer.numFloatsPerMat * matIdx + 4);
            } else if (matIdx == 6) { // stylized mirror (greyscale hero model)
                this.materialsArray.set(vec4.create(2.0, 0.0, 0.0, 1.0), Pathtracer.numFloatsPerMat * matIdx + 0);
                this.materialsArray.set(vec4.create(1.0, 1.0, 1.0, 1.0), Pathtracer.numFloatsPerMat * matIdx + 4);
            } else if (matIdx == 7) { // stylized mirror (greyscale whole scene)
                this.materialsArray.set(vec4.create(2.0, 0.0, 0.0, 2.0), Pathtracer.numFloatsPerMat * matIdx + 0);
                this.materialsArray.set(vec4.create(1.0, 1.0, 1.0, 1.0), Pathtracer.numFloatsPerMat * matIdx + 4);
            }
        }

        renderer.device.queue.writeBuffer(this.materialsStorageBuffer, 0, new Uint32Array([Pathtracer.numMats]));
        renderer.device.queue.writeBuffer(this.materialsStorageBuffer, 16, this.materialsArray);
    }

    override draw() {

        const encoder = renderer.device.createCommandEncoder();
        const canvasTextureView = renderer.context.getCurrentTexture().createView();

        const computePass = encoder.beginComputePass();

        // Reset contents of render textures
        computePass.setPipeline(this.pathtracerComputePipelineClearTexture);
        computePass.setBindGroup(shaders.constants.bindGroup_scene, this.sceneUniformsBindGroup);
        computePass.setBindGroup(shaders.constants.bindGroup_pathtracer, this.pathtracerComputeBindGroupTemp1);
        computePass.dispatchWorkgroups(
            Math.ceil(renderer.canvas.width / shaders.constants.workgroupSizeX),
            Math.ceil(renderer.canvas.height / shaders.constants.workgroupSizeY)
        );

        computePass.setBindGroup(shaders.constants.bindGroup_pathtracer, this.pathtracerComputeBindGroupTemp2);
        computePass.dispatchWorkgroups(
            Math.ceil(renderer.canvas.width / shaders.constants.workgroupSizeX),
            Math.ceil(renderer.canvas.height / shaders.constants.workgroupSizeY)
        );

        for (let s = 1; s <= this.camera.samples; s++) {

            // Generate camera rays
            this.camera.updateCameraUniformsCounter();
            computePass.setPipeline(this.pathtracerComputePipelineGenerateRay);
            computePass.setBindGroup(shaders.constants.bindGroup_scene, this.sceneUniformsBindGroup);
            computePass.setBindGroup(shaders.constants.bindGroup_pathtracer, this.pathtracerComputeBindGroupTemp1);
            computePass.dispatchWorkgroups(
                Math.ceil(renderer.canvas.width / shaders.constants.workgroupSizeX),
                Math.ceil(renderer.canvas.height / shaders.constants.workgroupSizeY)
            );
            
            for (let d = this.camera.rayDepth; d >= 0; d--) {
                // Compute ray-scene intersections
                this.camera.updateCameraUniformsCounter();
                computePass.setPipeline(this.pathtracerComputePipelineComputeIntersections);
                computePass.setBindGroup(shaders.constants.bindGroup_scene, this.sceneUniformsBindGroup);
                computePass.setBindGroup(shaders.constants.bindGroup_pathtracer, this.pathtracerComputeBindGroupTemp1);
                computePass.dispatchWorkgroups(
                    Math.ceil(renderer.canvas.width / shaders.constants.workgroupSizeX),
                    Math.ceil(renderer.canvas.height / shaders.constants.workgroupSizeY)
                );

                // Sort rays by materials

                // Evaluate the integral and shade materials
                this.camera.updateCameraUniformsCounter();
                computePass.setPipeline(this.pathtracerComputePipelineIntegrate);
                computePass.setBindGroup(shaders.constants.bindGroup_scene, this.sceneUniformsBindGroup);
                computePass.setBindGroup(shaders.constants.bindGroup_pathtracer, this.pathtracerComputeBindGroupTemp1);
                computePass.dispatchWorkgroups(
                    Math.ceil(renderer.canvas.width / shaders.constants.workgroupSizeX),
                    Math.ceil(renderer.canvas.height / shaders.constants.workgroupSizeY)
                );

                // Stream compaction
            }

            computePass.setPipeline(this.pathtracerComputePipelineFinalGather);
            computePass.setBindGroup(shaders.constants.bindGroup_scene, this.sceneUniformsBindGroup);
            if (s % 2 == 0) {
                computePass.setBindGroup(shaders.constants.bindGroup_pathtracer, this.pathtracerComputeBindGroupTemp1);
            } else {
                computePass.setBindGroup(shaders.constants.bindGroup_pathtracer, this.pathtracerComputeBindGroupTemp2);
            }
            computePass.dispatchWorkgroups(
                Math.ceil(renderer.canvas.width / shaders.constants.workgroupSizeX),
                Math.ceil(renderer.canvas.height / shaders.constants.workgroupSizeY)
            );
        }
        computePass.end();

        const renderPass = encoder.beginRenderPass({
            label: "pathtracer render pass",
            colorAttachments: [
                {
                    view: canvasTextureView,
                    clearValue: [0, 0, 0, 0],
                    loadOp: "clear",
                    storeOp: "store",
                },
            ],
            depthStencilAttachment: {
                view: this.depthTextureView,
                depthClearValue: 1.0,
                depthLoadOp: "clear",
                depthStoreOp: "store",
            },
        });

        renderPass.setPipeline(this.pipeline);
        renderPass.setVertexBuffer(0, this.emptyBuffer);
        if (this.camera.samples % 2 == 0) {
            renderPass.setBindGroup(0, this.renderTextureBindGroupTemp1);
        } else {
            renderPass.setBindGroup(0, this.renderTextureBindGroupTemp2);
        }
        renderPass.draw(6);
        renderPass.end();

        renderer.device.queue.submit([encoder.finish()]);
    }
}
