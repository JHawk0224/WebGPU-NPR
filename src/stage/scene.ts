import { registerLoaders, load } from "@loaders.gl/core";
import { GLTFLoader, GLTFWithBuffers } from "@loaders.gl/gltf";
import { ImageLoader } from "@loaders.gl/images";
import { vec2, Vec2, vec3, Vec3, Mat4, mat4 } from "wgpu-matrix";
import { ClothSimulator } from "./cloth";
import { device } from "../renderer";

export interface GeomData {
    transform: Mat4;
    inverseTransform: Mat4;
    invTranspose: Mat4;
    geomType: number;
    materialId: number;
    triangleCount: number;
    triangleStartIdx: number;
    bvhRootNodeIdx: number;
    objectId: number;
}

export interface VertexData {
    position: Vec3;
    normal: Vec3;
    uv: Vec2;
}

export interface TriangleData {
    v0: number;
    v1: number;
    v2: number;
    materialId: number;
}

export interface TextureDescriptor {
    width: number;
    height: number;
    offset: number;
    wrapS: number; // Wrap mode for U coordinate
    wrapT: number; // Wrap mode for V coordinate
    minFilter: number; // Minification filter
    magFilter: number; // Magnification filter
}

export interface MaterialData {
    baseColorFactor: number[];
    baseColorTextureIndex: number;
    metallicFactor: number;
    roughnessFactor: number;
    emissiveFactor: number[];
    emissiveTextureIndex: number;
    normalTextureIndex: number;
    matType: number;
}

export interface BVHNodeData {
    boundsMin: Vec3;
    boundsMax: Vec3;
    leftChild: number;
    rightChild: number;
    triangleStart: number;
    triangleCount: number;
}

// Wrap modes
const WRAP_MODE_REPEAT = 0;
const WRAP_MODE_CLAMP_TO_EDGE = 1;
const WRAP_MODE_MIRRORED_REPEAT = 2;

// Filter modes
const FILTER_NEAREST = 0;
const FILTER_LINEAR = 1;

function mapWrapMode(glWrapMode: number): number {
    switch (glWrapMode) {
        case 0x2901: // REPEAT
            return WRAP_MODE_REPEAT;
        case 0x812f: // CLAMP_TO_EDGE
            return WRAP_MODE_CLAMP_TO_EDGE;
        case 0x8370: // MIRRORED_REPEAT
            return WRAP_MODE_MIRRORED_REPEAT;
        default:
            return WRAP_MODE_REPEAT;
    }
}

function mapFilterMode(glFilterMode: number): number {
    switch (glFilterMode) {
        case 0x2600: // NEAREST
            return FILTER_NEAREST;
        case 0x2601: // LINEAR
            return FILTER_LINEAR;
        default:
            return FILTER_LINEAR;
    }
}

function getFloatArray(gltfWithBuffers: GLTFWithBuffers, accessorIndex: number): Float32Array | null {
    const gltf = gltfWithBuffers.json;
    const accessor = gltf.accessors?.[accessorIndex];
    if (!accessor) {
        console.warn(`Accessor at index ${accessorIndex} is undefined`);
        return null;
    }

    if (accessor.componentType !== 5126) {
        console.warn(`Unsupported componentType: ${accessor.componentType}`);
        return null;
    }

    const bufferViewIndex = accessor.bufferView;
    if (bufferViewIndex === undefined) {
        console.warn(`Accessor at index ${accessorIndex} has undefined bufferView`);
        return null;
    }

    const bufferView = gltf.bufferViews?.[bufferViewIndex];
    if (!bufferView) {
        console.warn(`BufferView at index ${bufferViewIndex} is undefined`);
        return null;
    }

    const bufferIndex = bufferView.buffer;
    const buffer = gltfWithBuffers.buffers[bufferIndex];
    if (!buffer) {
        console.warn(`Buffer at index ${bufferIndex} is undefined`);
        return null;
    }

    const accessorByteOffset = accessor.byteOffset ?? 0;
    const bufferViewByteOffset = bufferView.byteOffset ?? 0;
    const byteOffset = accessorByteOffset + bufferViewByteOffset;

    const numComponents = {
        SCALAR: 1,
        VEC2: 2,
        VEC3: 3,
        VEC4: 4,
        MAT2: 4,
        MAT3: 9,
        MAT4: 16,
    }[accessor.type];

    if (numComponents === undefined) {
        throw new Error(`Unknown accessor type: ${accessor.type}`);
    }

    const byteLength = accessor.count * numComponents * Float32Array.BYTES_PER_ELEMENT;

    if (!buffer.arrayBuffer) {
        console.warn(`Buffer at index ${bufferIndex} has undefined arrayBuffer`);
        return null;
    }

    if (byteOffset + byteLength > buffer.arrayBuffer.byteLength) {
        console.warn(
            `Attempting to read beyond buffer length. ByteOffset: ${byteOffset}, ByteLength: ${byteLength}, Buffer length: ${buffer.arrayBuffer.byteLength}`
        );
        return null;
    }

    return new Float32Array(buffer.arrayBuffer, byteOffset, accessor.count * numComponents);
}

