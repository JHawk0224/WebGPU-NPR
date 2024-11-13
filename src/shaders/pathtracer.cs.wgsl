@group(${bindGroup_scene}) @binding(0) var<uniform> cameraUniforms: CameraUniforms;
@group(${bindGroup_scene}) @binding(1) var<storage, read> lightSet: LightSet;

@group(${bindGroup_pathtracer}) @binding(0) var outputTex : texture_storage_2d<rgba8unorm, write>;
@group(${bindGroup_pathtracer}) @binding(1) var<storage, read_write> pathSegments : PathSegments;
@group(${bindGroup_pathtracer}) @binding(2) var<storage, read_write> geoms : Geoms;
@group(${bindGroup_pathtracer}) @binding(3) var<storage, read_write> materials : Materials;
@group(${bindGroup_pathtracer}) @binding(4) var<storage, read_write> intersections : Intersections;
@group(${bindGroup_pathtracer}) @binding(5) var<storage, read_write> compactionInfo : CompactionInfo;
@group(${bindGroup_pathtracer}) @binding(6) var<storage, read_write> prefixSums : array<u32>;
@group(${bindGroup_pathtracer}) @binding(7) var<storage, read_write> compactedIndices : array<u32>;

struct CompactionInfo {
    numValidPaths : atomic<u32>,
}

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
    if (globalIdx.x >= u32(cameraUniforms.resolution[0]) || globalIdx.y >= u32(cameraUniforms.resolution[1])) {
        return;
    }

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

    segment.color = vec3(1.0f, 1.0f, 1.0f);
    segment.pixelIndex = i32(index);
    segment.remainingBounces = i32(cameraUniforms.depth);
}

@compute
@workgroup_size(${workgroupSizeX}, ${workgroupSizeY})
fn computeIntersections(@builtin(global_invocation_id) globalIdx: vec3u) {
    if (globalIdx.x >= u32(cameraUniforms.resolution[0]) || globalIdx.y >= u32(cameraUniforms.resolution[1])) {
        return;
    }

    let index = globalIdx.x + (globalIdx.y * u32(cameraUniforms.resolution[0]));
    let pathSegment = &pathSegments.segments[index];

    var closestHit : HitInfo;
    var tempHit : HitInfo;
    var tMin = 10000000000.0;
    var hitGeomIndex = -1;

    // naive parse through global geoms
    for (var i = 0; i < i32(geoms.geomsSize); i++) {
        let geom = &geoms.geoms[i];

        if (geom.geomType == 0) {
            tempHit = boxIntersectionTest(geom, pathSegment.ray);
        } else if (geom.geomType == 1) {
            tempHit = sphereIntersectionTest(geom, pathSegment.ray);
        }

        if (tempHit.dist > 0.0 && tMin > tempHit.dist) {
            closestHit = tempHit;
            hitGeomIndex = i;
            tMin = tempHit.dist;
        }
    }

    if (hitGeomIndex == -1) {
        intersections.intersections[index].t = -1.0;
        intersections.intersections[index].materialId = -1;
    } else {
        intersections.intersections[index].t = closestHit.dist;
        intersections.intersections[index].materialId = geoms.geoms[hitGeomIndex].materialid;
        intersections.intersections[index].surfaceNormal = closestHit.normal;
    }
}

// Generate flags for active paths (1 for active, 0 for terminated)
@compute @workgroup_size(${workgroupSizeX}, ${workgroupSizeY})
fn generateFlags(@builtin(global_invocation_id) globalIdx: vec3u) {
    if (globalIdx.x >= u32(cameraUniforms.resolution[0]) || globalIdx.y >= u32(cameraUniforms.resolution[1])) {
        return;
    }

    let index = globalIdx.x + (globalIdx.y * u32(cameraUniforms.resolution[0]));
    let pathSegment = &pathSegments.segments[index];
    
    // A path is active if it hasn't terminated (remainingBounces >= 0)
    prefixSums[index] = select(0u, 1u, pathSegment.remainingBounces >= 0);
}

