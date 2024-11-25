/*
Note that this glTF loader assumes a lot of things are always defined (textures, samplers, vertex/index info, etc.),
so you may run into issues loading files outside of the Sponza scene.

In particular, it is known to not work if there is a mesh with no material.
*/

import { registerLoaders, load } from "@loaders.gl/core";
import { GLTFLoader, GLTFWithBuffers } from "@loaders.gl/gltf";
import { ImageLoader } from "@loaders.gl/images";
import { vec2, Vec2, vec3, Vec3, Mat4, mat4 } from "wgpu-matrix";
import { device } from "../renderer";

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
}

export interface MaterialData {
    baseColorFactor: number[];
    baseColorTextureIndex: number;
    metallicFactor: number;
    roughnessFactor: number;
    emissiveFactor: number[];
    emissiveTextureIndex: number;
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
        if (basePath.length == 0) {
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
    vertexDataArray: VertexData[] = [];
    triangleDataArray: TriangleData[] = [];
    geomDataArray: GeomData[] = [];
    bvhNodesArray: BVHNodeData[] = [];
    textureDataArrays: Float32Array[] = [];
    textureDescriptors: TextureDescriptor[] = [];
    materialDataArray: MaterialData[] = [];
    currentTextureOffset: number = 0;

    totalVertexCount: number = 0;
    totalTriangleCount: number = 0;

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
        const existingTextureCount = this.textureDescriptors.length;

        // Load textures into buffers
        for (const gltfTexture of textures) {
            const sourceIndex = gltfTexture.source;
            const gltfImage = images[sourceIndex ?? 0];

            const { data: floatData, width, height } = await getPixelDataFromGltfImage(gltfImage, filePath);
            this.textureDataArrays.push(floatData);

            const descriptor: TextureDescriptor = {
                width: width,
                height: height,
                offset: this.currentTextureOffset,
            };
            this.textureDescriptors.push(descriptor);

            this.currentTextureOffset += width * height;
        }

        // Extract material data
        this.materialDataArray.push(
            ...materials.map((material) => {
                const pbr = material.pbrMetallicRoughness ?? {};
                const baseColorTextureIndex = pbr.baseColorTexture?.index ?? -1;
                const emissiveFactor = material.emissiveFactor ?? [0, 0, 0];
                const emissiveTextureIndex = material.emissiveTexture?.index ?? -1;

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

                return {
                    baseColorFactor: pbr.baseColorFactor || [1, 1, 1, 1],
                    baseColorTextureIndex: adjustedBaseColorTextureIndex,
                    metallicFactor: pbr.metallicFactor ?? 1.0,
                    roughnessFactor: pbr.roughnessFactor ?? 1.0,
                    emissiveFactor,
                    emissiveTextureIndex: adjustedEmissiveTextureIndex,
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
                            materialId: materialIndex,
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
                };

                // Build BVH for this mesh (if disabled, still do box around all triangles)
                geomData.bvhRootNodeIdx = this.buildBVH(
                    this.triangleDataArray,
                    meshTriangleStartIdx,
                    meshTriangleStartIdx + meshTriangleCount,
                    this.bvhNodesArray,
                    enableBVH
                );

                this.geomDataArray.push(geomData);
                this.totalVertexCount += meshVertexCount;
                this.totalTriangleCount += meshTriangleCount;
            }
        }
    }

    private buildBVH(
        trianglesArray: TriangleData[],
        start: number,
        end: number,
        bvhNodes: BVHNodeData[],
        recurse: Boolean = true
    ): number {
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
            const v0 = this.vertexDataArray[tri.v0].position;
            const v1 = this.vertexDataArray[tri.v1].position;
            const v2 = this.vertexDataArray[tri.v2].position;

            for (let j = 0; j < 3; j++) {
                node.boundsMin[j] = Math.min(node.boundsMin[j], v0[j], v1[j], v2[j]);
                node.boundsMax[j] = Math.max(node.boundsMax[j], v0[j], v1[j], v2[j]);
            }
        }

        const maxTrianglesPerLeaf = 4;
        if (end - start <= maxTrianglesPerLeaf || !recurse) {
            node.leftChild = -1;
            node.rightChild = -1;
        } else {
            const extent = vec3.subtract(node.boundsMax, node.boundsMin);
            let axis = extent.indexOf(Math.max(...extent));

            const trianglesToSort = trianglesArray.slice(start, end);
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
                trianglesArray[i] = trianglesToSort[i - start];
            }

            const mid = Math.floor((start + end) / 2);
            node.leftChild = this.buildBVH(trianglesArray, start, mid, bvhNodes, recurse);
            node.rightChild = this.buildBVH(trianglesArray, mid, end, bvhNodes, recurse);
            node.triangleStart = -1;
            node.triangleCount = 0;
        }

