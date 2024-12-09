struct Uniforms {
    gridWidth: u32
}

@group(0) @binding(3) var<uniform> uniforms: Uniforms;

const gravity: vec3<f32> = vec3<f32>(0.0, -999.81, 0.0);
const timeStep: f32 = 0.004;  // ~60 FPS
const damping: f32 = 0.99;
const windDirection: vec3<f32> = vec3<f32>(-1.0, 0.0, 0.0); // Hard-coded wind direction
const windStrength: f32 = 15.0; // Hard-coded wind strength

var<private> constraintIterations: u32 = 15u;
const restLength: f32 = 0.1;
const stiffness: f32 = 0.8;

@group(0) @binding(0) var<storage, read_write> vertices: Vertices;
@group(0) @binding(1) var<storage, read_write> previousPositions: array<vec3<f32>>;
@group(0) @binding(2) var<storage, read_write> velocities: array<vec3<f32>>;

@group(1) @binding(0) var<storage, read> sceneVertices : Vertices;
@group(1) @binding(1) var<storage, read> tris : Triangles;
@group(1) @binding(2) var<storage, read> geoms : Geoms;
@group(1) @binding(3) var<storage, read> bvhNodes : BVHNodes;

fn solveDistanceConstraint(p1: ptr<function, vec3<f32>>, p2: ptr<function, vec3<f32>>, restLength: f32) {
    let delta = *p2 - *p1;
    let deltaLength = length(delta);
    if (deltaLength > 0.000001) {
        let diff = (deltaLength - restLength) / deltaLength;
        let correction = delta * 0.5 * diff * stiffness;
        *p1 += correction;
        *p2 -= correction;
    }
}

fn projectOutsideCube(pos: ptr<function, vec3<f32>>, cubeMin: vec3<f32>, cubeMax: vec3<f32>) {
    var p = *pos;
    let insideX = (p.x > cubeMin.x && p.x < cubeMax.x);
    let insideY = (p.y > cubeMin.y && p.y < cubeMax.y);
    let insideZ = (p.z > cubeMin.z && p.z < cubeMax.z);

    if (insideX && insideY && insideZ) {
        let distToMinX = p.x - cubeMin.x;
        let distToMaxX = cubeMax.x - p.x;
        let distToMinY = p.y - cubeMin.y;
        let distToMaxY = cubeMax.y - p.y;
        let distToMinZ = p.z - cubeMin.z;
        let distToMaxZ = cubeMax.z - p.z;

        var minDist = distToMinX;
        var axis = 0; // 0 = x min, 1 = y min, 2 = z min, 10 = x max, 11 = y max, 12 = z max

        if (distToMaxX < minDist) { minDist = distToMaxX; axis = 10; }
        if (distToMinY < minDist) { minDist = distToMinY; axis = 1; }
        if (distToMaxY < minDist) { minDist = distToMaxY; axis = 11; }
        if (distToMinZ < minDist) { minDist = distToMinZ; axis = 2; }
        if (distToMaxZ < minDist) { minDist = distToMaxZ; axis = 12; }

        if (axis == 0) {
            p.x = cubeMin.x;
        } else if (axis == 10) {
            p.x = cubeMax.x;
        } else if (axis == 1) {
            p.y = cubeMin.y;
        } else if (axis == 11) {
            p.y = cubeMax.y;
        } else if (axis == 2) {
            p.z = cubeMin.z;
        } else if (axis == 12) {
            p.z = cubeMax.z;
        }
    }

    *pos = p;
}

fn intersectGeom(geom: ptr<storage, Geom, read>, vertices: ptr<storage, Vertices, read>, tris: ptr<storage, Triangles, read>, bvhNodes: ptr<storage, BVHNodes, read>, r: Ray) -> HitInfo {
    if (geom.geomType == 0) {
        return boxIntersectionTest(geom, r);
    } else if (geom.geomType == 1) {
        return sphereIntersectionTest(geom, r);
    } else {
        return meshIntersectionTest(geom, vertices, tris, bvhNodes, r);
    }
}