function getIndexArray(
    gltfWithBuffers: GLTFWithBuffers,
    accessorIndex: number
): Uint8Array | Uint16Array | Uint32Array | null {
    const gltf = gltfWithBuffers.json;
    const accessor = gltf.accessors?.[accessorIndex];
    if (!accessor) {
        console.warn(`Accessor at index ${accessorIndex} is undefined`);
        return null;
    }

    const bufferViewIndex = accessor.bufferView;
    if (bufferViewIndex === undefined) {
        console.warn(`Accessor at index ${accessorIndex} has undefined bufferView`);
        return null;
    }

    const bufferView = gltf.bufferViews?.[bufferViewIndex];
    if (!bufferView) {
        console.warn(`BufferView at index ${bufferViewIndex} is undefined`);
        return null;
    }

    const bufferIndex = bufferView.buffer;
    const buffer = gltfWithBuffers.buffers[bufferIndex];
    if (!buffer) {
        console.warn(`Buffer at index ${bufferIndex} is undefined`);
        return null;
    }

    const accessorByteOffset = accessor.byteOffset ?? 0;
    const bufferViewByteOffset = bufferView.byteOffset ?? 0;
    const byteOffset = accessorByteOffset + bufferViewByteOffset;

    const componentType = accessor.componentType;
    let arrayConstructor: any;
    switch (componentType) {
        case 5121: // UNSIGNED_BYTE
            arrayConstructor = Uint8Array;
            break;
        case 5123: // UNSIGNED_SHORT
            arrayConstructor = Uint16Array;
            break;
        case 5125: // UNSIGNED_INT
            arrayConstructor = Uint32Array;
            break;
        default:
            console.warn(`Unsupported index componentType: ${componentType}`);
            return null;
    }

    const byteLength = accessor.count * arrayConstructor.BYTES_PER_ELEMENT;

    if (!buffer.arrayBuffer) {
        console.warn(`Buffer at index ${bufferIndex} has undefined arrayBuffer`);
        return null;
    }

    if (byteOffset + byteLength > buffer.arrayBuffer.byteLength) {
        console.warn(
            `Attempting to read beyond buffer length. ByteOffset: ${byteOffset}, ByteLength: ${byteLength}, Buffer length: ${buffer.arrayBuffer.byteLength}`
        );
        return null;
    }

    return new arrayConstructor(buffer.arrayBuffer, byteOffset, accessor.count);
}

export function setupLoaders() {
    registerLoaders([GLTFLoader, ImageLoader]);
}

// Helper function to get pixel data from a glTF image
async function getPixelDataFromGltfImage(
    gltfImage: {
        image?: ImageBitmap;
        uri?: string;
    },
    basePath: string
): Promise<{ data: Float32Array; width: number; height: number }> {
    let imageBitmap: ImageBitmap;
    if (gltfImage.image) {
        imageBitmap = gltfImage.image;
    } else if (gltfImage.uri) {
        if (basePath.length === 0) {
            basePath = "./";
        } else if (basePath[basePath.length - 1] !== "/") {
            basePath = basePath.slice(0, basePath.lastIndexOf("/") + 1);
        }
        const resolvedUri = `${basePath}${gltfImage.uri}`;
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.src = resolvedUri;
        await img.decode();
        imageBitmap = await createImageBitmap(img);
    } else {
        throw new Error("No image data available");
    }
    const canvas = document.createElement("canvas");
    canvas.width = imageBitmap.width;
    canvas.height = imageBitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
        throw new Error("Failed to get canvas context for image");
    }
    ctx.drawImage(imageBitmap, 0, 0);
    const imageData = ctx.getImageData(0, 0, imageBitmap.width, imageBitmap.height);
    const data = imageData.data;
    const pixelCount = imageBitmap.width * imageBitmap.height;
    const floatData = new Float32Array(pixelCount * 4);
    for (let i = 0; i < pixelCount; i++) {
        floatData[i * 4 + 0] = data[i * 4 + 0] / 255.0;
        floatData[i * 4 + 1] = data[i * 4 + 1] / 255.0;
        floatData[i * 4 + 2] = data[i * 4 + 2] / 255.0;
        floatData[i * 4 + 3] = data[i * 4 + 3] / 255.0;
    }
    return { data: floatData, width: imageBitmap.width, height: imageBitmap.height };
}

export class Scene {
    enableBVH: boolean = true;

    vertexDataArray: VertexData[] = [];
    triangleDataArray: TriangleData[] = [];
    geomDataArray: GeomData[] = [];
    bvhNodesArray: BVHNodeData[] = [];
    textureDataArrays: Float32Array[] = [];
    textureDescriptorArray: TextureDescriptor[] = [];
    materialDataArray: MaterialData[] = [];
    currentTextureOffset: number = 0;

    totalVertexCount: number = 0;
    totalTriangleCount: number = 0;

    vertexBuffer: GPUBuffer | null = null;
    geomBuffer: GPUBuffer | null = null;
    triangleBuffer: GPUBuffer | null = null;
    bvhBuffer: GPUBuffer | null = null;
    materialBuffer: GPUBuffer | null = null;
    textureBuffer: GPUBuffer | null = null;
    textureDescriptorBuffer: GPUBuffer | null = null;
    dummyBuffer: GPUBuffer;

    geometryBindGroupLayout: GPUBindGroupLayout | null = null;
    geometryBindGroup: GPUBindGroup | null = null;
    textureBindGroupLayout: GPUBindGroupLayout | null = null;
    textureBindGroup: GPUBindGroup | null = null;

    constructor() {
        this.dummyBuffer = device.createBuffer({
            label: "dummy buffer",
            size: 64,
            usage: GPUBufferUsage.STORAGE,
            mappedAtCreation: true,
        });
        new Uint8Array(this.dummyBuffer.getMappedRange()).fill(0);
        this.dummyBuffer.unmap();
    }

