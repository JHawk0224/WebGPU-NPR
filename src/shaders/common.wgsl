const PI = 3.1415926535897932384626422832795028841971;
const TWO_PI = 6.2831853071795864769252867665590057683943;
const SQRT_OF_ONE_THIRD = 0.5773502691896257645091487805019574556476;
const EPSILON = 0.00001;

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
    direction : vec3f,
}

struct PathSegment
{
    ray : Ray,
    color : vec3f,
    pixelIndex : i32,
    remainingBounces : i32,
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
    triangleStartIdx : u32
};

struct Triangle {
    v0: vec4f,
    v1: vec4f,
    v2: vec4f,
    materialId: i32
};

struct Geoms {
    geomsSize : u32,
    geoms : array<Geom>
}

struct Triangles {
    trisSize : u32,
    tris : array<Triangle>
}

struct Material
{
    color : vec3f,
    matType : u32, // 0 == emissive, 1 == lambertian
    emittance : f32,
    roughness : f32,
};

struct Materials
{
    materialsSize : u32,
    materials : array<Material, 2>
}

struct Intersection
{
    surfaceNormal : vec3<f32>,
    t : f32,
    materialId : i32, // materialId == -1 means no intersection
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
    hitTriIndex : i32,
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
    seed : vec3u,
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