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
    pixelIndex : u32,
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
    translation : vec3<f32>,
    geomType : u32, // 0 == CUBE, 1 == SPHERE
    rotation : vec3<f32>,
    materialid : i32,
    scale : vec3<f32>,
};

struct Geoms
{
    geomsSize : u32,
    geoms : array<Geom, 2>
}

struct Material
{
    color : vec3f,
    matType : u32, // 0 == emissive, 1 == lambertian
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

fn getPointOnRay(r: Ray, t: f32) -> vec3f {
    return r.origin + (t - 0.0001) * normalize(r.direction);
}

fn boxIntersectionTest(box: ptr<storage, Geom, read_write>, r: Ray) -> HitInfo
{
    var ret : HitInfo;

    var q : Ray;
    q.origin = (box.inverseTransform * vec4f(r.origin, 1.0)).xyz;
    q.direction = (normalize(box.inverseTransform * vec4f(r.direction, 0.0))).xyz;

    var tmin = -1e38f;
    var tmax = 1e38f;
    var tmin_n : vec3f;
    var tmax_n : vec3f;
    for (var xyz = 0u; xyz < 3u; xyz++)
    {
        let qdxyz = q.direction[xyz];
        let t1 = (-0.5 - q.origin[xyz]) / qdxyz;
        let t2 = (0.5 - q.origin[xyz]) / qdxyz;
        let ta = min(t1, t2);
        let tb = max(t1, t2);
        var n = vec3f(0);
        if (t2 < t1) {
            n[xyz] = 1;
        } else {
            n[xyz] = -1;
        }
        
        if (ta > 0 && ta > tmin)
        {
            tmin = ta;
            tmin_n = n;
        }
        if (tb < tmax)
        {
            tmax = tb;
            tmax_n = n;
        }
    }

    if (tmax >= tmin && tmax > 0)
    {
        ret.outside = 1;
        if (tmin <= 0)
        {
            tmin = tmax;
            tmin_n = tmax_n;
            ret.outside = 0;
        }
        ret.intersectionPoint = (box.transform * vec4f(getPointOnRay(q, tmin), 1.0)).xyz;
        ret.normal = (normalize(box.invTranspose * vec4f(tmin_n, 0.0))).xyz;
        ret.dist = length(r.origin - ret.intersectionPoint);
        return ret;
    }

    ret.dist = -1.0;
    return ret;
}

fn sphereIntersectionTest(sphere: ptr<storage, Geom, read_write>, r: Ray) -> HitInfo {
    var ret : HitInfo;

    let radius = 0.5;

    let ro = (sphere.inverseTransform * vec4f(r.origin, 1.0)).xyz;
    let rd = (normalize(sphere.inverseTransform * vec4f(r.direction, 0.0))).xyz;

    var rt : Ray;
    rt.origin = ro;
    rt.direction = rd;

    let vDotDirection = dot(rt.origin, rt.direction);
    let radicand = vDotDirection * vDotDirection - (dot(rt.origin, rt.origin) - pow(radius, 2.0));
    if (radicand < 0)
    {
        ret.dist = -1;
        return ret;
    }

    let squareRoot = sqrt(radicand);
    let firstTerm = -vDotDirection;
    let t1 = firstTerm + squareRoot;
    let t2 = firstTerm - squareRoot;

    var t = 0.0;
    if (t1 < 0 && t2 < 0)
    {
        ret.dist = -1;
        return ret;
    }
    else if (t1 > 0 && t2 > 0)
    {
        t = min(t1, t2);
        ret.outside = 1;
    }
    else
    {
        t = max(t1, t2);
        ret.outside = 0;
    }

    let objspaceIntersection = getPointOnRay(rt, t);

    ret.intersectionPoint = (sphere.transform * vec4f(objspaceIntersection, 1.0)).xyz;
    ret.normal = (normalize(sphere.invTranspose * vec4f(objspaceIntersection, 0.0))).xyz;
    if (ret.outside == 0)
    {
        ret.normal = -ret.normal;
    }

    ret.dist = length(r.origin - ret.intersectionPoint);
    return ret;
}