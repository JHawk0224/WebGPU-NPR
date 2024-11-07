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
    pixelIndex : u32,
    remainingBounces : u32,
}

struct PathSegments
{
    segments : array<PathSegment, ${maxResolutionWidth} * ${maxResolutionHeight}>
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

// https://stackoverflow.com/a/4579069
fn intersectionTest(S: vec3<f32>, r: f32, C1: vec3<f32>, C2: vec3<f32>) -> bool {
    var r_squared = r * r;
    let closestPoint = clamp(S, C1, C2);
    let vecToClosestPoint = closestPoint - S;
    let distanceSquared = dot(vecToClosestPoint, vecToClosestPoint);
    return distanceSquared <= r_squared;
}