    async loadGltf(
        filePath: string,
        scale: Vec3 = vec3.create(1, 1, 1),
        translation: Vec3 = vec3.create(0, 0, 0),
        rotation: Vec3 = vec3.create(0, 0, 0)
    ) {
        const gltfWithBuffers = (await load(filePath, [GLTFLoader], {
            gltf: {
                loadBuffers: true,
                loadImages: true,
                decompressMeshes: true,
            },
        })) as GLTFWithBuffers;

        const gltf = gltfWithBuffers.json;

        const materials = gltf.materials || [];
        const textures = gltf.textures || [];
        const images = gltf.images || [];
        const meshes = gltf.meshes || [];
        const nodes = gltf.nodes || [];
        const scenes = gltf.scenes || [];
        const existingTextureCount = this.textureDescriptorArray.length;
        const existingMaterialCount = this.materialDataArray.length;

        // Load textures into buffers
        for (const gltfTexture of textures) {
            const sourceIndex = gltfTexture.source;
            const gltfImage = images[sourceIndex ?? 0];

            const { data: floatData, width, height } = await getPixelDataFromGltfImage(gltfImage, filePath);
            this.textureDataArrays.push(floatData);

            const samplerIndex = gltfTexture.sampler;
            let wrapS = 0x2901; // Default to REPEAT
            let wrapT = 0x2901; // Default to REPEAT
            let minFilter = 0x2601; // Default to LINEAR
            let magFilter = 0x2601; // Default to LINEAR

            if (samplerIndex !== undefined && gltf.samplers) {
                const sampler = gltf.samplers[samplerIndex];
                wrapS = sampler.wrapS ?? wrapS;
                wrapT = sampler.wrapT ?? wrapT;
                minFilter = sampler.minFilter ?? minFilter;
                magFilter = sampler.magFilter ?? magFilter;
            }

            const textureDescriptor: TextureDescriptor = {
                width: width,
                height: height,
                offset: this.currentTextureOffset,
                wrapS: mapWrapMode(wrapS),
                wrapT: mapWrapMode(wrapT),
                minFilter: mapFilterMode(minFilter),
                magFilter: mapFilterMode(magFilter),
            };
            this.textureDescriptorArray.push(textureDescriptor);

            this.currentTextureOffset += width * height;
        }

        // Extract material data
        this.materialDataArray.push(
            ...materials.map((material) => {
                const pbr = material.pbrMetallicRoughness ?? {};
                const baseColorTextureIndex = pbr.baseColorTexture?.index ?? -1;
                const emissiveFactor = material.emissiveFactor ?? [0, 0, 0];
                const emissiveTextureIndex = material.emissiveTexture?.index ?? -1;
                const normalTextureIndex = material.normalTexture?.index ?? -1;

                let matType = 1; // Default to Lambertian
                if (emissiveFactor.some((v) => v !== 0) || emissiveTextureIndex !== -1) {
                    matType = 0; // Emissive
                } else if (pbr.metallicFactor === 1.0) {
                    matType = 2; // Metal
                }

                const adjustedBaseColorTextureIndex =
                    baseColorTextureIndex >= 0 ? baseColorTextureIndex + existingTextureCount : -1;
                const adjustedEmissiveTextureIndex =
                    emissiveTextureIndex >= 0 ? emissiveTextureIndex + existingTextureCount : -1;
                const adjustedNormalTextureIndex =
                    normalTextureIndex >= 0 ? normalTextureIndex + existingTextureCount : -1;

                return {
                    baseColorFactor: pbr.baseColorFactor || [1, 1, 1, 1],
                    baseColorTextureIndex: adjustedBaseColorTextureIndex,
                    metallicFactor: pbr.metallicFactor ?? 1.0,
                    roughnessFactor: pbr.roughnessFactor ?? 1.0,
                    emissiveFactor,
                    emissiveTextureIndex: adjustedEmissiveTextureIndex,
                    normalTextureIndex: adjustedNormalTextureIndex,
                    matType,
                };
            })
        );

        const nodeTransforms: Mat4[] = [];
        for (let i = 0; i < nodes.length; i++) {
            const gltfNode = nodes[i];
            let nodeTransform = mat4.identity();

            if (gltfNode.matrix) {
                nodeTransform = new Float32Array(gltfNode.matrix);
            } else {
                if (gltfNode.translation) {
                    nodeTransform = mat4.mul(nodeTransform, mat4.translation(gltfNode.translation));
                }
                if (gltfNode.rotation) {
                    nodeTransform = mat4.mul(nodeTransform, mat4.fromQuat(gltfNode.rotation));
                }
                if (gltfNode.scale) {
                    nodeTransform = mat4.mul(nodeTransform, mat4.scaling(gltfNode.scale));
                }
            }

            nodeTransforms[i] = nodeTransform;
        }

        const worldTransforms: Mat4[] = [];
        const computeWorldTransform = (nodeIndex: number, parentTransform: Mat4) => {
            const localTransform = nodeTransforms[nodeIndex];
            const worldTransform = mat4.mul(parentTransform, localTransform);
            worldTransforms[nodeIndex] = worldTransform;

            const gltfNode = nodes[nodeIndex];
            for (const childIndex of gltfNode.children ?? []) {
                computeWorldTransform(childIndex, worldTransform);
            }
        };

        const scaleMat = mat4.scaling(scale);
        const translateMat = mat4.translation(translation);
        const rotateX = mat4.rotationX(rotation[0]);
        const rotateY = mat4.rotationY(rotation[1]);
        const rotateZ = mat4.rotationZ(rotation[2]);
        const rotateMat = mat4.mul(rotateZ, mat4.mul(rotateY, rotateX));
        const rootTransform = mat4.mul(translateMat, mat4.mul(rotateMat, scaleMat));

        for (const scene of scenes) {
            for (const nodeIndex of scene.nodes ?? []) {
                computeWorldTransform(nodeIndex, rootTransform);
            }
        }

        for (let nodeIdx = 0; nodeIdx < nodes.length; nodeIdx++) {
            const gltfNode = nodes[nodeIdx];
            if (gltfNode.mesh !== undefined) {
                const mesh = meshes[gltfNode.mesh];
                const worldTransform = worldTransforms[nodeIdx];
                const inverseTransform = mat4.inverse(worldTransform);
                const invTranspose = mat4.transpose(inverseTransform);

                const meshTriangleStartIdx = this.totalTriangleCount;
                let meshVertexCount = 0;
                let meshTriangleCount = 0;

                for (const primitive of mesh.primitives) {
                    if (primitive.indices === undefined) {
                        console.warn("Primitive has no indices.");
                        continue;
                    }
                    const indices = getIndexArray(gltfWithBuffers, primitive.indices);
                    const positions = getFloatArray(gltfWithBuffers, primitive.attributes.POSITION);
                    const normals = getFloatArray(gltfWithBuffers, primitive.attributes.NORMAL);
                    let uvs = getFloatArray(gltfWithBuffers, primitive.attributes.TEXCOORD_0);
                    const materialIndex = primitive.material !== undefined ? primitive.material : -1;

                    if (!positions || !normals || !indices) {
                        console.warn("Failed to load mesh data.");
                        continue;
                    }

                    if (!uvs) {
                        uvs = new Float32Array((positions.length / 3) * 2);
                    }

                    const localVertexCount = positions.length / 3;
                    const vertexOffset = this.vertexDataArray.length;
                    for (let i = 0; i < localVertexCount; i++) {
                        const position = vec3.create(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
                        const transformedPosition = vec3.transformMat4(position, worldTransform);

                        const normal = vec3.create(normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]);
                        const transformedNormal = vec3.transformMat4Upper3x3(normal, invTranspose);

                        const uv = vec2.create(uvs[i * 2], uvs[i * 2 + 1]);
                        this.vertexDataArray.push({ position: transformedPosition, normal: transformedNormal, uv });
                    }

                    for (let i = 0; i < indices.length; i++) {
                        indices[i] += vertexOffset;
                    }

                    const primitiveTriangleCount = indices.length / 3;
                    for (let i = 0; i < primitiveTriangleCount; i++) {
                        const idx = i * 3;
                        this.triangleDataArray.push({
                            v0: indices[idx + 0],
                            v1: indices[idx + 1],
                            v2: indices[idx + 2],
                            materialId: 1                        
                        });
                    }

                    meshVertexCount += localVertexCount;
                    meshTriangleCount += primitiveTriangleCount;
                }

                const geomData: GeomData = {
                    transform: worldTransform,
                    inverseTransform: inverseTransform,
                    invTranspose: invTranspose,
                    geomType: 2,
                    materialId: -1,
                    triangleCount: meshTriangleCount,
                    triangleStartIdx: meshTriangleStartIdx,
                    bvhRootNodeIdx: -1,
                    objectId: 99,
                };

                // Build BVH for this mesh (if disabled, still do box around all triangles)
                geomData.bvhRootNodeIdx = this.buildBVHNode(
                    geomData.triangleStartIdx,
                    geomData.triangleStartIdx + geomData.triangleCount,
                    this.enableBVH
                );

                this.geomDataArray.push(geomData);
                this.totalVertexCount += meshVertexCount;
                this.totalTriangleCount += meshTriangleCount;
            }
        }
    }

