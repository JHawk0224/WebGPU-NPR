@group(${bindGroup_scene}) @binding(0) var<uniform> cameraUniforms: CameraUniforms;
@group(${bindGroup_scene}) @binding(1) var<storage, read> lightSet: LightSet;

@group(${bindGroup_pathtracer}) @binding(0) var outputTex : texture_storage_2d<rgba8unorm, write>;
@group(${bindGroup_pathtracer}) @binding(1) var inputTex : texture_2d<f32>;
@group(${bindGroup_pathtracer}) @binding(2) var<storage, read_write> pathSegments : PathSegments;
@group(${bindGroup_pathtracer}) @binding(3) var<storage, read_write> intersections : Intersections;

@group(${bindGroup_geometry}) @binding(0) var<storage, read> vertices : Vertices;
@group(${bindGroup_geometry}) @binding(1) var<storage, read> tris : Triangles;
@group(${bindGroup_geometry}) @binding(2) var<storage, read> geoms : Geoms;
@group(${bindGroup_geometry}) @binding(3) var<storage, read> bvhNodes : BVHNodes;

@group(${bindGroup_textures}) @binding(0) var<storage, read> materials : array<Material>;
// TextureDescriptor contains offset into texture buffer, and dimensions
@group(${bindGroup_textures}) @binding(1) var<storage, read> textureDescriptors: array<TextureDescriptor>;
// Texture buffer contains textures from all meshes, appended end to end
@group(${bindGroup_textures}) @binding(2) var<storage, read> textures: Textures;

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

        segment.color = vec3f(1.0);
        segment.pixelIndex = i32(index);
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
            else if (geom.geomType == 2)
            {
                tempHit = meshIntersectionTest(geom, &vertices, &tris, &bvhNodes, pathSegment.ray);
            }

            // Compute the minimum t from the intersection tests to determine what
            // scene geometry object was hit first.
            if (tempHit.dist > 0.0 && tMin > tempHit.dist)
            {
                tMin = tempHit.dist;
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
            intersections.intersections[index].materialId = closestHit.materialId;
            intersections.intersections[index].surfaceNormal = closestHit.normal;
            intersections.intersections[index].uv = closestHit.uv;
        }
    }
}

fn scatterRay(index: u32) {
    let pathSegment = &pathSegments.segments[index];
    let intersect = &intersections.intersections[index];

    if (intersect.t < 0.0) {
        // let color = vec3f(sampleEnvironmentMap(bgTextureInfo, pathSegment.ray.direction, textures));
        let color = vec3f(0.3);
        pathSegment.color *= color;
        pathSegment.remainingBounces = -2;
        return;
    }

    let matId: u32 = bitcast<u32>(intersect.materialId);
    let material = &materials[matId];

    var scattered : PathSegment;
    var bsdf : vec3f;
    var pdf : f32;
    var attenuation : vec3f;

    // hopefully we can template if we have time later on
    let dirIn = normalize(-pathSegment.ray.direction);

    let hitPoint = pathSegment.ray.origin + pathSegment.ray.direction * intersect.t;
    let normal = intersect.surfaceNormal;
    let uv = intersect.uv;

    var baseColor = material.baseColorFactor.rgb;
    if (material.baseColorTextureIndex >= 0) {
        let texDesc = textureDescriptors[material.baseColorTextureIndex];
        baseColor *= textureLookup(texDesc, uv.x, uv.y, &textures);
    }

    if (material.matType == 0) { // Emissive
        var emissiveColor = material.emissiveFactor.rgb;
        var emissiveFactor = vec3f(1.0);
        if (material.emissiveTextureIndex >= 0) {
            let texDesc = textureDescriptors[material.emissiveTextureIndex];
            emissiveFactor = textureLookup(texDesc, uv.x, uv.y, &textures);
        }
        bsdf = emissiveColor * emissiveFactor;
        // bsdf = evalEmissive(dirIn, pathSegment.ray.direction, intersect.surfaceNormal, emissiveColor, emissiveFactor); // TODO: Fix

        attenuation = bsdf;

        pathSegment.remainingBounces = -1;
        pathSegment.color *= attenuation;
        return;
    } else if (material.matType == 1) { // Lambertian
        scattered = scatterLambertian(index, hitPoint, normal);
        bsdf = evalLambertian(dirIn, scattered.ray.direction, normal, baseColor);
        pdf = pdfLambertian(dirIn, scattered.ray.direction, normal);

        if (pdf == 0.0) {
            attenuation = vec3f(1.0);
            pathSegment.color = baseColor;
        } else {
            attenuation = bsdf / pdf;
        }
    } else if (material.matType == 2) { // Metal
        scattered = scatterMetal(index, hitPoint, normal, material.roughnessFactor);
        // bsdf = evalMetal(dirIn, scattered.ray.direction, normal, baseColor, material.metallicFactor); // TODO: add metallic
        bsdf = evalMetal(dirIn, scattered.ray.direction, normal, baseColor);

        attenuation = bsdf;
    }
    pathSegment.ray.origin = scattered.ray.origin;
    pathSegment.ray.direction = scattered.ray.direction;
    pathSegment.remainingBounces--;

    if (scattered.pixelIndex == -1) {
        pathSegment.color = vec3f(0.0);
        pathSegment.remainingBounces = -1;
        return;
    }

    pathSegment.color *= attenuation;

    // if (pathSegment.remainingBounces < 0 && material.matType != 0) { // TODO: Add back
    //     // did not reach a light till max depth, terminate path as invalid
    //     pathSegment.color = vec3f(0.0);
    //     return;
    // }
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

        if (cameraUniforms.depth == 0) {
            let accumulated = textureLoad(inputTex, globalIdx.xy, 0).xyz;
            let resultColor = vec4(1.0 / f32(cameraUniforms.numSamples) * pathSegment.color + accumulated, 1);
            textureStore(outputTex, globalIdx.xy, resultColor);
        }
    }
}
