const PI = 3.1415926535897932384626422832795028841971;
const TWO_PI = 6.2831853071795864769252867665590057683943;
const SQRT_OF_ONE_THIRD = 0.5773502691896257645091487805019574556476;
const EPSILON = 0.0001;

struct Light {
    pos : vec3f,
    color : vec3f
}

struct LightSet {
    numLights : u32,
    lights : array<Light>
}

struct Cluster {
    numLights : u32,
    lights : array<u32, ${maxNumLightsPerCluster}>
}

struct ClusterSet {
    clusters : array<Cluster, ${numClusterX} * ${numClusterY} * ${numClusterZ}>
}

struct Ray
{
    origin : vec3f,
    direction : vec3f
}

struct PathSegment
{
    ray : Ray,
    color : vec3f,
    pixelIndex : i32,
    remainingBounces : i32,
    pathPrefix : u32,
    appliedStyleType : u32,
}

struct PathSegments
{
    segments : array<PathSegment, ${maxResolutionWidth} * ${maxResolutionHeight}>
}

// Order is weird to make it more compact
struct Geom
{
    transform : mat4x4f,
    inverseTransform : mat4x4f,
    invTranspose : mat4x4f,
    geomType : u32, // 0 == CUBE, 1 == SPHERE, 2 == MESH
    materialId : i32,
    triangleCount : u32,
    triangleStartIdx : i32,
    bvhRootNodeIdx : i32,
    objectId : u32
};

struct Geoms {
    geomsSize : u32,
    geoms : array<Geom>
}

struct Vertex {
    position: vec3f,
    normal: vec3f,
    uv: vec2f,
};

struct Vertices {
    vertices: array<Vertex>
};

struct Triangle {
    v0: u32,
    v1: u32,
    v2: u32,
    materialId: i32
};

struct Triangles {
    tris: array<Triangle>
};

struct BVHNode {
    boundsMin: vec4f,
    boundsMax: vec4f,
    leftChild: i32,
    rightChild: i32,
    triangleStart: i32,
    triangleCount: u32
};

struct BVHNodes {
    nodesSize: u32,
    nodes: array<BVHNode>
};

struct Material {
    baseColorFactor: vec4f,
    emissiveFactor: vec3f,
    metallicFactor: f32,
    roughnessFactor: f32,
    baseColorTextureIndex: i32,  // index into textureDescriptors
    emissiveTextureIndex: i32,   // index into textureDescriptors
    matType: i32,                // material type (0: Emissive, 1: Lambertian, 2: Metal)
    styleType: u32
};

struct Intersection
{
    surfaceNormal : vec3<f32>,
    t : f32,
    uv : vec2<f32>,
    materialId : i32, // materialId == -1 means no intersection
    objectId : u32
};

struct Intersections
{
    intersections : array<Intersection, ${maxResolutionWidth} * ${maxResolutionHeight}>
}

struct HitInfo
{
    intersectionPoint : vec3<f32>,
    dist : f32,
    normal : vec3<f32>,
    outside : u32,
    uv : vec2<f32>,
    materialId : i32
}

struct CameraUniforms {
    viewproj : mat4x4f,
    view : mat4x4f,
    proj : mat4x4f,
    projInv : mat4x4f,
    front : vec3<f32>,
    numFrames : u32,
    up : vec3<f32>,
    right : vec3<f32>,
    depth : f32,
    nearFar : vec2<f32>,
    resolution : vec2<f32>,
    pixelLength : vec2<f32>,
    cameraPos : vec3<f32>,
    numSamples : f32,
    seed : vec3u,
    counter : u32,
}

struct StyleContext {
    // materialId, objectId, path prefix, styleType
    // currently just look at last path vertex's objectId
    params : vec4<u32>,
    position : vec3<f32>,
    normal : vec3<f32>,
}

// this special attenuation function ensures lights don't affect geometry outside the maximum light radius
fn rangeAttenuation(distance: f32) -> f32 {
    return clamp(1.f - pow(distance / ${lightRadius}, 4.f), 0.f, 1.f) / (distance * distance);
}

fn calculateLightContrib(light: Light, posWorld: vec3f, nor: vec3f) -> vec3f {
    let vecToLight = light.pos - posWorld;
    let distToLight = length(vecToLight);

    let lambert = max(dot(nor, normalize(vecToLight)), 0.f);
    return light.color * lambert * rangeAttenuation(distToLight);
}

fn calculateLightContribToonShading(light: Light, posWorld: vec3f, viewDir: vec3f, nor: vec3f, ambientLight: vec3f) -> vec3f {
    let vecToLight = light.pos - posWorld;
    let distToLight = length(vecToLight);

    let ndotl = dot(nor, normalize(vecToLight));

    let rimIntensity = smoothstep(0.716 - 0.01, 0.716 + 0.01, (1.0 - dot(viewDir, nor)) * pow(ndotl, 0.1));
    let rim = rimIntensity * vec3f(1.0);

    if (ndotl > 0) {
        let intensity = smoothstep(0.48, 0.52, ndotl);

        return light.color * rangeAttenuation(distToLight) * intensity * (vec3f(1.0) + ambientLight + rim);
    }
    return light.color * rangeAttenuation(distToLight) * ambientLight;
}

fn applyTransform(p: vec4<f32>, transform: mat4x4<f32>) -> vec3<f32> {
    let transformed = transform * p;
    return transformed.xyz / transformed.w;
}