fn isPointInsideSphere(geom: ptr<storage, Geom, read>, p: vec3<f32>) -> bool {
    // Transform point into object space
    let op = (geom.inverseTransform * vec4f(p, 1.0)).xyz;
    let radius = 0.5;
    return length(op) < radius;
}

fn projectOutsideSphere(pos: ptr<function, vec3<f32>>, geom: ptr<storage, Geom, read>) {
    var p = *pos;
    // Transform point into object space
    let op = (geom.inverseTransform * vec4f(p, 1.0)).xyz;
    let radius = 0.5;
    let l = length(op);
    if (l < radius) {
        let dir = op / l;
        let newOp = dir * radius; // on surface
        p = (geom.transform * vec4f(newOp, 1.0)).xyz;
    }
    *pos = p;
}

fn isPointInsideCube(geom: ptr<storage, Geom, read>, p: vec3<f32>) -> bool {
    // Transform point into object space
    let op = (geom.inverseTransform * vec4f(p, 1.0)).xyz;
    // Cube is from -0.5 to 0.5 in all axes
    return op.x > -0.5 && op.x < 0.5 &&
           op.y > -0.5 && op.y < 0.5 &&
           op.z > -0.5 && op.z < 0.5;
}

fn projectOutsideCubeGeom(pos: ptr<function, vec3<f32>>, geom: ptr<storage, Geom, read>) {
    // The cube is always in range [-0.5,0.5], but we use world space cubeMin, cubeMax
    // to project out. We can get them from transform.
    // We'll just do a bounding cube in world space by transforming the corners and taking min/max.
    // For simplicity (no partial solutions), let's compute world-space cube bounds.
    var corners = array<vec3<f32>, 8>(
        (geom.transform * vec4f(-0.5, -0.5, -0.5, 1.0)).xyz,
        (geom.transform * vec4f(-0.5, -0.5,  0.5, 1.0)).xyz,
        (geom.transform * vec4f(-0.5,  0.5, -0.5, 1.0)).xyz,
        (geom.transform * vec4f(-0.5,  0.5,  0.5, 1.0)).xyz,
        (geom.transform * vec4f( 0.5, -0.5, -0.5, 1.0)).xyz,
        (geom.transform * vec4f( 0.5, -0.5,  0.5, 1.0)).xyz,
        (geom.transform * vec4f( 0.5,  0.5, -0.5, 1.0)).xyz,
        (geom.transform * vec4f( 0.5,  0.5,  0.5, 1.0)).xyz
    );
    var minP = vec3<f32>(1e38,1e38,1e38);
    var maxP = vec3<f32>(-1e38,-1e38,-1e38);
    for (var i=0; i<8; i++){
        minP = min(minP, corners[i]);
        maxP = max(maxP, corners[i]);
    }
    projectOutsideCube(pos, minP, maxP);
}

// For meshes, we need a point-in-mesh test.
// We'll do a ray cast and count how many times we hit the mesh.
// If odd, inside; if even, outside.
// We'll cast in a fixed direction (e.g. upwards: (0,1,0)) and move through all intersections.
fn countMeshIntersections(geom: ptr<storage, Geom, read>, vertices: ptr<storage, Vertices, read>, 
                          tris: ptr<storage, Triangles, read>, bvhNodes: ptr<storage, BVHNodes, read>, start: vec3<f32>) -> u32 {
    var count: u32 = 0u;
    var dir = vec3<f32>(0.0, 1.0, 0.0);
    var r: Ray;
    r.origin = start;
    r.direction = dir;

    loop {
        let hit = meshIntersectionTest(geom, vertices, tris, bvhNodes, r);
        if (hit.dist > 0.0) {
            count += 1u;
            // move the ray origin forward past this intersection
            r.origin = hit.intersectionPoint + dir * 0.0001;
        } else {
            break;
        }
    }

    return count;
}

