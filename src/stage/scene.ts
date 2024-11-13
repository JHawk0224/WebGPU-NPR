/*
Note that this glTF loader assumes a lot of things are always defined (textures, samplers, vertex/index info, etc.),
so you may run into issues loading files outside of the Sponza scene.

In particular, it is known to not work if there is a mesh with no material.
*/

import { registerLoaders, load } from "@loaders.gl/core";
import { GLTFLoader, GLTFWithBuffers, GLTFMesh, GLTFMeshPrimitive, GLTFMaterial, GLTFSampler } from "@loaders.gl/gltf";
import { ImageLoader } from "@loaders.gl/images";
import { vec3, Vec3, Mat4, mat4 } from "wgpu-matrix";
import { device, materialBindGroupLayout, modelBindGroupLayout } from "../renderer";

const enableBVH = true;

export interface GeomData {
    transform: Mat4;
    inverseTransform: Mat4;
    invTranspose: Mat4;
    geomType: number;
    materialId: number;
    triangleCount: number;
    triangleStartIdx: number;
    bvhRootNodeIdx: number;
}

export interface TriangleData {
    v0: Vec3;
    v1: Vec3;
    v2: Vec3;
    materialId: number;
}

export interface MaterialData {
    color: Vec3;
    matType: number;
    emittance: number;
    roughness: number;
}

export interface BVHNodeData {
    boundsMin: Vec3;
    boundsMax: Vec3;
    leftChild: number;
    rightChild: number;
    triangleStart: number;
    triangleCount: number;
}

export function setupLoaders() {
    registerLoaders([GLTFLoader, ImageLoader]);
}

function getFloatArray(gltfWithBuffers: GLTFWithBuffers, attribute: number): Float32Array | null {
    const gltf = gltfWithBuffers.json;

    const accessor = gltf.accessors?.[attribute];
    if (!accessor) {
        console.warn(`Accessor at index ${attribute} is undefined`);
        return null;
    }

    const bufferViewIndex = accessor.bufferView;
    if (bufferViewIndex === undefined) {
        console.warn(`Accessor at index ${attribute} has undefined bufferView`);
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
    const byteOffset = accessorByteOffset + bufferViewByteOffset + buffer.byteOffset;
    const byteLength = bufferView.byteLength ?? 0;
    if (byteLength === 0) {
        console.warn(`BufferView at index ${bufferViewIndex} has zero byteLength`);
        return null;
    }

    return new Float32Array(buffer.arrayBuffer, byteOffset, accessor.count * 3);
}

class Texture {
    image: GPUTexture;
    sampler: GPUSampler;

    constructor(image: GPUTexture, sampler: GPUSampler) {
        this.image = image;
        this.sampler = sampler;
    }
}

export class Material {
    private static nextId = 0;
    readonly id: number;

    materialBindGroup: GPUBindGroup;

    color: Vec3;
    matType: number;
    emittance: number;
    roughness: number;

    constructor(gltfMaterial: GLTFMaterial, textures: Texture[]) {
        this.id = Material.nextId++;

        const pbr = gltfMaterial.pbrMetallicRoughness ?? {};
        const baseColorTextureInfo = pbr.baseColorTexture;
        const baseColorFactor = pbr.baseColorFactor ?? [1.0, 1.0, 1.0, 1.0];

        let texture: GPUTexture;
        let sampler: GPUSampler;

        if (baseColorTextureInfo?.index !== undefined) {
            const textureIndex = baseColorTextureInfo.index;
            const diffuseTexture = textures[textureIndex];
            if (diffuseTexture) {
                texture = diffuseTexture.image;
                sampler = diffuseTexture.sampler;
            } else {
                console.warn(`Texture not found at index ${textureIndex}. Using default texture.`);
                ({ texture, sampler } = this.createDefaultTextureAndSampler(baseColorFactor));
            }
        } else {
            ({ texture, sampler } = this.createDefaultTextureAndSampler(baseColorFactor));
        }

        this.materialBindGroup = device.createBindGroup({
            label: "material bind group",
            layout: materialBindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource: texture.createView(),
                },
                {
                    binding: 1,
                    resource: sampler,
                },
            ],
        });

        this.color = vec3.fromValues(...baseColorFactor.slice(0, 3));
        this.matType = 0;
        this.emittance = 0.0;
        this.roughness = pbr.roughnessFactor ?? 1.0;
    }

    private createDefaultTextureAndSampler(baseColorFactor: number[]): {
        texture: GPUTexture;
        sampler: GPUSampler;
    } {
        const texture = device.createTexture({
            size: [1, 1],
            format: "rgba8unorm",
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
        });

        const colorData = new Uint8Array(baseColorFactor.map((c) => Math.round(c * 255)));
        device.queue.writeTexture({ texture }, colorData, { bytesPerRow: 4 }, { width: 1, height: 1 });

        const sampler = device.createSampler();

        return { texture, sampler };
    }
}

