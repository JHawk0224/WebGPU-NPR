import { vec3, mat4, Mat4, Vec3 } from "wgpu-matrix";
import * as renderer from "../renderer";
import * as shaders from "../shaders/shaders";
import { Stage } from "../stage/stage";
import { GeomData, TriangleData, MaterialData } from "../stage/scene";

export class Pathtracer extends renderer.Renderer {
    sceneUniformsBindGroupLayout: GPUBindGroupLayout;
    sceneUniformsBindGroup: GPUBindGroup;

    depthTexture: GPUTexture;
    depthTextureView: GPUTextureView;

    emptyBuffer: GPUBuffer;

    geomsBufferData: ArrayBuffer;
    trisBufferData: ArrayBuffer;
    bvhNodesBufferData: ArrayBuffer;
    materialsBufferData: ArrayBuffer;

    pathSegmentsStorageBuffer: GPUBuffer;
    geomsStorageBuffer: GPUBuffer;
    trisStorageBuffer: GPUBuffer;
    bvhNodesStorageBuffer: GPUBuffer;
    materialsStorageBuffer: GPUBuffer;
    intersectionsStorageBuffer: GPUBuffer;

    pathtracerTempRenderTexture1: GPUTexture;
    pathtracerTempRenderTexture2: GPUTexture;

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

