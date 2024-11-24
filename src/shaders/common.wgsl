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
    remainingBounces : i32
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
    bvhRootNodeIdx : i32
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
};

struct Intersection
{
    surfaceNormal : vec3<f32>,
    t : f32,
    uv : vec2<f32>,
    materialId : i32 // materialId == -1 means no intersection
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
    up : vec3<f32>,
    right : vec3<f32>,
    depth : f32,
    nearFar : vec2<f32>,
    resolution : vec2<f32>,
    pixelLength : vec2<f32>,
    cameraPos : vec3<f32>,
    numSamples : f32,
    seed : vec3u
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
}