export class Primitive {
    vertexBuffer: GPUBuffer;
    indexBuffer: GPUBuffer;
    numIndices = -1;

    material: Material;

    vertsArray: Float32Array;
    indicesArray: Uint32Array;

    constructor(gltfPrim: GLTFMeshPrimitive, gltfWithBuffers: GLTFWithBuffers, material: Material) {
        this.material = material;

        const gltf = gltfWithBuffers.json;

        const indicesAccessorIndex = gltfPrim.indices;
        if (indicesAccessorIndex === undefined) {
            throw new Error("Indices accessor index is undefined in primitive.");
        }

        const indicesAccessor = gltf.accessors?.[indicesAccessorIndex];
        if (!indicesAccessor) {
            throw new Error(`Indices accessor not found at index ${indicesAccessorIndex}.`);
        }

        const indicesBufferViewIndex = indicesAccessor.bufferView;
        if (indicesBufferViewIndex === undefined) {
            throw new Error(`Indices accessor bufferView is undefined at index ${indicesAccessorIndex}.`);
        }

        const indicesBufferView = gltf.bufferViews?.[indicesBufferViewIndex];
        if (!indicesBufferView) {
            throw new Error(`Indices bufferView not found at index ${indicesBufferViewIndex}.`);
        }

        const indicesBufferIndex = indicesBufferView.buffer;
        const indicesBuffer = gltfWithBuffers.buffers[indicesBufferIndex];
        if (!indicesBuffer) {
            throw new Error(`Indices buffer not found at index ${indicesBufferIndex}.`);
        }

        const indicesByteOffset =
            (indicesAccessor.byteOffset ?? 0) + (indicesBufferView.byteOffset ?? 0) + indicesBuffer.byteOffset;

        const indicesCount = indicesAccessor.count;
        const indicesComponentType = indicesAccessor.componentType;

        let indicesArray: Uint32Array;
        switch (indicesComponentType) {
            case 0x1403: // UNSIGNED_SHORT
                indicesArray = Uint32Array.from(
                    new Uint16Array(indicesBuffer.arrayBuffer, indicesByteOffset, indicesCount)
                );
                break;
            case 0x1405: // UNSIGNED_INT
                indicesArray = new Uint32Array(indicesBuffer.arrayBuffer, indicesByteOffset, indicesCount);
                break;
            default:
                throw new Error(`Unsupported indices component type: 0x${indicesComponentType.toString(16)}`);
        }

        const positionsArray = getFloatArray(gltfWithBuffers, gltfPrim.attributes.POSITION);
        if (!positionsArray) {
            throw new Error("Positions array is undefined in primitive.");
        }

        const normalsArray =
            gltfPrim.attributes.NORMAL !== undefined
                ? getFloatArray(gltfWithBuffers, gltfPrim.attributes.NORMAL)
                : new Float32Array(positionsArray.length);
        if (!normalsArray) {
            throw new Error("Normals array is undefined in primitive.");
        }

        const uvsArray =
            gltfPrim.attributes.TEXCOORD_0 !== undefined
                ? getFloatArray(gltfWithBuffers, gltfPrim.attributes.TEXCOORD_0)
                : new Float32Array((positionsArray.length / 3) * 2);
        if (!uvsArray) {
            throw new Error("UVs array is undefined in primitive.");
        }

        const numFloatsPerVert = 8;
        const numVerts = positionsArray.length / 3;
        const vertsArray = new Float32Array(numVerts * numFloatsPerVert);

        for (let vertIdx = 0; vertIdx < numVerts; ++vertIdx) {
            const vertStartIdx = vertIdx * numFloatsPerVert;
            vertsArray[vertStartIdx] = positionsArray[vertIdx * 3];
            vertsArray[vertStartIdx + 1] = positionsArray[vertIdx * 3 + 1];
            vertsArray[vertStartIdx + 2] = positionsArray[vertIdx * 3 + 2];
            vertsArray[vertStartIdx + 3] = normalsArray[vertIdx * 3] || 0;
            vertsArray[vertStartIdx + 4] = normalsArray[vertIdx * 3 + 1] || 0;
            vertsArray[vertStartIdx + 5] = normalsArray[vertIdx * 3 + 2] || 0;
            vertsArray[vertStartIdx + 6] = uvsArray[vertIdx * 2] || 0;
            vertsArray[vertStartIdx + 7] = uvsArray[vertIdx * 2 + 1] || 0;
        }

        this.indexBuffer = device.createBuffer({
            label: "index buffer",
            size: indicesArray.byteLength,
            usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
        });
        device.queue.writeBuffer(this.indexBuffer, 0, indicesArray);

        this.vertexBuffer = device.createBuffer({
            label: "vertex buffer",
            size: vertsArray.byteLength,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });
        device.queue.writeBuffer(this.vertexBuffer, 0, vertsArray);

        this.numIndices = indicesArray.length;
        this.vertsArray = vertsArray;
        this.indicesArray = indicesArray;
    }
}