    private buildBVHNode(start: number, end: number, recurse: boolean = true): number {
        const node: BVHNodeData = {
            boundsMin: vec3.create(Infinity, Infinity, Infinity),
            boundsMax: vec3.create(-Infinity, -Infinity, -Infinity),
            leftChild: -1,
            rightChild: -1,
            triangleStart: start,
            triangleCount: end - start,
        };

        for (let i = start; i < end; i++) {
            const tri = this.triangleDataArray[i];
            const v0 = this.vertexDataArray[tri.v0].position;
            const v1 = this.vertexDataArray[tri.v1].position;
            const v2 = this.vertexDataArray[tri.v2].position;

            for (let j = 0; j < 3; j++) {
                node.boundsMin[j] = Math.min(node.boundsMin[j], v0[j], v1[j], v2[j]);
                node.boundsMax[j] = Math.max(node.boundsMax[j], v0[j], v1[j], v2[j]);
            }
        }

        const maxTrianglesPerLeaf = 8;
        if (end - start <= maxTrianglesPerLeaf || !recurse) {
            node.leftChild = -1;
            node.rightChild = -1;
        } else {
            const extent = vec3.subtract(node.boundsMax, node.boundsMin);
            let axis = extent.indexOf(Math.max(...extent));

            const trianglesToSort = this.triangleDataArray.slice(start, end);
            trianglesToSort.sort((a, b) => {
                const v0a = this.vertexDataArray[a.v0].position;
                const v1a = this.vertexDataArray[a.v1].position;
                const v2a = this.vertexDataArray[a.v2].position;

                const v0b = this.vertexDataArray[b.v0].position;
                const v1b = this.vertexDataArray[b.v1].position;
                const v2b = this.vertexDataArray[b.v2].position;

                const aCenter = (v0a[axis] + v1a[axis] + v2a[axis]) / 3;
                const bCenter = (v0b[axis] + v1b[axis] + v2b[axis]) / 3;
                return aCenter - bCenter;
            });

            for (let i = start; i < end; i++) {
                this.triangleDataArray[i] = trianglesToSort[i - start];
            }

            const mid = Math.floor((start + end) / 2);
            node.leftChild = this.buildBVHNode(start, mid, recurse);
            node.rightChild = this.buildBVHNode(mid, end, recurse);
            node.triangleStart = -1;
            node.triangleCount = 0;
        }

        this.bvhNodesArray.push(node);
        return this.bvhNodesArray.length - 1;
    }

