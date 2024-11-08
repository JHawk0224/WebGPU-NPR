@group(${bindGroup_scene}) @binding(0) var<uniform> cameraUniforms: CameraUniforms;
@group(${bindGroup_scene}) @binding(1) var<storage, read> lightSet: LightSet;

@group(${bindGroup_pathtracer}) @binding(0) var outputTex : texture_storage_2d<rgba8unorm, write>;
@group(${bindGroup_pathtracer}) @binding(1) var<storage, read_write> pathSegments : PathSegments;
@group(${bindGroup_pathtracer}) @binding(2) var<storage, read_write> geoms : Geoms;
@group(${bindGroup_pathtracer}) @binding(3) var<storage, read_write> materials : Materials;
@group(${bindGroup_pathtracer}) @binding(4) var<storage, read_write> intersections : Intersections;

// RNG code from https://github.com/webgpu/webgpu-samples/blob/main/sample/cornell/common.wgsl
// A psuedo random number. Initialized with init_rand(), updated with rand().
var<private> rnd : vec3u;

// Initializes the random number generator.
fn init_rand(invocation_id : vec3u) {
  const A = vec3(1741651 * 1009,
                 140893  * 1609 * 13,
                 6521    * 983  * 7 * 2);
  rnd = (invocation_id * A) ^ cameraUniforms.seed;
}

// Returns a random number between 0 and 1.
fn rand() -> f32 {
  const C = vec3(60493  * 9377,
                 11279  * 2539 * 23,
                 7919   * 631  * 5 * 3);

  rnd = (rnd * C) ^ (rnd.yzx >> vec3(4u));
  return f32(rnd.x ^ rnd.y) / f32(0xffffffff);
}

fn randomDirectionInHemisphere(normal: vec3f) -> vec3f
{
    let up = sqrt(rand()); // cos(theta)
    let over = sqrt(1.0 - up * up); // sin(theta)
    let around = rand() * TWO_PI;

    // Find a direction that is not the normal based off of whether or not the
    // normal's components are all equal to sqrt(1/3) or whether or not at
    // least one component is less than sqrt(1/3). Learned this trick from
    // Peter Kutz.

    var directionNotNormal: vec3f;
    if (abs(normal.x) < SQRT_OF_ONE_THIRD)
    {
        directionNotNormal = vec3f(1, 0, 0);
    }
    else if (abs(normal.y) < SQRT_OF_ONE_THIRD)
    {
        directionNotNormal = vec3f(0, 1, 0);
    }
    else
    {
        directionNotNormal = vec3f(0, 0, 1);
    }

    // Use not-normal direction to generate two perpendicular directions
    let perpendicularDirection1 = normalize(cross(normal, directionNotNormal));
    let perpendicularDirection2 = normalize(cross(normal, perpendicularDirection1));

    return up * normal + cos(around) * over * perpendicularDirection1 + sin(around) * over * perpendicularDirection2;
}

@compute
@workgroup_size(${workgroupSizeX}, ${workgroupSizeY})
fn generateRay(@builtin(global_invocation_id) globalIdx: vec3u) {
    if (globalIdx.x < u32(cameraUniforms.resolution[0]) && globalIdx.y < u32(cameraUniforms.resolution[1])) {
        let index = globalIdx.x + (globalIdx.y * u32(cameraUniforms.resolution[0]));

        let segment = &pathSegments.segments[index];

        // Antialiasing: jitter rays by [0,1] to generate uniformly random direction distribution per pixel
        let jitter = vec2(rand(), rand());
        segment.ray.direction = normalize(cameraUniforms.front
            - cameraUniforms.right * f32(cameraUniforms.pixelLength[0]) * (f32(globalIdx.x) - 0.5 + jitter[0] - f32(cameraUniforms.resolution[0]) * 0.5)
            - cameraUniforms.up * f32(cameraUniforms.pixelLength[1]) * (f32(globalIdx.y) - 0.5 + jitter[1] - f32(cameraUniforms.resolution[1]) * 0.5)
        );

        // Depth of Field, construct a new direction pointing the same direction but from new origin AND at focal length away
        let apertureOrigin = vec3(0.0); // cameraUniforms.apertureSize * randomOnUnitCircle(rng);
        segment.ray.origin = cameraUniforms.cameraPos + cameraUniforms.right * apertureOrigin[0] + cameraUniforms.up * apertureOrigin[1];
        // segment.ray.direction = normalize(segment.ray.direction * cameraUniforms.focalLength + cameraUniforms.position - segment.ray.origin);

        segment.color = vec3(1.0f, 1.0f, 1.0f);
        segment.pixelIndex = index;
        segment.remainingBounces = i32(cameraUniforms.depth);
    }
}