export class Mesh {
    primitives: Primitive[] = [];

    constructor(gltfMesh: GLTFMesh, gltfWithBuffers: GLTFWithBuffers, sceneMaterials: Material[]) {
        gltfMesh.primitives.forEach((gltfPrim: GLTFMeshPrimitive) => {
            const materialIndex = gltfPrim.material;
            const material = materialIndex !== undefined ? sceneMaterials[materialIndex] : new Material({}, []);
            this.primitives.push(new Primitive(gltfPrim, gltfWithBuffers, material));
        });

        this.primitives.sort((primA: Primitive, primB: Primitive) => {
            return primA.material.id - primB.material.id;
        });
    }
}

export class Node {
    name: String = "node";

    parent: Node | undefined;
    children: Set<Node> = new Set<Node>();

    transform: Mat4 = mat4.identity();
    worldTransform: Mat4 = mat4.identity();
    modelMatUniformBuffer!: GPUBuffer;
    modelBindGroup!: GPUBindGroup;
    mesh: Mesh | undefined;

    setName(newName: string) {
        this.name = newName;
    }

    setParent(newParent: Node) {
        if (this.parent != undefined) {
            this.parent.children.delete(this);
        }

        this.parent = newParent;
        newParent.children.add(this);
    }

    propagateTransformations(parentTransform: Mat4 = mat4.identity()) {
        this.worldTransform = mat4.mul(parentTransform, this.transform);

        if (this.mesh != undefined) {
            this.modelMatUniformBuffer = device.createBuffer({
                label: "model mat uniform",
                size: 16 * 4 + 8,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            });

            device.queue.writeBuffer(this.modelMatUniformBuffer, 0, this.worldTransform);

            this.modelBindGroup = device.createBindGroup({
                label: "model bind group",
                layout: modelBindGroupLayout,
                entries: [
                    {
                        binding: 0,
                        resource: { buffer: this.modelMatUniformBuffer },
                    },
                ],
            });
        }

        for (let child of this.children) {
            child.propagateTransformations(this.worldTransform);
        }
    }
}

