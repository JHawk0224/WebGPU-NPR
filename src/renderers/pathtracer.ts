import * as renderer from "../renderer";
import * as shaders from "../shaders/shaders";
import { Stage } from "../stage/stage";

export class Pathtracer extends renderer.Renderer {
    sceneUniformsBindGroupLayout: GPUBindGroupLayout;
    sceneUniformsBindGroup: GPUBindGroup;

    depthTexture: GPUTexture;
    depthTextureView: GPUTextureView;

    emptyBuffer: GPUBuffer;

    pathSegmentsStorageBuffer: GPUBuffer;
    intersectionsStorageBuffer: GPUBuffer;

    pathtracerTempRenderTexture1: GPUTexture;
    pathtracerTempRenderTexture2: GPUTexture;

    pathtracerGeometryBindGroup: GPUBindGroup;
    pathtracerGeometryBindGroupLayout: GPUBindGroupLayout;
    pathtracerTextureBindGroup: GPUBindGroup;
    pathtracerTextureBindGroupLayout: GPUBindGroupLayout;

    pathtracerComputeBindGroupLayout: GPUBindGroupLayout;
    pathtracerComputeBindGroupTemp1: GPUBindGroup;
    pathtracerComputeBindGroupTemp2: GPUBindGroup;
    pathtracerComputePipelineGenerateRay: GPUComputePipeline;
    pathtracerComputePipelineComputeIntersections: GPUComputePipeline;
    pathtracerComputePipelineIntegrate: GPUComputePipeline;

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

