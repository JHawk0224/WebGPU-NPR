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

    geomsArray = new Float32Array(60);

    pathSegmentsStorageBuffer: GPUBuffer;
    geomsStorageBuffer: GPUBuffer;
    materialsStorageBuffer: GPUBuffer;
    intersectionsStorageBuffer: GPUBuffer;

    pathtracerRenderTexture: GPUTexture;

    pathtracerComputeBindGroupLayout: GPUBindGroupLayout;
    pathtracerComputeBindGroup: GPUBindGroup;
    pathtracerComputePipelineGenerateRay: GPUComputePipeline;
    pathtracerComputePipelineComputeIntersections: GPUComputePipeline;
    pathtracerComputePipelineIntegrate: GPUComputePipeline;

    renderTextureBindGroupLayout: GPUBindGroupLayout;
    renderTextureBindGroup: GPUBindGroup;

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
            size: 16 + 240 * 2, // 16 + 240 * number of geoms
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });

        this.materialsStorageBuffer = renderer.device.createBuffer({
            label: "materials",
            size: 16 + 32 * 2,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });

        this.intersectionsStorageBuffer = renderer.device.createBuffer({
            label: "intersections",
            size: 32 * shaders.constants.maxResolutionWidth * shaders.constants.maxResolutionHeight,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });

        this.pathtracerRenderTexture = renderer.device.createTexture({
            label: "render texture",
            size: {
                width: renderer.canvas.width,
                height: renderer.canvas.height,
            },
            format: "rgba8unorm",
            usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        });

        this.pathtracerComputeBindGroupLayout = renderer.device.createBindGroupLayout({
            label: "pathtracer compute bind group layout",
            entries: [
                {
                    // render texture
                    binding: 0,
                    visibility: GPUShaderStage.COMPUTE,
                    storageTexture: { format: "rgba8unorm" },
                },
                {
                    // path segments
                    binding: 1,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: "storage" },
                },
                {
                    // geoms
                    binding: 2,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: "storage" },
                },
                {
                    // materials
                    binding: 3,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: "storage" },
                },
                {
                    // intersections
                    binding: 4,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: "storage" },
                },
            ],
        });

        this.pathtracerComputeBindGroup = renderer.device.createBindGroup({
            label: "pathtracer compute bind group",
            layout: this.pathtracerComputeBindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource: this.pathtracerRenderTexture.createView(),
                },
                {
                    binding: 1,
                    resource: { buffer: this.pathSegmentsStorageBuffer },
                },
                {
                    binding: 2,
                    resource: { buffer: this.geomsStorageBuffer },
                },
                {
                    binding: 3,
                    resource: { buffer: this.materialsStorageBuffer },
                },
                {
                    binding: 4,
                    resource: { buffer: this.intersectionsStorageBuffer },
                },
            ],
        });

        this.pathtracerComputePipelineGenerateRay = renderer.device.createComputePipeline({
            label: "pathtracer compute pipeline generate ray",
            layout: renderer.device.createPipelineLayout({
                label: "pathtracer compute pipeline layout",
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
                label: "pathtracer compute pipeline layout",
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
                label: "pathtracer compute pipeline layout",
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

        this.renderTextureBindGroup = renderer.device.createBindGroup({
            label: "render texture bind group",
            layout: this.renderTextureBindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource: this.pathtracerRenderTexture.createView(),
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
    }

    override draw() {
        // A cube
        for (let geomIdx = 0; geomIdx < 1; geomIdx++) {
            this.geomsArray.set(mat4.identity(), 0);
            this.geomsArray.set(mat4.identity(), 16);
            this.geomsArray.set(mat4.identity(), 32);
            this.geomsArray.set(vec4.zero(), 48);
            this.geomsArray.set(vec4.zero(), 52);
            this.geomsArray.set(vec4.zero(), 56);
        }

        renderer.device.queue.writeBuffer(this.geomsStorageBuffer, 0, new Uint32Array([1]));
        renderer.device.queue.writeBuffer(this.geomsStorageBuffer, 16, this.geomsArray);

        const encoder = renderer.device.createCommandEncoder();
        const canvasTextureView = renderer.context.getCurrentTexture().createView();

        for (let s = 0; s < this.camera.samples; s++) {
            for (let d = 0; d < this.camera.rayDepth; d++) {
                this.camera.updateDepth(this.camera.rayDepth - d);

                const computePass = encoder.beginComputePass();

                // Generate camera rays
                computePass.setPipeline(this.pathtracerComputePipelineGenerateRay);
                computePass.setBindGroup(0, this.sceneUniformsBindGroup);
                computePass.setBindGroup(shaders.constants.bindGroup_pathtracer, this.pathtracerComputeBindGroup);
                computePass.dispatchWorkgroups(
                    Math.ceil(renderer.canvas.width / shaders.constants.workgroupSizeX),
                    Math.ceil(renderer.canvas.height / shaders.constants.workgroupSizeY)
                );

                // Compute ray-scene intersections
                computePass.setPipeline(this.pathtracerComputePipelineComputeIntersections);
                computePass.setBindGroup(0, this.sceneUniformsBindGroup);
                computePass.setBindGroup(shaders.constants.bindGroup_pathtracer, this.pathtracerComputeBindGroup);
                computePass.dispatchWorkgroups(
                    Math.ceil(renderer.canvas.width / shaders.constants.workgroupSizeX),
                    Math.ceil(renderer.canvas.height / shaders.constants.workgroupSizeY)
                );

                // Sort rays by materials

                // Evaluate the integral and shade materials
                computePass.setPipeline(this.pathtracerComputePipelineIntegrate);
                computePass.setBindGroup(0, this.sceneUniformsBindGroup);
                computePass.setBindGroup(shaders.constants.bindGroup_pathtracer, this.pathtracerComputeBindGroup);
                computePass.dispatchWorkgroups(
                    Math.ceil(renderer.canvas.width / shaders.constants.workgroupSizeX),
                    Math.ceil(renderer.canvas.height / shaders.constants.workgroupSizeY)
                );

                // Stream compaction

                computePass.end();
            }
        }

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
        // TODO: we shouldn't need to set an empty vertex buffer. Need to look into fixing this.
        renderPass.setVertexBuffer(0, this.emptyBuffer);
        renderPass.setBindGroup(0, this.renderTextureBindGroup);
        renderPass.draw(6);
        renderPass.end();

        renderer.device.queue.submit([encoder.finish()]);
    }
}