function createTexture(imageBitmap: ImageBitmap): GPUTexture {
    let texture = device.createTexture({
        size: [imageBitmap.width, imageBitmap.height],
        format: "rgba8unorm",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });

    device.queue.copyExternalImageToTexture(
        { source: imageBitmap },
        { texture: texture },
        { width: imageBitmap.width, height: imageBitmap.height }
    );

    return texture;
}

function convertWrapModeEnum(wrapMode: number): GPUAddressMode {
    switch (wrapMode) {
        case 0x2901: // REPEAT
            return "repeat";
        case 0x812f: // CLAMP_TO_EDGE
            return "clamp-to-edge";
        case 0x8370: // MIRRORED_REPEAT
            return "mirror-repeat";
        default:
            throw new Error(`unsupported wrap mode: 0x${wrapMode.toString(16)}`);
    }
}

function createSampler(gltfSampler: GLTFSampler): GPUSampler {
    let samplerDescriptor: GPUSamplerDescriptor = {};

    switch (gltfSampler.magFilter) {
        case 0x2600: // NEAREST
            samplerDescriptor.magFilter = "nearest";
            break;
        case 0x2601: // LINEAR
            samplerDescriptor.magFilter = "linear";
            break;
        default:
            throw new Error(`unsupported magFilter: 0x${gltfSampler.magFilter!.toString(16)}`);
    }

    switch (gltfSampler.minFilter) {
        case 0x2600: // NEAREST
            samplerDescriptor.minFilter = "nearest";
            break;
        case 0x2601: // LINEAR
            samplerDescriptor.minFilter = "linear";
            break;
        case 0x2700: // NEAREST_MIPMAP_NEAREST
            samplerDescriptor.minFilter = "nearest";
            samplerDescriptor.mipmapFilter = "nearest";
            break;
        case 0x2701: // LINEAR_MIPMAP_NEAREST
            samplerDescriptor.minFilter = "linear";
            samplerDescriptor.mipmapFilter = "nearest";
            break;
        case 0x2702: // NEAREST_MIPMAP_LINEAR
            samplerDescriptor.minFilter = "nearest";
            samplerDescriptor.mipmapFilter = "linear";
            break;
        case 0x2703: // LINEAR_MIPMAP_LINEAR
            samplerDescriptor.minFilter = "linear";
            samplerDescriptor.mipmapFilter = "linear";
            break;
        default:
            throw new Error(`unsupported minFilter: 0x${gltfSampler.minFilter!.toString(16)}`);
    }

    samplerDescriptor.addressModeU = convertWrapModeEnum(gltfSampler.wrapS!);
    samplerDescriptor.addressModeV = convertWrapModeEnum(gltfSampler.wrapT!);

    return device.createSampler(samplerDescriptor);
}

export class Scene {
    private root: Node = new Node();

    constructor() {
        this.root.setName("root");
    }

