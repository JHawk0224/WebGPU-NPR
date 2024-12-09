struct Uniforms {
    gridWidth: u32
}

@group(0) @binding(3) var<uniform> uniforms: Uniforms;

const gravity: vec3<f32> = vec3<f32>(0.0, -9.81, 0.0);
const timeStep: f32 = 0.016;  // ~60 FPS
const damping: f32 = 0.99;

var<private> constraintIterations: u32 = 15u;
const restLength: f32 = 0.025;
const stiffness: f32 = 0.8;

@group(0) @binding(0) var<storage, read_write> vertices: Vertices;
@group(0) @binding(1) var<storage, read_write> previousPositions: array<vec3<f32>>;
@group(0) @binding(2) var<storage, read_write> velocities: array<vec3<f32>>;

@group(1) @binding(0) var<storage, read> sceneVertices : Vertices;
@group(1) @binding(1) var<storage, read> tris : Triangles;
@group(1) @binding(2) var<storage, read> geoms : Geoms;
@group(1) @binding(3) var<storage, read> bvhNodes : BVHNodes;


// Solve distance constraints
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

// Projects a point outside the cube if it's inside
fn projectOutsideCube(pos: ptr<function, vec3<f32>>, cubeMin: vec3<f32>, cubeMax: vec3<f32>) {
    var p = *pos;
    let insideX = (p.x > cubeMin.x && p.x < cubeMax.x);
    let insideY = (p.y > cubeMin.y && p.y < cubeMax.y);
    let insideZ = (p.z > cubeMin.z && p.z < cubeMax.z);

    if (insideX && insideY && insideZ) {
        // Find which face is closest
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

    let cubeMin = vec3<f32>(-0.7, -0.7, -0.7);
    let cubeMax = vec3<f32>(0.7, 0.7, 0.7);

    // Initial position and velocity
    var position = vertices.vertices[idx].position;
    var velocity = velocities[idx];

    // Apply gravity & damping
    velocity += gravity * timeStep;
    velocity *= damping;

    // Predict position
    var predictedPos = position + velocity * timeStep;

    var originalPos = position;
    position = predictedPos;

    let gridWidth = uniforms.gridWidth;
    let x = idx % gridWidth;
    let y = idx / gridWidth;

    // Constraint iterations + cube projection
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
        let diagRest = restLength * sqrt(2.0);
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

        // Enforce cube position constraint during iteration
        if (foundCube) {
            projectOutsideCube(&pos, cubeMin, cubeMax);
        }

        position = pos;
    }

    // Pin top row
    if (idx < gridWidth) {
        //position = vertices.vertices[idx].position;
    }

    // FINAL HARD CORRECTION:
    // After all constraints, if we somehow ended inside the cube, 
    // we force the cloth out at the top face and zero out vertical velocity.
    // because for annoying reasons if i do anything else the cloth will sink into the cube...
    if (foundCube) {
        var p = position;
        let insideX = (p.x > cubeMin.x && p.x < cubeMax.x);
        let insideY = (p.y > cubeMin.y && p.y < cubeMax.y);
        let insideZ = (p.z > cubeMin.z && p.z < cubeMax.z);

        if (insideX && insideY && insideZ) {
            // Force it out the top face
            position.y = cubeMax.y + 1.0;
            // Zero out vertical velocity since we forced it out
            velocity.y = 0.0;
        }
    }

    var finalVel = (position - originalPos) / timeStep;

    // If at cube boundary, reflect horizontal and lateral velocities if pushing into cube
    if (foundCube) {
        var p = position;
        if (p.x <= cubeMin.x && finalVel.x < 0.0) {
            finalVel.x *= -0.5;
        }
        if (p.x >= cubeMax.x && finalVel.x > 0.0) {
            finalVel.x *= -0.5;
        }
        if (p.y <= cubeMin.y && finalVel.y < 0.0) {
            finalVel.y *= -0.5;
        }
        if (p.y >= cubeMax.y && finalVel.y > 0.0) {
            finalVel.y *= -0.5;
        }
        if (p.z <= cubeMin.z && finalVel.z < 0.0) {
            finalVel.z *= -0.5;
        }
        if (p.z >= cubeMax.z && finalVel.z > 0.0) {
            finalVel.z *= -0.5;
        }
    }

    // Update buffers
    previousPositions[idx] = vertices.vertices[idx].position;
    vertices.vertices[idx].position = position;
    velocities[idx] = finalVel;
}