fn isPointInsideMesh(geom: ptr<storage, Geom, read>, vertices: ptr<storage, Vertices, read>, 
                     tris: ptr<storage, Triangles, read>, bvhNodes: ptr<storage, BVHNodes, read>, p: vec3<f32>) -> bool {
    // First, a quick bounding box test: if point not in transformed AABB, not inside.
    // Compute AABB of mesh from geom. We'll use the bounds from the BVH root if available.
    // If no BVH: fallback to a large bounding box that covers the mesh extents (-0.5 to 0.5, transformed).

    var hasBVH = (geom.bvhRootNodeIdx != -1);
    var insideAABB = true;
    if (hasBVH) {
        let rootNode = bvhNodes.nodes[u32(geom.bvhRootNodeIdx)];
        // transform AABB?
        // The mesh is transformed by geom.transform. We'll transform corners of rootNode AABB similarly.
        var corners = array<vec3<f32>, 8>(
            (geom.transform * vec4f(rootNode.boundsMin.xyz, 1.0)).xyz,
            (geom.transform * vec4f(rootNode.boundsMax.x, rootNode.boundsMin.y, rootNode.boundsMin.z, 1.0)).xyz,
            (geom.transform * vec4f(rootNode.boundsMin.x, rootNode.boundsMax.y, rootNode.boundsMin.z, 1.0)).xyz,
            (geom.transform * vec4f(rootNode.boundsMin.x, rootNode.boundsMin.y, rootNode.boundsMax.z, 1.0)).xyz,
            (geom.transform * vec4f(rootNode.boundsMax.x, rootNode.boundsMax.y, rootNode.boundsMin.z, 1.0)).xyz,
            (geom.transform * vec4f(rootNode.boundsMax.x, rootNode.boundsMin.y, rootNode.boundsMax.z, 1.0)).xyz,
            (geom.transform * vec4f(rootNode.boundsMin.x, rootNode.boundsMax.y, rootNode.boundsMax.z, 1.0)).xyz,
            (geom.transform * vec4f(rootNode.boundsMax.xyz, 1.0)).xyz
        );
        var minP = vec3<f32>(1e38,1e38,1e38);
        var maxP = vec3<f32>(-1e38,-1e38,-1e38);
        for (var i=0; i<8; i++){
            minP = min(minP, corners[i]);
            maxP = max(maxP, corners[i]);
        }
        insideAABB = (p.x >= minP.x && p.x <= maxP.x &&
                      p.y >= minP.y && p.y <= maxP.y &&
                      p.z >= minP.z && p.z <= maxP.z);
    } else {
        // No BVH: assume the mesh roughly fits in a [-0.5,0.5] cube in object space
        // We'll create a big bounding box to ensure we don't exclude actual inside points.
        // Let's just say [-100,100] in world since we can't do partial solutions.
        // (In a real scenario, you'd precompute mesh bounds.)
        insideAABB = (p.x >= -100.0 && p.x <= 100.0 &&
                      p.y >= -100.0 && p.y <= 100.0 &&
                      p.z >= -100.0 && p.z <= 100.0);
    }

    if (!insideAABB) {
        return false;
    }

    // Count intersections
    let c = countMeshIntersections(geom, vertices, tris, bvhNodes, p);
    // Odd count means inside
    return (c % 2u == 1u);
}

fn projectOutsideMesh(pos: ptr<function, vec3<f32>>, geom: ptr<storage, Geom, read>, 
                      vertices: ptr<storage, Vertices, read>, tris: ptr<storage, Triangles, read>, bvhNodes: ptr<storage, BVHNodes, read>) {
    // We'll try a set of directions and find the closest intersection to push out along its normal.
    // Directions: up, down, x, -x, z, -z
    let directions = array<vec3<f32>,6>(
        vec3<f32>(0.0, 1.0, 0.0),
        vec3<f32>(0.0,-1.0, 0.0),
        vec3<f32>(1.0, 0.0, 0.0),
        vec3<f32>(-1.0,0.0, 0.0),
        vec3<f32>(0.0,0.0,1.0),
        vec3<f32>(0.0,0.0,-1.0)
    );

    var p = *pos;
    var bestDist = 1e38;
    var bestHit: HitInfo;
    var foundHit = false;

    for (var i=0; i<6; i++) {
        var r: Ray;
        r.origin = p;
        r.direction = directions[i];

        let hit = meshIntersectionTest(geom, vertices, tris, bvhNodes, r);
        if (hit.dist > 0.0 && hit.dist < bestDist) {
            bestDist = hit.dist;
            bestHit = hit;
            foundHit = true;
        }
    }

    if (foundHit) {
        // We have an intersection in some direction.
        // The normal should point outward, so we move the point just outside along this normal.
        // Move slightly beyond intersection point in normal direction.
        p = bestHit.intersectionPoint + bestHit.normal * 0.02;
    }

    *pos = p;
}