    async loadGltf(filePath: string) {
        const gltfWithBuffers = (await load(filePath)) as GLTFWithBuffers;
        const gltf = gltfWithBuffers.json;

        const sceneTextures: Texture[] = [];
        {
            const sceneImages: GPUTexture[] = [];
            for (const gltfImage of gltfWithBuffers.images ?? []) {
                const imageBitmap = gltfImage as ImageBitmap;
                sceneImages.push(createTexture(imageBitmap));
            }

            const sceneSamplers: GPUSampler[] = [];
            for (const gltfSampler of gltf.samplers ?? []) {
                sceneSamplers.push(createSampler(gltfSampler));
            }

            for (const gltfTexture of gltf.textures ?? []) {
                const sourceIndex = gltfTexture.source;
                const samplerIndex = gltfTexture.sampler;

                const image = sceneImages[sourceIndex ?? 0];
                const sampler = sceneSamplers[samplerIndex ?? 0] || device.createSampler();

                sceneTextures.push(new Texture(image, sampler));
            }
        }

        const sceneMaterials: Material[] = [];
        for (const gltfMaterial of gltf.materials ?? []) {
            sceneMaterials.push(new Material(gltfMaterial, sceneTextures));
        }

        const sceneMeshes: Mesh[] = [];
        for (const gltfMesh of gltf.meshes ?? []) {
            sceneMeshes.push(new Mesh(gltfMesh, gltfWithBuffers, sceneMaterials));
        }

        let sceneRoot: Node = new Node();
        sceneRoot.setName("scene root");
        sceneRoot.setParent(this.root);

        let sceneNodes: Node[] = [];
        for (let gltfNode of gltf.nodes!) {
            let newNode = new Node();
            newNode.setName(gltfNode.name);
            newNode.setParent(sceneRoot);

            if (gltfNode.mesh != undefined) {
                newNode.mesh = sceneMeshes[gltfNode.mesh];
            }

            newNode.transform = mat4.identity();
            if (gltfNode.matrix) {
                newNode.transform = new Float32Array(gltfNode.matrix);
            } else {
                if (gltfNode.translation) {
                    newNode.transform = mat4.mul(newNode.transform, mat4.translation(gltfNode.translation));
                }

                if (gltfNode.rotation) {
                    newNode.transform = mat4.mul(newNode.transform, mat4.fromQuat(gltfNode.rotation));
                }

                if (gltfNode.scale) {
                    newNode.transform = mat4.mul(newNode.transform, mat4.scaling(gltfNode.scale));
                }
            }

            sceneNodes.push(newNode);
        }

        for (let nodeIdx = 0; nodeIdx < (gltf.nodes ?? []).length; nodeIdx++) {
            const gltfNode = gltf.nodes![nodeIdx];

            for (const childNodeIdx of gltfNode.children ?? []) {
                sceneNodes[childNodeIdx].setParent(sceneNodes[nodeIdx]);
            }
        }

        sceneRoot.propagateTransformations();
    }

    iterate(
        nodeFunction: (node: Node) => void,
        materialFunction: (material: Material) => void,
        primFunction: (primitive: Primitive) => void
    ) {
        let nodes = [this.root];

        let lastMaterialId: number | undefined;

        while (nodes.length > 0) {
            const node = nodes.pop() as Node;
            if (node.mesh) {
                nodeFunction(node);

                for (const primitive of node.mesh.primitives) {
                    if (primitive.material && primitive.material.id !== lastMaterialId) {
                        materialFunction(primitive.material);
                        lastMaterialId = primitive.material.id;
                    }

                    primFunction(primitive);
                }
            }

            nodes.push(...node.children);
        }
    }