@compute
@workgroup_size(${workgroupSizeX}, ${workgroupSizeY})
fn computeIntersections(@builtin(global_invocation_id) globalIdx: vec3u) {
    if (globalIdx.x < u32(cameraUniforms.resolution[0]) && globalIdx.y < u32(cameraUniforms.resolution[1])) {
        let index = globalIdx.x + (globalIdx.y * u32(cameraUniforms.resolution[0]));

        let pathSegment = &pathSegments.segments[index];

        var closestHit : HitInfo;
        var tempHit : HitInfo;
        var tMin = 10000000000.0; // arbitrary high number for max float
        var hitGeomIndex = -1;

        // naive parse through global geoms
        for (var i = 0; i < i32(geoms.geomsSize); i++)
        {
            let geom = &geoms.geoms[i];

            if (geom.geomType == 0)
            {
                tempHit = boxIntersectionTest(geom, pathSegment.ray);
            }
            else if (geom.geomType == 1)
            {
                tempHit = sphereIntersectionTest(geom, pathSegment.ray);
            }

            // Compute the minimum t from the intersection tests to determine what
            // scene geometry object was hit first.
            if (tempHit.dist > 0.0 && tMin > tempHit.dist)
            {
                closestHit = tempHit;
                hitGeomIndex = i;
            }
        }

        if (hitGeomIndex == -1)
        {
            intersections.intersections[index].t = -1.0;
            intersections.intersections[index].materialId = -1;
        }
        else
        {
            // The ray hits something
            intersections.intersections[index].t = closestHit.dist;
            intersections.intersections[index].materialId = geoms.geoms[hitGeomIndex].materialid;
            intersections.intersections[index].surfaceNormal = closestHit.normal;
        }
    }
}

fn scatterLambertian(index: u32, intersect: vec3f, normal: vec3f) -> u32
{
    let pathSegment = &pathSegments.segments[index];

    pathSegment.ray.origin = intersect + normal * EPSILON;
    pathSegment.ray.direction = randomDirectionInHemisphere(normal);

    pathSegment.remainingBounces--;

    return 1;
}

fn evalLambertian(dirIn: vec3f, dirOut: vec3f, normal: vec3f, mColor: vec3f) -> vec3f
{
    return mColor * max(0.0, dot(dirOut, normal) / PI);
}

fn pdfLambertian(dirIn: vec3f, dirOut: vec3f, normal: vec3f) -> f32
{
    return max(0.0, dot(dirOut, normal) / PI);
}

fn scatterRay(index: u32) {
    let pathSegment = &pathSegments.segments[index];
    let intersect = &intersections.intersections[index];
    let material = &materials.materials[index];

    if (intersect.t < 0.0) {
        // let color = vec3f(sampleEnvironmentMap(bgTextureInfo, pathSegment.ray.direction, textures));
        let color = vec3f(0.0);
        // outputTex[pathSegment.pixelIndex] += pathSegment.color * color;
        pathSegment.color = color;
        pathSegment.remainingBounces = -2;
        return;
    }

    var scattered : u32;
    var bsdf : vec3f;
    var pdf : f32;
    var attenuation : vec3f;

    // hopefully we can template if we have time later on
    let dirIn = pathSegment.ray.direction;

    if (material.matType == 0) {
        attenuation = vec3f(0.0);
    } else if (material.matType == 1) {
        scattered = scatterLambertian(index, pathSegment.ray.origin + pathSegment.ray.direction * intersect.t, intersect.surfaceNormal);
        bsdf = evalLambertian(dirIn, pathSegment.ray.direction, intersect.surfaceNormal, material.color);
        pdf = pdfLambertian(dirIn, pathSegment.ray.direction, intersect.surfaceNormal);
        attenuation = bsdf / pdf;
    }

    pathSegment.color = vec3f(1.0); // *= attenuation;

    if (pathSegment.remainingBounces < 0 && material.matType != 0) {
        // did not reach a light till max depth, terminate path as invalid
        pathSegment.color = vec3f(0.0);
    }
}

@compute
@workgroup_size(${workgroupSizeX}, ${workgroupSizeY})
fn integrate(@builtin(global_invocation_id) globalIdx: vec3u) {
    if (globalIdx.x < u32(cameraUniforms.resolution[0]) && globalIdx.y < u32(cameraUniforms.resolution[1])) {
        let index = globalIdx.x + (globalIdx.y * u32(cameraUniforms.resolution[0]));

        let pathSegment = &pathSegments.segments[index];

        if (pathSegment.remainingBounces < 0) {
            return;
        }

        scatterRay(index);

        textureStore(outputTex, globalIdx.xy, vec4(pathSegment.color, 1));
    }
}