    createGeometryBuffers() {
        const { geomsArray, trianglesArray, bvhNodesArray } = this.scene.constructGeometry();

        // const identityMat4 = mat4.transpose(
        //     mat4.create(1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0)
        // );
        // for (let geomIdx = 0; geomIdx < 4; geomIdx++) {
        //     if (geomIdx == 0) {
        //         // A cube
        //         const geom: GeomData = {
        //             transform: identityMat4,
        //             inverseTransform: mat4.inverse(identityMat4),
        //             invTranspose: mat4.transpose(mat4.inverse(identityMat4)),
        //             geomType: 0,
        //             materialId: 0,
        //             triangleCount: 0,
        //             triangleStartIdx: 0,
        //         };
        //         geomsArray.push(geom);
        //     } else if (geomIdx == 1) {
        //         // Left Light
        //         const translateMat4 = mat4.transpose(
        //             mat4.create(1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 2.0, 0.0, 0.0, 1.0, 1.0, 0.0, 0.0, 0.0, 1.0)
        //         );
        //         const geom: GeomData = {
        //             transform: translateMat4,
        //             inverseTransform: mat4.inverse(translateMat4),
        //             invTranspose: mat4.transpose(mat4.inverse(translateMat4)),
        //             geomType: 0,
        //             materialId: 1,
        //             triangleCount: 0,
        //             triangleStartIdx: 0,
        //         };
        //         geomsArray.push(geom);
        //     } else if (geomIdx == 2) {
        //         // Triangle
        //         const translateMat4 = mat4.transpose(
        //             mat4.create(1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 2.0, 0.0, 0.0, 1.0, -1.0, 0.0, 0.0, 0.0, 1.0)
        //         );
        //         const geom: GeomData = {
        //             transform: identityMat4,
        //             inverseTransform: mat4.inverse(identityMat4),
        //             invTranspose: mat4.transpose(mat4.inverse(identityMat4)),
        //             geomType: 2,
        //             materialId: 0,
        //             triangleCount: 2,
        //             triangleStartIdx: trianglesArray.length,
        //         };
        //         const triangle = {
        //             v0: vec3.create(0.0, 0.0, 0.0),
        //             v1: vec3.create(0.0, 2.0, 1.0),
        //             v2: vec3.create(0.0, 2.0, -1.0),
        //             materialId: 0,
        //         };
        //         const triangle2 = {
        //             v0: vec3.create(0.0, 0.0, 3.0),
        //             v1: vec3.create(0.0, 2.0, 4.0),
        //             v2: vec3.create(0.0, 2.0, 2.0),
        //             materialId: 0,
        //         };
        //         geomsArray.push(geom);
        //         trianglesArray.push(triangle);
        //         trianglesArray.push(triangle2);
        //     } else {
        //         // Right Light
        //         const translateMat4 = mat4.transpose(
        //             mat4.create(1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 2.0, 0.0, 0.0, 1.0, -1.0, 0.0, 0.0, 0.0, 1.0)
        //         );
        //         const geom: GeomData = {
        //             transform: translateMat4,
        //             inverseTransform: mat4.inverse(translateMat4),
        //             invTranspose: mat4.transpose(mat4.inverse(translateMat4)),
        //             geomType: 1,
        //             materialId: 2,
        //             triangleCount: 0,
        //             triangleStartIdx: 0,
        //         };
        //         geomsArray.push(geom);
        //     }
        // }

        // Prepare geoms buffer
        const geomsSize = geomsArray.length;
        const geomsBufferSize = 16 + geomsSize * (16 * 4 * 3 + 16 * 2);
        const geomsBuffer = new ArrayBuffer(geomsBufferSize);
        const geomsDataView = new DataView(geomsBuffer);
        let offset = 0;

        geomsDataView.setUint32(offset, geomsSize, true);
        offset += 16;

        for (const geomData of geomsArray) {
            for (const mat of [geomData.transform, geomData.inverseTransform, geomData.invTranspose]) {
                for (let i = 0; i < 16; i++) {
                    geomsDataView.setFloat32(offset, mat[i], true);
                    offset += 4;
                }
            }
            geomsDataView.setUint32(offset, geomData.geomType, true);
            offset += 4;
            geomsDataView.setInt32(offset, geomData.materialId, true);
            offset += 4;
            geomsDataView.setUint32(offset, geomData.triangleCount, true);
            offset += 4;
            geomsDataView.setInt32(offset, geomData.triangleStartIdx, true);
            offset += 4;
            geomsDataView.setInt32(offset, geomData.bvhRootNodeIdx, true);
            offset += 16;
        }

        // Prepare triangles buffer
        const trianglesSize = trianglesArray.length;
        const trisBufferSize = 16 + trianglesSize * (16 * 3 + 16);
        const trisBuffer = new ArrayBuffer(trisBufferSize);
        const trisDataView = new DataView(trisBuffer);
        offset = 0;

        trisDataView.setUint32(offset, trianglesSize, true);
        offset += 16;

        for (const triangle of trianglesArray) {
            for (const vertex of [triangle.v0, triangle.v1, triangle.v2]) {
                for (let i = 0; i < 3; i++) {
                    trisDataView.setFloat32(offset, vertex[i], true);
                    offset += 4;
                }
                offset += 4;
            }
            trisDataView.setInt32(offset, triangle.materialId, true);
            offset += 16;
        }

        const bvhNodesSize = bvhNodesArray.length;
        const bvhNodesBufferSize = 16 + bvhNodesSize * (16 * 3);
        const bvhNodesBuffer = new ArrayBuffer(bvhNodesBufferSize);
        const bvhDataView = new DataView(bvhNodesBuffer);
        offset = 0;

        bvhDataView.setUint32(offset, bvhNodesSize, true);
        offset += 16;

        for (const node of bvhNodesArray) {
            for (let i = 0; i < 3; i++) {
                bvhDataView.setFloat32(offset, node.boundsMin[i], true);
                offset += 4;
            }
            offset += 4;
            for (let i = 0; i < 3; i++) {
                bvhDataView.setFloat32(offset, node.boundsMax[i], true);
                offset += 4;
            }
            offset += 4;
            bvhDataView.setInt32(offset, node.leftChild, true);
            offset += 4;
            bvhDataView.setInt32(offset, node.rightChild, true);
            offset += 4;
            bvhDataView.setInt32(offset, node.triangleStart, true);
            offset += 4;
            bvhDataView.setUint32(offset, node.triangleCount, true);
            offset += 4;
        }

        return { geomsBuffer, trisBuffer, bvhNodesBuffer };
    }