    constructGeometry() {
        const geomsArray: GeomData[] = [];
        const trianglesArray: TriangleData[] = [];
        const bvhNodesArray: BVHNodeData[] = [];
        let triangleStartIdx = 0;

        const traverse = (node: Node) => {
            if (node.mesh) {
                const geomData: GeomData = {
                    transform: node.worldTransform,
                    inverseTransform: mat4.inverse(node.worldTransform),
                    invTranspose: mat4.transpose(mat4.inverse(node.worldTransform)),
                    geomType: 2, // MESH
                    materialId: 0,
                    triangleCount: 0,
                    triangleStartIdx,
                    bvhRootNodeIdx: -1,
                };

                let triangleCount = 0;
                for (const primitive of node.mesh.primitives) {
                    const vertsArray = primitive.vertsArray;
                    const indicesArray = primitive.indicesArray;
                    const numVerts = vertsArray.length / 8; // 8 floats per vertex
                    const positions = [];

                    for (let i = 0; i < numVerts; i++) {
                        const x = vertsArray[i * 8];
                        const y = vertsArray[i * 8 + 1];
                        const z = vertsArray[i * 8 + 2];
                        const pos = vec3.create(x, y, z);
                        const transformedPos = vec3.transformMat4(pos, node.worldTransform);
                        positions.push(transformedPos);
                    }

                    for (let i = 0; i < indicesArray.length; i += 3) {
                        const idx0 = indicesArray[i];
                        const idx1 = indicesArray[i + 1];
                        const idx2 = indicesArray[i + 2];
                        const v0 = positions[idx0];
                        const v1 = positions[idx1];
                        const v2 = positions[idx2];
                        const triangle = {
                            v0,
                            v1,
                            v2,
                            materialId: primitive.material?.id ?? -1,
                        };
                        trianglesArray.push(triangle);
                        triangleCount += 1;
                    }
                }

                geomData.triangleCount = triangleCount;
                triangleStartIdx += triangleCount;

                if (enableBVH) {
                    // Build BVH for this mesh
                    const bvhNodeStartIdx = bvhNodesArray.length;
                    const bvhRootNodeIdx = this.buildBVH(
                        trianglesArray,
                        triangleStartIdx - triangleCount,
                        triangleStartIdx,
                        bvhNodesArray
                    );
                    geomData.bvhRootNodeIdx = bvhRootNodeIdx + bvhNodeStartIdx;
                } else {
                    bvhNodesArray.push({
                        boundsMin: vec3.create(0, 0, 0),
                        boundsMax: vec3.create(0, 0, 0),
                        leftChild: -1,
                        rightChild: -1,
                        triangleStart: -1,
                        triangleCount: 0,
                    });
                }

                geomsArray.push(geomData);
            }

            for (const child of node.children) {
                traverse(child);
            }
        };

        traverse(this.root);

        return { geomsArray, trianglesArray, bvhNodesArray };
    }

    buildBVH(trianglesArray: TriangleData[], start: number, end: number, bvhNodes: BVHNodeData[]): number {
        const nodeIndex = bvhNodes.length;
        const node: BVHNodeData = {
            boundsMin: vec3.create(Infinity, Infinity, Infinity),
            boundsMax: vec3.create(-Infinity, -Infinity, -Infinity),
            leftChild: -1,
            rightChild: -1,
            triangleStart: start,
            triangleCount: end - start,
        };

        for (let i = start; i < end; i++) {
            const tri = trianglesArray[i];
            for (let j = 0; j < 3; j++) {
                node.boundsMin[j] = Math.min(node.boundsMin[j], tri.v0[j]);
                node.boundsMin[j] = Math.min(node.boundsMin[j], tri.v1[j]);
                node.boundsMin[j] = Math.min(node.boundsMin[j], tri.v2[j]);

                node.boundsMax[j] = Math.max(node.boundsMax[j], tri.v0[j]);
                node.boundsMax[j] = Math.max(node.boundsMax[j], tri.v1[j]);
                node.boundsMax[j] = Math.max(node.boundsMax[j], tri.v2[j]);
            }
        }

        const maxTrianglesPerLeaf = 4;
        if (end - start <= maxTrianglesPerLeaf) {
            node.leftChild = -1;
            node.rightChild = -1;
        } else {
            const extent = vec3.subtract(vec3.create(), node.boundsMax, node.boundsMin);
            let axis = extent.indexOf(Math.max(...extent)); // TODO OPTIMIZE WHICH AXIS

            const trianglesToSort = trianglesArray.slice(start, end);
            trianglesToSort.sort((a, b) => {
                const aCenter = (a.v0[axis] + a.v1[axis] + a.v2[axis]) / 3;
                const bCenter = (b.v0[axis] + b.v1[axis] + b.v2[axis]) / 3;
                return aCenter - bCenter;
            });
            for (let i = start; i < end; i++) {
                trianglesArray[i] = trianglesToSort[i - start];
            }

            const mid = Math.floor((start + end) / 2); // TODO OPTIMIZE SPLITTING (PICK MEDIAN)
            node.leftChild = this.buildBVH(trianglesArray, start, mid, bvhNodes);
            node.rightChild = this.buildBVH(trianglesArray, mid, end, bvhNodes);
            node.triangleStart = -1;
            node.triangleCount = 0;
        }

        bvhNodes.push(node);
        return nodeIndex;
    }
}
