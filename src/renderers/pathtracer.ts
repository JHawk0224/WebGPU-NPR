import * as renderer from "../renderer";
import * as shaders from "../shaders/shaders";
import { Stage } from "../stage/stage";
import { ClothSimulator } from "../stage/cloth";

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

    clothSimulator: ClothSimulator;
    frameCount: number = 0;

    numFramesAveraged: number;

    constructor(stage: Stage) {
        super(stage);

        this.numFramesAveraged = 0;

        this.sceneUniformsBindGroupLayout = renderer.device.createBindGroupLayout({
            label: "scene uniforms bind group layout",
            entries: [
                {
                    // cameraSet
                    binding: 0,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: "uniform" },
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

        this.scene.addCustomObjects();

        this.clothSimulator = new ClothSimulator();
        this.scene.appendClothGeometry(this.clothSimulator);
        this.scene.createBuffers();
        this.scene.createBindGroups();

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
                    this.scene.geometryBindGroupLayout!,
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
                    this.scene.textureBindGroupLayout!,
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
    }

    override async draw() {
        this.frameCount++;

        let resetAccumulation = this.camera.updated;

        // run cloth simulation every 10 frames
        if (this.frameCount % 400 === 0) {
            const encoder = renderer.device.createCommandEncoder();

                for (let i = 0; i < 50; i++) {

                    const computePass = encoder.beginComputePass();
                    computePass.setPipeline(this.clothSimulator.computePipeline);
                    computePass.setBindGroup(0, this.clothSimulator.bindGroup);
                    computePass.setBindGroup(1, this.scene.geometryBindGroup!);
                    const workgroupSize = 256;
                    const numVertices = this.clothSimulator.clothMesh.positionsArray.length;
                    computePass.dispatchWorkgroups(Math.ceil(numVertices / workgroupSize));
                    computePass.end();
                }
                const vertexSize = 3 * 4 * 4;
                const clothVertexCount = this.clothSimulator.clothMesh.positionsArray.length;
                const clothBufferSize = clothVertexCount * vertexSize;
                const stagingBuffer = renderer.device.createBuffer({
                    size: clothBufferSize,
                    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
                });
                encoder.copyBufferToBuffer(this.clothSimulator.vertexBuffer, 0, stagingBuffer, 0, clothBufferSize);

                renderer.device.queue.submit([encoder.finish()]);

                await stagingBuffer.mapAsync(GPUMapMode.READ);
                const vertexData = stagingBuffer.getMappedRange();
                const vertexHostBuffer = new Float32Array(vertexData);

                this.scene.setClothVertexDataFromBuffer(vertexHostBuffer);
                stagingBuffer.unmap();
                this.scene.createVertexBuffer();
                this.scene.rebuildBVH();

                resetAccumulation = true;
            
        }

        const encoder = renderer.device.createCommandEncoder();
        const canvasTextureView = renderer.context.getCurrentTexture().createView();

        const computePass = encoder.beginComputePass();

        if (resetAccumulation) {
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
            this.numFramesAveraged = 0;
            this.camera.updated = false;
        }

        this.camera.updateCameraUniformsNumFrames(this.numFramesAveraged);

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
            computePass.setBindGroup(shaders.constants.bindGroup_geometry, this.scene.geometryBindGroup!);
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
            computePass.setBindGroup(shaders.constants.bindGroup_textures, this.scene.textureBindGroup!);
            computePass.dispatchWorkgroups(
                Math.ceil(renderer.canvas.width / shaders.constants.workgroupSizeX),
                Math.ceil(renderer.canvas.height / shaders.constants.workgroupSizeY)
            );

            // Stream compaction
        }

        computePass.setPipeline(this.pathtracerComputePipelineFinalGather);
        computePass.setBindGroup(shaders.constants.bindGroup_scene, this.sceneUniformsBindGroup);
        if (this.numFramesAveraged % 2 == 0) {
            computePass.setBindGroup(shaders.constants.bindGroup_pathtracer, this.pathtracerComputeBindGroupTemp1);
        } else {
            computePass.setBindGroup(shaders.constants.bindGroup_pathtracer, this.pathtracerComputeBindGroupTemp2);
        }
        computePass.dispatchWorkgroups(
            Math.ceil(renderer.canvas.width / shaders.constants.workgroupSizeX),
            Math.ceil(renderer.canvas.height / shaders.constants.workgroupSizeY)
        );
        computePass.end();

        this.numFramesAveraged += 1;

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
        if (this.numFramesAveraged % 2 == 1) {
            renderPass.setBindGroup(0, this.renderTextureBindGroupTemp1);
        } else {
            renderPass.setBindGroup(0, this.renderTextureBindGroupTemp2);
        }
        renderPass.draw(6);
        renderPass.end();

        renderer.device.queue.submit([encoder.finish()]);
    }
}