    rebuildBVH() {
        this.bvhNodesArray = [];
        this.geomDataArray = this.geomDataArray.map((geomData) => {
            if (geomData.geomType === 2) {
                geomData.bvhRootNodeIdx = this.buildBVHNode(
                    geomData.triangleStartIdx,
                    geomData.triangleStartIdx + geomData.triangleCount,
                    this.enableBVH
                );
            }
            return geomData;
        });

        this.createGeometryBuffer();
        this.createTriangleBuffer();
        this.createBVHBuffer();
        this.createBindGroups();
    }

    setBVHEnabled(enabled: boolean) {
        if (enabled === this.enableBVH) {
            return;
        }
        this.enableBVH = enabled;

        this.rebuildBVH();
    }

    createVertexBuffer = () => {
        this.vertexBuffer = device.createBuffer({
            label: "vertices",
            size: this.vertexDataArray.length * 12 * 4,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });

        const vertexHostBuffer = new Float32Array(this.vertexBuffer.size / 4);
        let offset = 0;
        for (const vertex of this.vertexDataArray) {
            vertexHostBuffer.set(vertex.position, offset);
            offset += 4;
            vertexHostBuffer.set(vertex.normal, offset);
            offset += 4;
            vertexHostBuffer.set(vertex.uv, offset);
            offset += 4;
        }
        device.queue.writeBuffer(this.vertexBuffer, 0, vertexHostBuffer.buffer);
    };

    createTriangleBuffer = () => {
        this.triangleBuffer = device.createBuffer({
            label: "triangles",
            size: this.triangleDataArray.length * 4 * 4,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });

        const triangleHostBuffer = new ArrayBuffer(this.triangleBuffer.size);
        const triangleDataView = new DataView(triangleHostBuffer);
        let offset = 0;

        for (const tri of this.triangleDataArray) {
            triangleDataView.setUint32(offset, tri.v0, true);
            offset += 4;
            triangleDataView.setUint32(offset, tri.v1, true);
            offset += 4;
            triangleDataView.setUint32(offset, tri.v2, true);
            offset += 4;
            triangleDataView.setInt32(offset, tri.materialId, true);
            offset += 4;
        }
        device.queue.writeBuffer(this.triangleBuffer, 0, triangleHostBuffer);
    };

    createGeometryBuffer = () => {
        this.geomBuffer = device.createBuffer({
            label: "geoms",
            size: 16 + this.geomDataArray.length * (16 * 4 * 3 + 16 * 2),
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });

        const geomHostBuffer = new ArrayBuffer(this.geomBuffer.size);
        const geomDataView = new DataView(geomHostBuffer);
        let offset = 0;

        geomDataView.setUint32(offset, this.geomDataArray.length, true);
        offset += 16;

        for (const geomData of this.geomDataArray) {
            for (const mat of [geomData.transform, geomData.inverseTransform, geomData.invTranspose]) {
                for (let i = 0; i < 16; i++) {
                    geomDataView.setFloat32(offset, mat[i], true);
                    offset += 4;
                }
            }
            geomDataView.setUint32(offset, geomData.geomType, true);
            offset += 4;
            geomDataView.setInt32(offset, geomData.materialId, true);
            offset += 4;
            geomDataView.setUint32(offset, geomData.triangleCount, true);
            offset += 4;
            geomDataView.setInt32(offset, geomData.triangleStartIdx, true);
            offset += 4;
            geomDataView.setInt32(offset, geomData.bvhRootNodeIdx, true);
            offset += 4;
            geomDataView.setUint32(offset, geomData.objectId, true);
            offset += 12;
        }
        device.queue.writeBuffer(this.geomBuffer, 0, geomDataView);
    };

