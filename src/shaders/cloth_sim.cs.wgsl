struct Uniforms {
    gridWidth: u32
}

@group(0) @binding(3) var<uniform> uniforms: Uniforms;

const gravity: vec3<f32> = vec3<f32>(0.0, -9.81, 0.0);
const timeStep: f32 = 0.016; // 60 FPS
const damping: f32 = 0.99;

const constraintIterations: u32 = 9;

const restLength: f32 = 0.1;
const stiffness: f32 = 10.0;


@group(0) @binding(0) var<storage, read_write> vertices: Vertices;
@group(0) @binding(1) var<storage, read_write> previousPositions: array<vec3<f32>>;
@group(0) @binding(2) var<storage, read_write> velocities: array<vec3<f32>>;


@group(1) @binding(0) var<storage, read> sceneVertices : Vertices;
@group(1) @binding(1) var<storage, read> tris : Triangles;
@group(1) @binding(2) var<storage, read> geoms : Geoms;
@group(1) @binding(3) var<storage, read> bvhNodes : BVHNodes;





// Solves a distance constraint between two points
fn solveDistanceConstraint(p1: ptr<function, vec3<f32>>, p2: ptr<function, vec3<f32>>, restLength: f32) {
    let delta = *p2 - *p1;
    let deltaLength = length(delta);

    if (deltaLength > 0.0001) { // Avoid division by zero
        let correction = delta * (1.0 - restLength / deltaLength);
        *p1 += correction * 0.5;
        *p2 -= correction * 0.5;
    }
}


fn calculateNormal(p0: vec3<f32>, p1: vec3<f32>, p2: vec3<f32>) -> vec3<f32> {
    let edge1 = p1 - p0;
    let edge2 = p2 - p0;
    return normalize(cross(edge1, edge2));
}



// Main simulation function
@compute @workgroup_size(256)
fn simulateCloth(@builtin(global_invocation_id) GlobalInvocationID: vec3<u32>) {
    let idx: u32 = GlobalInvocationID.x;
    if (idx >= arrayLength(&vertices.vertices)) {
        return;
    }

    // Locate the cube
    var cube: Geom;
    var foundCube = false;

    for (var i = 0u; i < geoms.geomsSize; i++) {
        if (geoms.geoms[i].objectId == -1 && geoms.geoms[i].bvhRootNodeIdx == -1) {
            cube = geoms.geoms[i];
            foundCube = true;
            break;
        }
    }

    // Initialize position and velocity
    var position = vertices.vertices[idx].position;
    var velocity = velocities[idx];

    // Apply gravity and damping
    velocity += gravity * timeStep;
    velocity *= damping;

    // Predict position
    var predictedPos = position + velocity * timeStep;

    // Check and resolve collisions
    if (foundCube) {
        resolveCubeCollision(&predictedPos, &velocity, cube);
    }

    // Update position and apply constraints
    var originalPos = position;
    position = predictedPos;

    for (var iter: u32 = 0u; iter < constraintIterations; iter++) {
        let x = idx % uniforms.gridWidth;
        let y = idx / uniforms.gridWidth;

        var pos = position;

        // Apply horizontal constraints
        if (x > 0u) {
            let leftIdx = idx - 1u;
            var leftPos = vertices.vertices[leftIdx].position;
            solveDistanceConstraint(&pos, &leftPos, restLength);
        }

        if (x < uniforms.gridWidth - 1u) {
            let rightIdx = idx + 1u;
            var rightPos = vertices.vertices[rightIdx].position;
            solveDistanceConstraint(&pos, &rightPos, restLength);
        }

        // Apply vertical constraints
        if (y > 0u) {
            let upIdx = idx - uniforms.gridWidth;
            var upPos = vertices.vertices[upIdx].position;
            solveDistanceConstraint(&pos, &upPos, restLength);
        }

        if (y < uniforms.gridWidth - 1u) {
            let downIdx = idx + uniforms.gridWidth;
            var downPos = vertices.vertices[downIdx].position;
            solveDistanceConstraint(&pos, &downPos, restLength);
        }

        position = pos;
    }

    // Enforce self-collision
    enforceSelfCollision(idx, &position);

    // Pin the top row of vertices
    if (idx < uniforms.gridWidth) {
        position = vertices.vertices[idx].position;
        velocity = vec3<f32>(0.0);
    }

    // Update velocity based on position change
    velocity = (position - originalPos) / timeStep;

    // Update buffers
    previousPositions[idx] = vertices.vertices[idx].position;
    vertices.vertices[idx].position = position;
    velocities[idx] = velocity;
}

// Resolves collisions with the cube
fn resolveCubeCollision(position: ptr<function, vec3<f32>>, velocity: ptr<function, vec3<f32>>, cube: Geom) {
    // Cube bounds assuming identity transform (unit cube centered at origin)
    let cubeMin = vec3<f32>(-0.5, -0.5, -0.5);
    let cubeMax = vec3<f32>(0.5, 0.5, 0.5);

    var pos = *position;

    // Check and resolve collisions
    if (pos.x < cubeMin.x) {
        pos.x = cubeMin.x - 0.05; // Prevent sticking to the wall
        (*velocity).x *= -0.5; // Reverse and dampen velocity
    } else if (pos.x > cubeMax.x) {
        pos.x = cubeMax.x + 0.05; // Prevent sticking to the wall
        (*velocity).x *= -0.5;
    }

    if (pos.y < cubeMin.y) {
        pos.y = cubeMin.y - 0.05;
        (*velocity).y *= -0.5;
    } else if (pos.y > cubeMax.y) {
        pos.y = cubeMax.y + 0.05;
        (*velocity).y *= -0.5 ;
    }

    if (pos.z < cubeMin.z) {
        pos.z = cubeMin.z - 0.05;
        (*velocity).z *= -0.5;
    } else if (pos.z > cubeMax.z) {
        pos.z = cubeMax.z + 0.05;
        (*velocity).z *= -0.5;
    }

    *position = pos;
}

fn enforceSelfCollision(vertexIdx: u32, position: ptr<function, vec3<f32>>) {
    for (var neighborOffset = -2; neighborOffset <= 2; neighborOffset++) {
        if (neighborOffset == 0){
            continue;
        }

        let neighborIdx = i32(vertexIdx) + neighborOffset;
        if (neighborIdx < 0 || u32(neighborIdx) >= arrayLength(&vertices.vertices)) {
            continue;
        }

        let neighborPos = vertices.vertices[u32(neighborIdx)].position;
        let delta = *position - neighborPos;
        let dist = length(delta);

        if (dist < restLength) {
            let correction = (restLength - dist) * normalize(delta);
            *position += correction * 0.5;
        }
    }
}