// Perform exclusive scan on the flags array
@compute @workgroup_size(256)
fn exclusiveScan(@builtin(global_invocation_id) globalId: vec3u, @builtin(workgroup_id) workgroupId: vec3u) {
    let tid = globalId.x;
    let bid = workgroupId.x;
    
    var shared_data: array<u32, 512>;  // 2 * workgroup size for scan
    
    if (tid * 2 < arrayLength(&prefixSums)) {
        shared_data[tid * 2] = prefixSums[tid * 2];
    } else {
        shared_data[tid * 2] = 0u;
    }
    
    if (tid * 2 + 1 < arrayLength(&prefixSums)) {
        shared_data[tid * 2 + 1] = prefixSums[tid * 2 + 1];
    } else {
        shared_data[tid * 2 + 1] = 0u;
    }
    
    // Up-sweep phase
    var offset = 1u;
    for (var d = 256u; d > 0u; d >>= 1u) {
        workgroupBarrier();
        
        if (tid < d) {
            let ai = offset * (2u * tid + 1u) - 1u;
            let bi = offset * (2u * tid + 2u) - 1u;
            shared_data[bi] += shared_data[ai];
        }
        offset *= 2u;
    }
    
    // Clear last element
    if (tid == 0u) {
        let last = shared_data[511];
        shared_data[511] = 0u;
        
        // Store block sum for later
        if (bid > 0u) {
            atomicStore(&compactionInfo.numValidPaths, last);
        }
    }
    
    // Down-sweep phase
    for (var d = 1u; d < 512u; d *= 2u) {
        offset >>= 1u;
        workgroupBarrier();
        
        if (tid < d) {
            let ai = offset * (2u * tid + 1u) - 1u;
            let bi = offset * (2u * tid + 2u) - 1u;
            
            let temp = shared_data[ai];
            shared_data[ai] = shared_data[bi];
            shared_data[bi] += temp;
        }
    }
    workgroupBarrier();
    
    // Write results back
    if (tid * 2 < arrayLength(&prefixSums)) {
        prefixSums[tid * 2] = shared_data[tid * 2];
    }
    if (tid * 2 + 1 < arrayLength(&prefixSums)) {
        prefixSums[tid * 2 + 1] = shared_data[tid * 2 + 1];
    }
}

// Compact the active paths based on scan results
@compute @workgroup_size(${workgroupSizeX}, ${workgroupSizeY})
fn compactPaths(@builtin(global_invocation_id) globalIdx: vec3u) {
    if (globalIdx.x >= u32(cameraUniforms.resolution[0]) || globalIdx.y >= u32(cameraUniforms.resolution[1])) {
        return;
    }

    let index = globalIdx.x + (globalIdx.y * u32(cameraUniforms.resolution[0]));
    let pathSegment = &pathSegments.segments[index];
    
    if (pathSegment.remainingBounces >= 0) {
        let compactedIndex = prefixSums[index];
        compactedIndices[compactedIndex] = index;
    }
}

fn scatterRay(index: u32) {
    let pathSegment = &pathSegments.segments[index];
    let intersect = &intersections.intersections[index];
    let material = &materials.materials[index];

    if (intersect.t < 0.0) {
        let color = vec3f(0.0);
        pathSegment.color = color;
        pathSegment.remainingBounces = -2;
        return;
    }

    var scattered : PathSegment;
    var bsdf : vec3f;
    var pdf : f32;
    var attenuation : vec3f;

    let dirIn = pathSegment.ray.direction;

    if (material.matType == 0) { // Emissive
        pathSegment.remainingBounces = -1;
        bsdf = evalEmissive(dirIn, pathSegment.ray.direction, intersect.surfaceNormal, material.color, material.emittance);
        attenuation = bsdf;
    } else if (material.matType == 1) { // Lambertian
        scattered = scatterLambertian(index, pathSegment.ray.origin + pathSegment.ray.direction * intersect.t, intersect.surfaceNormal);
        bsdf = evalLambertian(dirIn, pathSegment.ray.direction, intersect.surfaceNormal, material.color);
        pdf = pdfLambertian(dirIn, pathSegment.ray.direction, intersect.surfaceNormal);
        attenuation = bsdf / pdf;
    } else if (material.matType == 2) { // Metal
        scattered = scatterMetal(index, pathSegment.ray.origin + pathSegment.ray.direction * intersect.t, intersect.surfaceNormal, material.roughness);
        bsdf = evalMetal(dirIn, pathSegment.ray.direction, intersect.surfaceNormal, material.color);
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

    pathSegment.color = vec3f(1.0);

    if (pathSegment.remainingBounces < 0 && material.matType != 0) {
        pathSegment.color = vec3f(0.0);
    }
}
@compute @workgroup_size(${workgroupSizeX}, ${workgroupSizeY})
fn integrate(@builtin(global_invocation_id) globalIdx: vec3u) {
    if (globalIdx.x >= u32(cameraUniforms.resolution[0]) || globalIdx.y >= u32(cameraUniforms.resolution[1])) {
        return;
    }

    let index = globalIdx.x + (globalIdx.y * u32(cameraUniforms.resolution[0]));
    let pathSegment = &pathSegments.segments[index];

    // Only process paths that haven't terminated
    if (pathSegment.remainingBounces >= 0) {
        scatterRay(index);

        // Store the result if this is the last bounce or we hit an emissive surface
        if (pathSegment.remainingBounces < 0 || intersections.intersections[index].materialId == 0) {
            textureStore(outputTex, vec2u(
                index % u32(cameraUniforms.resolution[0]),
                index / u32(cameraUniforms.resolution[0])
            ), vec4(pathSegment.color, 1.0));
        }
    }
}