    createBVHBuffer = () => {
        this.bvhBuffer = device.createBuffer({
            label: "bvh",
            size: 16 + this.bvhNodesArray.length * (16 * 3),
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });

        const bvhNodesBuffer = new ArrayBuffer(this.bvhBuffer.size);
        const bvhDataView = new DataView(bvhNodesBuffer);
        let offset = 0;

        bvhDataView.setUint32(offset, this.bvhNodesArray.length, true);
        offset += 16;

        for (const node of this.bvhNodesArray) {
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
        device.queue.writeBuffer(this.bvhBuffer, 0, bvhNodesBuffer);
    };

    createMaterialBuffer = () => {
        this.materialBuffer = device.createBuffer({
            label: "materials",
            size: this.materialDataArray.length * 16 * 4,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });

        const materialHostBuffer = new ArrayBuffer(this.materialBuffer.size);
        const materialDataView = new DataView(materialHostBuffer);
        let offset = 0;

        for (const material of this.materialDataArray) {
            for (let i = 0; i < 4; i++) {
                materialDataView.setFloat32(offset, material.baseColorFactor[i], true);
                offset += 4;
            }
            for (let i = 0; i < 3; i++) {
                materialDataView.setFloat32(offset, material.emissiveFactor[i], true);
                offset += 4;
            }
            materialDataView.setFloat32(offset, material.metallicFactor, true);
            offset += 4;
            materialDataView.setFloat32(offset, material.roughnessFactor, true);
            offset += 4;
            materialDataView.setInt32(offset, material.baseColorTextureIndex, true);
            offset += 4;
            materialDataView.setInt32(offset, material.emissiveTextureIndex, true);
            offset += 4;
            materialDataView.setInt32(offset, material.normalTextureIndex, true);
            offset += 4;
            materialDataView.setInt32(offset, material.matType, true);
            offset += 16;
        }
        device.queue.writeBuffer(this.materialBuffer, 0, materialHostBuffer);
    };

    createTextureBuffer = () => {
        let totalTextureDataLength = 0;
        for (const floatData of this.textureDataArrays) {
            totalTextureDataLength += floatData.length;
        }
        this.textureBuffer = device.createBuffer({
            label: "texture data",
            size: totalTextureDataLength * 4,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });

        const textureHostBuffer = new Float32Array(this.textureBuffer.size / 4);
        let textureDataOffset = 0;
        for (const floatData of this.textureDataArrays) {
            textureHostBuffer.set(floatData, textureDataOffset);
            textureDataOffset += floatData.length;
        }
        device.queue.writeBuffer(this.textureBuffer, 0, textureHostBuffer.buffer);
    };

    createTextureDescriptorBuffer = () => {
        this.textureDescriptorBuffer = device.createBuffer({
            label: "texture descriptors",
            size: this.textureDescriptorArray.length * 7 * 4,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });

        const textureDescriptorHostBuffer = new Uint32Array(this.textureDescriptorBuffer.size / 4);
        for (let i = 0; i < this.textureDescriptorArray.length; i++) {
            const desc = this.textureDescriptorArray[i];
            const offset = i * 7;
            textureDescriptorHostBuffer[offset + 0] = desc.width;
            textureDescriptorHostBuffer[offset + 1] = desc.height;
            textureDescriptorHostBuffer[offset + 2] = desc.offset;
            textureDescriptorHostBuffer[offset + 3] = desc.wrapS;
            textureDescriptorHostBuffer[offset + 4] = desc.wrapT;
            textureDescriptorHostBuffer[offset + 5] = desc.minFilter;
            textureDescriptorHostBuffer[offset + 6] = desc.magFilter;
        }
        device.queue.writeBuffer(this.textureDescriptorBuffer, 0, textureDescriptorHostBuffer.buffer);
    };

    createBuffers = () => {
        this.createVertexBuffer();
        this.createTriangleBuffer();
        this.createGeometryBuffer();
        this.createBVHBuffer();
        this.createMaterialBuffer();
        this.createTextureBuffer();
        this.createTextureDescriptorBuffer();
    };

    createBindGroups = () => {
        this.geometryBindGroupLayout = device.createBindGroupLayout({
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
        this.textureBindGroupLayout = device.createBindGroupLayout({
            label: "texture bind group layout",
            entries: [
                // Material buffer
                {
                    binding: 0,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: "read-only-storage" },
                },
                // Texture Descriptors buffer
                {
                    binding: 1,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: "read-only-storage" },
                },
                // Texture Data buffer
                {
                    binding: 2,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: "read-only-storage" },
                },
            ],
        });

        const geometryBindGroupEntries: GPUBindGroupEntry[] = [
            {
                binding: 0,
                resource: {
                    buffer: this.vertexBuffer && this.vertexBuffer.size > 0 ? this.vertexBuffer : this.dummyBuffer,
                },
            },
            {
                binding: 1,
                resource: {
                    buffer:
                        this.triangleBuffer && this.triangleBuffer.size > 0 ? this.triangleBuffer : this.dummyBuffer,
                },
            },
            {
                binding: 2,
                resource: { buffer: this.geomBuffer && this.geomBuffer.size > 16 ? this.geomBuffer : this.dummyBuffer },
            },
            {
                binding: 3,
                resource: { buffer: this.bvhBuffer && this.bvhBuffer.size > 16 ? this.bvhBuffer : this.dummyBuffer },
            },
        ];
        const textureBindGroupEntries: GPUBindGroupEntry[] = [
            {
                binding: 0,
                resource: {
                    buffer:
                        this.materialBuffer && this.materialBuffer.size > 0 ? this.materialBuffer : this.dummyBuffer,
                },
            },
            {
                binding: 1,
                resource: {
                    buffer:
                        this.textureDescriptorBuffer && this.textureDescriptorBuffer.size > 0
                            ? this.textureDescriptorBuffer
                            : this.dummyBuffer,
                },
            },
            {
                binding: 2,
                resource: {
                    buffer: this.textureBuffer && this.textureBuffer.size > 0 ? this.textureBuffer : this.dummyBuffer,
                },
            },
        ];

        this.geometryBindGroup = device.createBindGroup({
            label: "geometry bind group",
            layout: this.geometryBindGroupLayout,
            entries: geometryBindGroupEntries,
        });
        this.textureBindGroup = device.createBindGroup({
            label: "texture bind group",
            layout: this.textureBindGroupLayout,
            entries: textureBindGroupEntries,
        });
    };