// Unified function to project a point outside a given geometry
fn projectOutsideGeom(pos: ptr<function, vec3<f32>>,
                      geom: ptr<storage, Geom, read>,
                      vertices: ptr<storage, Vertices, read>,
                      tris: ptr<storage, Triangles, read>,
                      bvhNodes: ptr<storage, BVHNodes, read>) {
    if (geom.geomType == 0) {
        // Cube
        projectOutsideCubeGeom(pos, geom);
    } else if (geom.geomType == 1) {
        // Sphere
        projectOutsideSphere(pos, geom);
    } else {
        // Mesh
        projectOutsideMesh(pos, geom, vertices, tris, bvhNodes);
    }
}

// Check if point is inside a geom
fn isPointInsideGeom(geom: ptr<storage, Geom, read>,
                     p: vec3<f32>,
                     vertices: ptr<storage, Vertices, read>,
                     tris: ptr<storage, Triangles, read>,
                     bvhNodes: ptr<storage, BVHNodes, read>) -> bool {
    if (geom.geomType == 0) {
        return isPointInsideCube(geom, p);
    } else if (geom.geomType == 1) {
        return isPointInsideSphere(geom, p);
    } else {
        return isPointInsideMesh(geom, vertices, tris, bvhNodes, p);
    }
}

struct CCDResult {
    newPosition: vec3<f32>,
    hitNormal: vec3<f32>,
    collided: bool,
};

fn continuousCollisionCheck(
    originalPos: vec3<f32>,
    proposedPos: vec3<f32>,
    vertices: ptr<storage, Vertices, read>,
    tris: ptr<storage, Triangles, read>,
    geoms: ptr<storage, Geoms, read>,
    bvhNodes: ptr<storage, BVHNodes, read>
) -> CCDResult {
    var result: CCDResult;
    result.newPosition = proposedPos;
    result.hitNormal = vec3<f32>(0.0);
    result.collided = false;

    var direction = proposedPos - originalPos;
    let dist = length(direction);
    if (dist < 1e-10) {
        // No significant movement
        return result;
    }

    direction = normalize(direction);

    var closestDist = dist;
    var closestHit: HitInfo;
    var collided = false;

    var r: Ray;
    r.origin = originalPos;
    r.direction = direction;

    for (var i = 0u; i < geoms.geomsSize; i++) {
        let hit = intersectGeom(&geoms.geoms[i], vertices, tris, bvhNodes, r);
        if (hit.dist > 0.0 && hit.dist < closestDist) {
            closestDist = hit.dist;
            closestHit = hit;
            collided = true;
        }
    }

    if (collided) {
        result.newPosition = closestHit.intersectionPoint + closestHit.normal * 0.001;
        result.hitNormal = closestHit.normal;
        result.collided = true;
    }

    return result;
}