    createMaterialsBuffer() {
        const materialsArray: number[] = [];
        this.scene.iterate(
            () => {},
            (material) => {
                materialsArray.push(material.color[0], material.color[1], material.color[2]);
                materialsArray.push(material.matType);
                materialsArray.push(material.emittance);
                materialsArray.push(material.roughness);
            },
            () => {}
        );

        const mat = {
            matType: 1,
            emittance: 1.0,
            roughness: 0.0,
            color: vec3.create(0.0, 1.0, 0.0),
        };
        const matIdx = 0;
        materialsArray[matIdx * 6 + 0] = mat.color[0];
        materialsArray[matIdx * 6 + 1] = mat.color[1];
        materialsArray[matIdx * 6 + 2] = mat.color[2];
        materialsArray[matIdx * 6 + 3] = mat.matType;
        materialsArray[matIdx * 6 + 4] = mat.emittance;
        materialsArray[matIdx * 6 + 5] = mat.roughness;

        const materialsSize = materialsArray.length / 6;
        const buffer = new ArrayBuffer(16 + materialsSize * (16 + 16));
        const dataView = new DataView(buffer);
        let offset = 0;

        dataView.setUint32(offset, materialsSize, true);
        offset += 16;

        for (let i = 0; i < materialsArray.length; i += 6) {
            dataView.setFloat32(offset, materialsArray[i], true); // color.x
            offset += 4;
            dataView.setFloat32(offset, materialsArray[i + 1], true); // color.y
            offset += 4;
            dataView.setFloat32(offset, materialsArray[i + 2], true); // color.z
            offset += 4;
            dataView.setUint32(offset, materialsArray[i + 3], true); // matType
            offset += 4;
            dataView.setFloat32(offset, materialsArray[i + 4], true); // emittance
            offset += 4;
            dataView.setFloat32(offset, materialsArray[i + 5], true); // roughness
            offset += 12;
        }

        return buffer;
    }

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

        const { geomsBuffer, trisBuffer, bvhNodesBuffer } = this.createGeometryBuffers();
        this.geomsBufferData = geomsBuffer;
        this.trisBufferData = trisBuffer;
        this.bvhNodesBufferData = bvhNodesBuffer;
        this.materialsBufferData = this.createMaterialsBuffer();

        this.geomsStorageBuffer = renderer.device.createBuffer({
            label: "geoms",
            size: this.geomsBufferData.byteLength,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });

        this.trisStorageBuffer = renderer.device.createBuffer({
            label: "tris",
            size: this.trisBufferData.byteLength,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });

        this.bvhNodesStorageBuffer = renderer.device.createBuffer({
            label: "BVH nodes",
            size: this.bvhNodesBufferData.byteLength,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });

        this.materialsStorageBuffer = renderer.device.createBuffer({
            label: "materials",
            size: this.materialsBufferData.byteLength,
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
                    buffer: { type: "read-only-storage" },
                },
                {
                    // tris
                    binding: 4,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: "read-only-storage" },
                },
                {
                    // bvh nodes
                    binding: 5,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: "read-only-storage" },
                },
                {
                    // materials
                    binding: 6,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: "read-only-storage" },
                },
                {
                    // intersections
                    binding: 7,
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
                    resource: { buffer: this.geomsStorageBuffer },
                },
                {
                    binding: 4,
                    resource: { buffer: this.trisStorageBuffer },
                },
                {
                    binding: 5,
                    resource: { buffer: this.bvhNodesStorageBuffer },
                },
                {
                    binding: 6,
                    resource: { buffer: this.materialsStorageBuffer },
                },
                {
                    binding: 7,
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
                    resource: { buffer: this.geomsStorageBuffer },
                },
                {
                    binding: 4,
                    resource: { buffer: this.trisStorageBuffer },
                },
                {
                    binding: 5,
                    resource: { buffer: this.bvhNodesStorageBuffer },
                },
                {
                    binding: 6,
                    resource: { buffer: this.materialsStorageBuffer },
                },
                {
                    binding: 7,
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

        renderer.device.queue.writeBuffer(this.geomsStorageBuffer, 0, this.geomsBufferData);
        renderer.device.queue.writeBuffer(this.trisStorageBuffer, 0, this.trisBufferData);
        renderer.device.queue.writeBuffer(this.bvhNodesStorageBuffer, 0, this.bvhNodesBufferData);
        renderer.device.queue.writeBuffer(this.materialsStorageBuffer, 0, this.materialsBufferData);
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