    setClothVertexDataFromBuffer = (buffer: Float32Array) => {
        const originalLength = this.vertexDataArray.length;
        const numElems = buffer.length / 12;
        for (let i = 0; i < numElems; i++) {
            this.vertexDataArray[originalLength - numElems + i] = {
                position: vec3.create(buffer[i * 12], buffer[i * 12 + 1], buffer[i * 12 + 2]),
                normal: vec3.create(buffer[i * 12 + 4], buffer[i * 12 + 5], buffer[i * 12 + 6]),
                uv: vec2.create(buffer[i * 8], buffer[i * 12 + 9]),
            };
        }
    };

    appendClothGeometry = (clothSim: ClothSimulator) => {
        const clothMesh = clothSim.clothMesh;
        const originalNumVertices = this.vertexDataArray.length;

        this.vertexDataArray.push(...clothMesh.positionsArray);

        const originalNumTriangles = this.triangleDataArray.length;
        const numMeshTriangles = clothMesh.indices.length / 3;
        for (let i = 0; i < numMeshTriangles; i++) {
            const v0 = clothMesh.indices[i * 3 + 0] + originalNumVertices;
            const v1 = clothMesh.indices[i * 3 + 1] + originalNumVertices;
            const v2 = clothMesh.indices[i * 3 + 2] + originalNumVertices;
            this.triangleDataArray.push({
                v0,
                v1,
                v2,
                materialId: 0,
            });
        }

        const identity = mat4.identity();
        const geomData: GeomData = {
            transform: identity,
            inverseTransform: identity,
            invTranspose: identity,
            geomType: 2,
            materialId: 0,
            triangleCount: numMeshTriangles,
            triangleStartIdx: originalNumTriangles,
            bvhRootNodeIdx: -1,
            objectId: 0,
        };

        geomData.bvhRootNodeIdx = this.buildBVHNode(
            geomData.triangleStartIdx,
            geomData.triangleStartIdx + geomData.triangleCount,
            this.enableBVH
        );

        this.geomDataArray.push(geomData);

        this.totalVertexCount = this.vertexDataArray.length;
        this.totalTriangleCount = this.triangleDataArray.length;
    };