// cannot use WebGPU built in Textures since we need all loaded in memory
// at once for compute shader
// https://nelari.us/post/weekend_raytracing_with_wgpu_2/#adding-texture-support
struct TextureDescriptor {
    width: u32,
    height: u32,
    offset: u32,
    wrapS: u32,
    wrapT: u32,
    minFilter: u32,
    magFilter: u32
};

struct Textures {
    textures: array<array<f32, 4>>
}

// Wrap modes
const WRAP_MODE_REPEAT: u32 = 0u;
const WRAP_MODE_CLAMP_TO_EDGE: u32 = 1u;
const WRAP_MODE_MIRRORED_REPEAT: u32 = 2u;

// Filter modes
const FILTER_NEAREST: u32 = 0u;
const FILTER_LINEAR: u32 = 1u;

fn applyWrapMode(coord: f32, wrapMode: u32) -> f32 {
    if (wrapMode == WRAP_MODE_REPEAT) {
        return coord - floor(coord);
    } else if (wrapMode == WRAP_MODE_CLAMP_TO_EDGE) {
        return clamp(coord, 0.0, 1.0);
    } else if (wrapMode == WRAP_MODE_MIRRORED_REPEAT) {
        let fracPart = fract(coord);
        let floored = floor(coord);
        let floored_u32 = u32(floored);
        let isEven = (floored_u32 % 2u) == 0u;
        return select(1.0 - fracPart, fracPart, isEven);
    }
    return coord - floor(coord); // default to repeat
}

fn sampleTexture(desc: TextureDescriptor, u: f32, v: f32, textures: ptr<storage, Textures, read>) -> vec3<f32> {
    if (desc.minFilter == FILTER_NEAREST && desc.magFilter == FILTER_NEAREST) {
        return textureNearest(desc, u, v, textures);
    } else if (desc.minFilter == FILTER_LINEAR && desc.magFilter == FILTER_LINEAR) {
        return textureBilinear(desc, u, v, textures);
    }
    return textureNearest(desc, u, v, textures); // default to nearest
}

fn textureNearest(desc: TextureDescriptor, u: f32, v: f32, textures: ptr<storage, Textures, read>) -> vec3<f32> {
    let i = u32(round(v));
    let j = u32(round(u));
    let idx = i * desc.width + j;

    let elem = textures.textures[desc.offset + idx];
    return vec3f(elem[0u], elem[1u], elem[2u]);
}

fn textureBilinear(desc: TextureDescriptor, u: f32, v: f32, textures: ptr<storage, Textures, read>) -> vec3<f32> {
    let i0 = u32(floor(v));
    let j0 = u32(floor(u));
    let i1 = min(i0 + 1u, desc.height - 1u);
    let j1 = min(j0 + 1u, desc.width - 1u);

    let u_ratio = fract(u);
    let v_ratio = fract(v);

    let idx00 = i0 * desc.width + j0;
    let idx10 = i0 * desc.width + j1;
    let idx01 = i1 * desc.width + j0;
    let idx11 = i1 * desc.width + j1;

    let tex00 = textures.textures[desc.offset + idx00];
    let tex10 = textures.textures[desc.offset + idx10];
    let tex01 = textures.textures[desc.offset + idx01];
    let tex11 = textures.textures[desc.offset + idx11];

    let color00 = vec3f(tex00[0u], tex00[1u], tex00[2u]);
    let color10 = vec3f(tex10[0u], tex10[1u], tex10[2u]);
    let color01 = vec3f(tex01[0u], tex01[1u], tex01[2u]);
    let color11 = vec3f(tex11[0u], tex11[1u], tex11[2u]);

    let color0 = mix(color00, color10, u_ratio);
    let color1 = mix(color01, color11, u_ratio);
    return mix(color0, color1, v_ratio);
}

fn textureLookup(desc: TextureDescriptor, u_orig: f32, v_orig: f32, textures: ptr<storage, Textures, read>) -> vec3<f32> {
    let u_wrapped = applyWrapMode(u_orig, desc.wrapS);
    let v_wrapped = applyWrapMode(v_orig, desc.wrapT);

    let u = u_wrapped * f32(desc.width - 1u);
    let v = (1.0 - v_wrapped) * f32(desc.height - 1u);

    return sampleTexture(desc, u, v, textures);
}

// RNG code from https://github.com/webgpu/webgpu-samples/blob/main/sample/cornell/common.wgsl#L93
// A psuedo random number. Initialized with init_rand(), updated with rand().
var<private> rnd : vec3u;

// Initializes the random number generator.
fn init_rand(invocation_id : vec3u, seed : vec3u) {
  const A = vec3(1741651 * 1009,
                 140893  * 1609 * 13,
                 6521    * 983  * 7 * 2);
  rnd = (invocation_id * A) ^ seed;
}

// Returns a random number between 0 and 1.
fn rand() -> f32 {
  const C = vec3(60493  * 9377,
                 11279  * 2539 * 23,
                 7919   * 631  * 5 * 3);

  rnd = (rnd * C) ^ (rnd.yzx >> vec3(4u));
  return f32(rnd.x ^ rnd.y) / f32(0xffffffff);
}

fn shiftIndex(invocation_id : vec3u, counter : u32) -> vec3u {
    var ret : vec3u;

    var x = invocation_id.x;
    x += counter;
    x ^= x << 13;
    x ^= x >> 17;
    x ^= x << 5;

    var y = invocation_id.y;
    y += counter;
    y ^= y << 13;
    y ^= y >> 17;
    y ^= y << 5;
    
    var z = invocation_id.z;
    z += counter;
    z ^= z << 13;
    z ^= z >> 17;
    z ^= z << 5;

    ret.x = x;
    ret.y = y;
    ret.z = z;

    return ret;
}