        const { geometryBindGroup, geometryBindGroupLayout, textureBindGroup, textureBindGroupLayout } =
            this.scene.createBuffersAndBindGroup();
        this.pathtracerGeometryBindGroup = geometryBindGroup;
        this.pathtracerGeometryBindGroupLayout = geometryBindGroupLayout;
        this.pathtracerTextureBindGroup = textureBindGroup;
        this.pathtracerTextureBindGroupLayout = textureBindGroupLayout;

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
                    // intersections
                    binding: 3,
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
                    resource: this.pathtracerTempRenderTexture1.createView(),
                },
                {
                    binding: 1,
                    resource: this.pathtracerTempRenderTexture2.createView(),
                },
                {
                    binding: 2,
                    resource: { buffer: this.pathSegmentsStorageBuffer },
                },
                {
                    binding: 3,
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
                    resource: this.pathtracerTempRenderTexture2.createView(),
                },
                {
                    binding: 1,
                    resource: this.pathtracerTempRenderTexture1.createView(),
                },
                {
                    binding: 2,
                    resource: { buffer: this.pathSegmentsStorageBuffer },
                },
                {
                    binding: 3,
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
                bindGroupLayouts: [
                    this.sceneUniformsBindGroupLayout,
                    this.pathtracerComputeBindGroupLayout,
                    this.pathtracerGeometryBindGroupLayout,
                ],
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
                bindGroupLayouts: [
                    this.sceneUniformsBindGroupLayout,
                    this.pathtracerComputeBindGroupLayout,
                    this.pathtracerTextureBindGroupLayout,
                ],
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

        this.renderTextureBindGroupTemp1 = renderer.device.createBindGroup({
            label: "render texture bind group temp 1",
            layout: this.renderTextureBindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource: this.pathtracerTempRenderTexture1.createView(),
                },
            ],
        });

        this.renderTextureBindGroupTemp2 = renderer.device.createBindGroup({
            label: "render texture bind group temp 2",
            layout: this.renderTextureBindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource: this.pathtracerTempRenderTexture2.createView(),
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
        const encoder = renderer.device.createCommandEncoder();
        const canvasTextureView = renderer.context.getCurrentTexture().createView();

        for (let s = 0; s < this.camera.samples; s++) {
            const computePass = encoder.beginComputePass();

            // Generate camera rays
            computePass.setPipeline(this.pathtracerComputePipelineGenerateRay);
            computePass.setBindGroup(shaders.constants.bindGroup_scene, this.sceneUniformsBindGroup);
            computePass.setBindGroup(shaders.constants.bindGroup_pathtracer, this.pathtracerComputeBindGroupTemp1);
            computePass.dispatchWorkgroups(
                Math.ceil(renderer.canvas.width / shaders.constants.workgroupSizeX),
                Math.ceil(renderer.canvas.height / shaders.constants.workgroupSizeY)
            );

            for (let d = this.camera.rayDepth; d >= 0; d--) {
                this.camera.updateDepth(d);

                if (s % 2 == 0) {
                    // Compute ray-scene intersections
                    computePass.setPipeline(this.pathtracerComputePipelineComputeIntersections);
                    computePass.setBindGroup(shaders.constants.bindGroup_scene, this.sceneUniformsBindGroup);
                    computePass.setBindGroup(
                        shaders.constants.bindGroup_pathtracer,
                        this.pathtracerComputeBindGroupTemp1
                    );
                    computePass.setBindGroup(shaders.constants.bindGroup_geometry, this.pathtracerGeometryBindGroup);
                    computePass.dispatchWorkgroups(
                        Math.ceil(renderer.canvas.width / shaders.constants.workgroupSizeX),
                        Math.ceil(renderer.canvas.height / shaders.constants.workgroupSizeY)
                    );

                    // Sort rays by materials

                    // Evaluate the integral and shade materials
                    computePass.setPipeline(this.pathtracerComputePipelineIntegrate);
                    computePass.setBindGroup(shaders.constants.bindGroup_scene, this.sceneUniformsBindGroup);
                    computePass.setBindGroup(
                        shaders.constants.bindGroup_pathtracer,
                        this.pathtracerComputeBindGroupTemp1
                    );
                    computePass.setBindGroup(shaders.constants.bindGroup_textures, this.pathtracerTextureBindGroup);
                    computePass.dispatchWorkgroups(
                        Math.ceil(renderer.canvas.width / shaders.constants.workgroupSizeX),
                        Math.ceil(renderer.canvas.height / shaders.constants.workgroupSizeY)
                    );

                    // Stream compaction
                } else {
                    // Compute ray-scene intersections
                    computePass.setPipeline(this.pathtracerComputePipelineComputeIntersections);
                    computePass.setBindGroup(shaders.constants.bindGroup_scene, this.sceneUniformsBindGroup);
                    computePass.setBindGroup(
                        shaders.constants.bindGroup_pathtracer,
                        this.pathtracerComputeBindGroupTemp2
                    );
                    computePass.setBindGroup(shaders.constants.bindGroup_geometry, this.pathtracerGeometryBindGroup);
                    computePass.dispatchWorkgroups(
                        Math.ceil(renderer.canvas.width / shaders.constants.workgroupSizeX),
                        Math.ceil(renderer.canvas.height / shaders.constants.workgroupSizeY)
                    );

                    // Sort rays by materials

                    // Evaluate the integral and shade materials
                    computePass.setPipeline(this.pathtracerComputePipelineIntegrate);
                    computePass.setBindGroup(shaders.constants.bindGroup_scene, this.sceneUniformsBindGroup);
                    computePass.setBindGroup(
                        shaders.constants.bindGroup_pathtracer,
                        this.pathtracerComputeBindGroupTemp2
                    );
                    computePass.setBindGroup(shaders.constants.bindGroup_textures, this.pathtracerTextureBindGroup);
                    computePass.dispatchWorkgroups(
                        Math.ceil(renderer.canvas.width / shaders.constants.workgroupSizeX),
                        Math.ceil(renderer.canvas.height / shaders.constants.workgroupSizeY)
                    );

                    // Stream compaction
                }
            }
            computePass.end();
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
        renderPass.setVertexBuffer(0, this.emptyBuffer);
        if (this.camera.samples % 2 == 0) {
            renderPass.setBindGroup(0, this.renderTextureBindGroupTemp2);
        } else {
            renderPass.setBindGroup(0, this.renderTextureBindGroupTemp1);
        }
        renderPass.draw(6);
        renderPass.end();

        renderer.device.queue.submit([encoder.finish()]);
    }
}