    addCustomObjects = () => {
        const materialsLength = this.materialDataArray.length;
        const objectsLength = this.geomDataArray.length;

        // white lambertian
        this.materialDataArray.push({
            baseColorFactor: [0.98, 0.94, 0.9, 1],
            baseColorTextureIndex: -1,
            metallicFactor: 0,
            roughnessFactor: 0,
            emissiveFactor: [0, 0, 0],
            emissiveTextureIndex: -1,
            normalTextureIndex: -1,
            matType: 1,
        });

        // red lambertian
        this.materialDataArray.push({
            baseColorFactor: [1, 0, 0, 1],
            baseColorTextureIndex: -1,
            metallicFactor: 0,
            roughnessFactor: 0,
            emissiveFactor: [0, 0, 0],
            emissiveTextureIndex: -1,
            normalTextureIndex: -1,
            matType: 1,
        });

        // green lambertian
        this.materialDataArray.push({
            baseColorFactor: [0, 1, 0, 1],
            baseColorTextureIndex: -1,
            metallicFactor: 0,
            roughnessFactor: 0,
            emissiveFactor: [0, 0, 0],
            emissiveTextureIndex: -1,
            normalTextureIndex: -1,
            matType: 1,
        });

        // light source
        this.materialDataArray.push({
            baseColorFactor: [1, 1, 1, 1],
            baseColorTextureIndex: -1,
            metallicFactor: 0,
            roughnessFactor: 0,
            emissiveFactor: [1, 1, 1],
            emissiveTextureIndex: -1,
            normalTextureIndex: -1,
            matType: 0,
        });

        // hero model lambertian
        this.materialDataArray.push({
            baseColorFactor: [1, 1, 0, 1],
            baseColorTextureIndex: -1,
            metallicFactor: 0,
            roughnessFactor: 0,
            emissiveFactor: [0, 0, 0],
            emissiveTextureIndex: -1,
            normalTextureIndex: -1,
            matType: 1,
        });

        // perfect mirror
        this.materialDataArray.push({
            baseColorFactor: [1, 1, 1, 1],
            baseColorTextureIndex: -1,
            metallicFactor: 1,
            roughnessFactor: 0,
            emissiveFactor: [0, 0, 0],
            emissiveTextureIndex: -1,
            normalTextureIndex: -1,
            matType: 2,
        });

        // stylized mirror (greyscale hero model)
        this.materialDataArray.push({
            baseColorFactor: [1, 1, 1, 1],
            baseColorTextureIndex: -1,
            metallicFactor: 1,
            roughnessFactor: 0,
            emissiveFactor: [0, 0, 0],
            emissiveTextureIndex: -1,
            normalTextureIndex: -1,
            matType: 2,
        });

        // stylized mirror (greyscale whole scene)
        this.materialDataArray.push({
            baseColorFactor: [1, 1, 1, 1],
            baseColorTextureIndex: -1,
            metallicFactor: 1,
            roughnessFactor: 0,
            emissiveFactor: [0, 0, 0],
            emissiveTextureIndex: -1,
            normalTextureIndex: -1,
            matType: 2,
        });

        // A cube
        const identityMat4 = mat4.identity();
        // this.geomDataArray.push({
        //     transform: identityMat4,
        //     inverseTransform: identityMat4,
        //     invTranspose: identityMat4,
        //     geomType: 0,
        //     materialId: materialsLength + 4,
        //     triangleCount: 0,
        //     triangleStartIdx: -1,
        //     bvhRootNodeIdx: -1,
        //     objectId: objectsLength,
        // });

        // Floor
        let scaleMat4 = mat4.scaling([30, 0.05, 30]);
        let translateMat4 = mat4.translation([0, -6, 0]);
        let rotateMat4 = identityMat4;
        let transformMat4 = mat4.mul(mat4.mul(rotateMat4, translateMat4), scaleMat4);
        this.geomDataArray.push({
            transform: transformMat4,
            inverseTransform: mat4.inverse(transformMat4),
            invTranspose: mat4.transpose(mat4.inverse(transformMat4)),
            geomType: 0,
            materialId: materialsLength,
            triangleCount: 0,
            triangleStartIdx: -1,
            bvhRootNodeIdx: -1,
            objectId: objectsLength + 1,
        });

        // Top light
        scaleMat4 = mat4.scaling([30, 0.05, 30]);
        translateMat4 = mat4.translation([0, 10, 0]);
        rotateMat4 = identityMat4;
        transformMat4 = mat4.mul(mat4.mul(rotateMat4, translateMat4), scaleMat4);
        this.geomDataArray.push({
            transform: transformMat4,
            inverseTransform: mat4.inverse(transformMat4),
            invTranspose: mat4.transpose(mat4.inverse(transformMat4)),
            geomType: 0,
            materialId: materialsLength + 3,
            triangleCount: 0,
            triangleStartIdx: -1,
            bvhRootNodeIdx: -1,
            objectId: objectsLength + 2,
        });

        // Back Wall
        scaleMat4 = mat4.scaling([0.05, 20, 30]);
        translateMat4 = mat4.translation([15, 0, 0]);
        rotateMat4 = identityMat4;
        transformMat4 = mat4.mul(mat4.mul(rotateMat4, translateMat4), scaleMat4);
        this.geomDataArray.push({
            transform: transformMat4,
            inverseTransform: mat4.inverse(transformMat4),
            invTranspose: mat4.transpose(mat4.inverse(transformMat4)),
            geomType: 0,
            materialId: materialsLength,
            triangleCount: 0,
            triangleStartIdx: -1,
            bvhRootNodeIdx: -1,
            objectId: objectsLength + 3,
        });

        // Front Wall
        scaleMat4 = mat4.scaling([0.05, 20, 30]);
        translateMat4 = mat4.translation([-15, 0, 0]);
        rotateMat4 = identityMat4;
        transformMat4 = mat4.mul(mat4.mul(rotateMat4, translateMat4), scaleMat4);
        this.geomDataArray.push({
            transform: transformMat4,
            inverseTransform: mat4.inverse(transformMat4),
            invTranspose: mat4.transpose(mat4.inverse(transformMat4)),
            geomType: 0,
            materialId: materialsLength,
            triangleCount: 0,
            triangleStartIdx: -1,
            bvhRootNodeIdx: -1,
            objectId: objectsLength + 4,
        });

        // Left Wall
        scaleMat4 = mat4.scaling([30, 20, 0.05]);
        translateMat4 = mat4.translation([0, 0, 15]);
        rotateMat4 = identityMat4;
        transformMat4 = mat4.mul(mat4.mul(rotateMat4, translateMat4), scaleMat4);
        this.geomDataArray.push({
            transform: transformMat4,
            inverseTransform: mat4.inverse(transformMat4),
            invTranspose: mat4.transpose(mat4.inverse(transformMat4)),
            geomType: 0,
            materialId: materialsLength,
            triangleCount: 0,
            triangleStartIdx: -1,
            bvhRootNodeIdx: -1,
            objectId: objectsLength + 5,
        });

        // Right Wall
        scaleMat4 = mat4.scaling([30, 20, 0.05]);
        translateMat4 = mat4.translation([0, 0, -15]);
        rotateMat4 = identityMat4;
        transformMat4 = mat4.mul(mat4.mul(rotateMat4, translateMat4), scaleMat4);
        this.geomDataArray.push({
            transform: transformMat4,
            inverseTransform: mat4.inverse(transformMat4),
            invTranspose: mat4.transpose(mat4.inverse(transformMat4)),
            geomType: 0,
            materialId: materialsLength,
            triangleCount: 0,
            triangleStartIdx: -1,
            bvhRootNodeIdx: -1,
            objectId: objectsLength + 6,
        });

        const numMirrors = 6;
        for (let i = 0; i <= numMirrors; i++) {
            scaleMat4 = mat4.scaling([0.05, 10, 3]);
            const rotAngle = (i * Math.PI * 2) / 6 / numMirrors - Math.PI / 6;
            translateMat4 = mat4.translation(vec3.create(100, 0, -2 * Math.sin(rotAngle)));
            const rotAngle2 = (i * Math.PI * 2) / 2 / numMirrors - Math.PI / 2;
            rotateMat4 = mat4.rotationY(rotAngle2);
            transformMat4 = mat4.mul(mat4.mul(rotateMat4, scaleMat4), translateMat4);
            this.geomDataArray.push({
                transform: transformMat4,
                inverseTransform: mat4.inverse(transformMat4),
                invTranspose: mat4.transpose(mat4.inverse(transformMat4)),
                geomType: 0,
                materialId: materialsLength + 5,
                triangleCount: 0,
                triangleStartIdx: -1,
                bvhRootNodeIdx: -1,
                objectId: -1 - i,
            });
        }
    };
}