@compute @workgroup_size(256)
fn simulateCloth(@builtin(global_invocation_id) GlobalInvocationID: vec3<u32>) {
    let idx: u32 = GlobalInvocationID.x;
    if (idx >= arrayLength(&vertices.vertices)) {
        return;
    }

    // Use smaller timeStep and run multiple times per frame
    let timeStep: f32 = 0.004;

    // Forces and damping
    let gravity = vec3<f32>(0.0, -40.81, 0.0);
    let damping = 0.99;

    var position = vertices.vertices[idx].position;
    var velocity = velocities[idx];

    // Apply gravity and damping
    velocity += gravity * timeStep;

    velocity += windDirection * windStrength * timeStep;

    velocity *= damping;

    

    let originalPos = position;
    var proposedPos = position + velocity * timeStep;

    // Continuous collision detection before constraints
    {
        let ccdResult = continuousCollisionCheck(originalPos, proposedPos, &sceneVertices, &tris, &geoms, &bvhNodes);
        if (ccdResult.collided) {
            // Adjust velocity so it doesn't push into geometry again
            let velDotN = dot(velocity, ccdResult.hitNormal);
            if (velDotN < 0.0) {
                velocity -= ccdResult.hitNormal * velDotN;
            }
            position = ccdResult.newPosition;
        } else {
            position = proposedPos;
        }
    }

    let gridWidth = uniforms.gridWidth;
    let x = idx % gridWidth;
    let y = idx / gridWidth;

    var constraintIterations: u32 = 15u;
    let restLength: f32 = 0.1;
    let diagRest = restLength * sqrt(2.0);

    // Constraint iterations
    for (var iter: u32 = 0; iter < constraintIterations; iter++) {
        var pos = position;

        // Horizontal neighbors
        if (x > 0u) {
            let leftIdx = idx - 1u;
            var leftPos = vertices.vertices[leftIdx].position;
            solveDistanceConstraint(&pos, &leftPos, restLength);
            vertices.vertices[leftIdx].position = leftPos;
        }

        if (x < gridWidth - 1u) {
            let rightIdx = idx + 1u;
            var rightPos = vertices.vertices[rightIdx].position;
            solveDistanceConstraint(&pos, &rightPos, restLength);
            vertices.vertices[rightIdx].position = rightPos;
        }

        // Vertical neighbors
        if (y > 0u) {
            let upIdx = idx - gridWidth;
            var upPos = vertices.vertices[upIdx].position;
            solveDistanceConstraint(&pos, &upPos, restLength);
            vertices.vertices[upIdx].position = upPos;
        }

        if (y < gridWidth - 1u) {
            let downIdx = idx + gridWidth;
            var downPos = vertices.vertices[downIdx].position;
            solveDistanceConstraint(&pos, &downPos, restLength);
            vertices.vertices[downIdx].position = downPos;
        }

        // Diagonal constraints
        if (x > 0u && y > 0u) {
            let diagULIdx = idx - gridWidth - 1u;
            var diagULPos = vertices.vertices[diagULIdx].position;
            solveDistanceConstraint(&pos, &diagULPos, diagRest);
            vertices.vertices[diagULIdx].position = diagULPos;
        }
        if (x < gridWidth - 1u && y > 0u) {
            let diagURIdx = idx - gridWidth + 1u;
            var diagURPos = vertices.vertices[diagURIdx].position;
            solveDistanceConstraint(&pos, &diagURPos, diagRest);
            vertices.vertices[diagURIdx].position = diagURPos;
        }
        if (x > 0u && y < gridWidth - 1u) {
            let diagDLIdx = idx + gridWidth - 1u;
            var diagDLPos = vertices.vertices[diagDLIdx].position;
            solveDistanceConstraint(&pos, &diagDLPos, diagRest);
            vertices.vertices[diagDLIdx].position = diagDLPos;
        }
        if (x < gridWidth - 1u && y < gridWidth - 1u) {
            let diagDRIdx = idx + gridWidth + 1u;
            var diagDRPos = vertices.vertices[diagDRIdx].position;
            solveDistanceConstraint(&pos, &diagDRPos, diagRest);
            vertices.vertices[diagDRIdx].position = diagDRPos;
        }

        // Check if inside any geom after constraints and push out
        for (var i = 0u; i < geoms.geomsSize - 1u; i++) {
            if (isPointInsideGeom(&geoms.geoms[i], pos, &sceneVertices, &tris, &bvhNodes)) {
                projectOutsideGeom(&pos, &geoms.geoms[i], &sceneVertices, &tris, &bvhNodes);
                // Zero velocity after pushing out
                velocity = vec3<f32>(0.0);
            }
        }

        position = pos;
    }

    // (Optional) Another CCD check if desired
    let ccdFinalCheck = continuousCollisionCheck(originalPos, position, &sceneVertices, &tris, &geoms, &bvhNodes);
    var finalVel = (position - originalPos) / timeStep;
    if (ccdFinalCheck.collided) {
        position = ccdFinalCheck.newPosition;
        finalVel = vec3<f32>(0.0);
    }

    previousPositions[idx] = vertices.vertices[idx].position;
    vertices.vertices[idx].position = position;
    velocities[idx] = finalVel;
}