        bvhNodes.push(node);
        return bvhNodes.length - 1;
    }

    createBuffersAndBindGroup = () => {
        // For debugging BVH
        // for (const node of this.bvhNodesArray) {
        //     if (node.leftChild == -1 && node.rightChild == -1) {
        //         const diff = vec3.subtract(node.boundsMax, node.boundsMin);
        //         const scaleMat = mat4.scaling(diff);
        //         const center = vec3.add(node.boundsMin, vec3.mulScalar(diff, 0.5));
        //         const translationMat = mat4.translation(center);
        //         var transform = mat4.multiply(translationMat, scaleMat);
        //         this.geomDataArray.push({
        //             transform,
        //             inverseTransform: mat4.inverse(transform),
        //             invTranspose: mat4.transpose(mat4.inverse(transform)),
        //             geomType: 0,
        //             materialId: this.materialDataArray.length - 1,
        //             triangleCount: 0,
        //             triangleStartIdx: 0,
        //             bvhRootNodeIdx: -1,
        //         });
        //     }
        // }

        // Vertex Buffer
        const totalVertexData = new Float32Array(this.totalVertexCount * 12);
        let offset = 0;
        for (const vertex of this.vertexDataArray) {
            totalVertexData.set(vertex.position, offset);
            offset += 4;
            totalVertexData.set(vertex.normal, offset);
            offset += 4;
            totalVertexData.set(vertex.uv, offset);
            offset += 4;
        }

        const vertexBuffer = device.createBuffer({
            label: "vertices",
            size: totalVertexData.byteLength,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
            mappedAtCreation: true,
        });
        new Float32Array(vertexBuffer.getMappedRange()).set(totalVertexData);
        vertexBuffer.unmap();

        // Triangle Buffer
        const trianglesSize = this.triangleDataArray.length;
        const trianglesBufferSize = trianglesSize * 16;
        const triangleHostBuffer = new ArrayBuffer(trianglesBufferSize);
        const triangleDataView = new DataView(triangleHostBuffer);
        offset = 0;

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

        const triangleBuffer = device.createBuffer({
            label: "triangles",
            size: triangleDataView.byteLength,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        device.queue.writeBuffer(triangleBuffer, 0, triangleHostBuffer);

        // Geometry Buffer
        const geomsSize = this.geomDataArray.length;
        const geomsBufferSize = 16 + geomsSize * (16 * 4 * 3 + 16 * 2);
        const geomHostBuffer = new ArrayBuffer(geomsBufferSize);
        const geomDataView = new DataView(geomHostBuffer);
        offset = 0;

        geomDataView.setUint32(offset, geomsSize, true);
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
            offset += 16;
        }

        const geomBuffer = device.createBuffer({
            label: "geoms",
            size: geomDataView.byteLength,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        device.queue.writeBuffer(geomBuffer, 0, geomDataView);

        // BVH Buffer
        const bvhNodesSize = this.bvhNodesArray.length;
        const bvhNodesBufferSize = 16 + bvhNodesSize * (16 * 3);
        const bvhNodesBuffer = new ArrayBuffer(bvhNodesBufferSize);
        const bvhDataView = new DataView(bvhNodesBuffer);
        offset = 0;

        bvhDataView.setUint32(offset, bvhNodesSize, true);
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

        const bvhBuffer = device.createBuffer({
            label: "bvh",
            size: bvhNodesBuffer.byteLength,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        device.queue.writeBuffer(bvhBuffer, 0, bvhNodesBuffer);

        // Material Buffer
        const materialsSize = this.materialDataArray.length;
        const materialsBufferSize = materialsSize * 48;
        const materialHostBuffer = new ArrayBuffer(materialsBufferSize);
        const materialDataView = new DataView(materialHostBuffer);

        offset = 0;
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
            materialDataView.setUint32(offset, material.baseColorTextureIndex, true);
            offset += 4;
            materialDataView.setUint32(offset, material.emissiveTextureIndex, true);
            offset += 4;
            materialDataView.setUint32(offset, material.matType, true);
            offset += 4;
        }

        const materialBuffer = device.createBuffer({
            label: "materials",
            size: materialHostBuffer.byteLength,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        device.queue.writeBuffer(materialBuffer, 0, materialHostBuffer);

        // Texture Data Buffer
        let totalTextureDataLength = 0;
        for (const floatData of this.textureDataArrays) {
            totalTextureDataLength += floatData.length;
        }
        const textureData = new Float32Array(totalTextureDataLength);
        let textureDataOffset = 0;
        for (const floatData of this.textureDataArrays) {
            textureData.set(floatData, textureDataOffset);
            textureDataOffset += floatData.length;
        }

        const textureDataBuffer = device.createBuffer({
            label: "texture data",
            size: textureData.byteLength,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            mappedAtCreation: true,
        });
        new Float32Array(textureDataBuffer.getMappedRange()).set(textureData);
        textureDataBuffer.unmap();

        // Texture Descriptors Buffer
        const descriptorsData = new Uint32Array(this.textureDescriptors.length * 4);
        for (let i = 0; i < this.textureDescriptors.length; i++) {
            const desc = this.textureDescriptors[i];
            const offset = i * 4;
            descriptorsData[offset + 0] = desc.width;
            descriptorsData[offset + 1] = desc.height;
            descriptorsData[offset + 2] = desc.offset;
            descriptorsData[offset + 3] = 0;
        }

        const descriptorsBuffer = device.createBuffer({
            label: "texture descriptors",
            size: descriptorsData.byteLength,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            mappedAtCreation: true,
        });
        new Uint32Array(descriptorsBuffer.getMappedRange()).set(descriptorsData);
        descriptorsBuffer.unmap();

        const dummyBuffer = device.createBuffer({
            size: 48,
            usage: GPUBufferUsage.STORAGE,
            mappedAtCreation: true,
        });
        new Uint8Array(dummyBuffer.getMappedRange()).fill(0);
        dummyBuffer.unmap();

        // Bind groups
        const geometryBindGroupLayout = device.createBindGroupLayout({
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
        const textureBindGroupLayout = device.createBindGroupLayout({
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
            { binding: 0, resource: { buffer: vertexBuffer } },
            { binding: 1, resource: { buffer: triangleBuffer } },
            { binding: 2, resource: { buffer: geomBuffer } },
            { binding: 3, resource: { buffer: bvhBuffer } },
        ];
        const textureBindGroupEntries: GPUBindGroupEntry[] = [
            { binding: 0, resource: { buffer: materialHostBuffer.byteLength > 0 ? materialBuffer : dummyBuffer } },
            { binding: 1, resource: { buffer: descriptorsData.byteLength > 0 ? descriptorsBuffer : dummyBuffer } },
            { binding: 2, resource: { buffer: textureData.byteLength > 0 ? textureDataBuffer : dummyBuffer } },
        ];

        const geometryBindGroup = device.createBindGroup({
            label: "geometry bind group",
            layout: geometryBindGroupLayout,
            entries: geometryBindGroupEntries,
        });
        const textureBindGroup = device.createBindGroup({
            label: "texture bind group",
            layout: textureBindGroupLayout,
            entries: textureBindGroupEntries,
        });

        return { geometryBindGroup, geometryBindGroupLayout, textureBindGroup, textureBindGroupLayout };
    };
}
