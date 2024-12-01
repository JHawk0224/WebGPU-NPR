struct Uniforms {
    gridWidth: u32
}

@group(0) @binding(3) var<uniform> uniforms: Uniforms;

const gravity: vec3<f32> = vec3<f32>(0.0, -9.81, 0.0);
const timeStep: f32 = 0.016; // 60 FPS
const damping: f32 = 0.99;

const constraintIterations: u32 = 10;

const restLength: f32 = 0.1;
const stiffness: f32 = 10.0;


@group(0) @binding(0) var<storage, read_write> vertices: Vertices;
@group(0) @binding(1) var<storage, read_write> previousPositions: array<vec3<f32>>;
@group(0) @binding(2) var<storage, read_write> velocities: array<vec3<f32>>;


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



@compute @workgroup_size(256)
fn simulateCloth(@builtin(global_invocation_id) GlobalInvocationID: vec3<u32>) {
    let idx: u32 = GlobalInvocationID.x;
    if (idx >= arrayLength(&vertices.vertices)) {
        return;
    }

    // Initial position update with velocity and external forces
    var position = vertices.vertices[idx].position;
    var velocity = velocities[idx];
    
    // Apply external forces
    velocity += gravity * timeStep;
    velocity *= damping;
    
    // Update position
    var predictedPos = position + velocity * timeStep;
    
    // Store original position for velocity update
    let originalPos = position;
    position = predictedPos;

    // Multiple iterations of constraint solving
    for (var iter: u32 = 0u; iter < constraintIterations; iter++) {
        let x = idx % uniforms.gridWidth;
        let y = idx / uniforms.gridWidth;
        
        var pos = position;
        
        // Calculate rest lengths based on grid spacing
        let restLength = length(vertices.vertices[1].position - vertices.vertices[0].position);

        // Horizontal constraints
        if (x > 0u) {
            let leftIdx = idx - 1u;
            var leftPos = vertices.vertices[leftIdx].position;
            solveDistanceConstraint(&pos, &leftPos, restLength);
            if (leftIdx >= uniforms.gridWidth) { // Don't update pinned vertices
                vertices.vertices[leftIdx].position = leftPos;
            }
        }
        
        if (x < uniforms.gridWidth - 1u) {
            let rightIdx = idx + 1u;
            var rightPos = vertices.vertices[rightIdx].position;
            solveDistanceConstraint(&pos, &rightPos, restLength);
            if (rightIdx >= uniforms.gridWidth) {
                vertices.vertices[rightIdx].position = rightPos;
            }
        }

        // Vertical constraints
        if (y > 0u) {
            let upIdx = idx - uniforms.gridWidth;
            var upPos = vertices.vertices[upIdx].position;
            solveDistanceConstraint(&pos, &upPos, restLength);
            if (upIdx >= uniforms.gridWidth) {
                vertices.vertices[upIdx].position = upPos;
            }
        }
        
        if (y < uniforms.gridWidth - 1u) {
            let downIdx = idx + uniforms.gridWidth;
            var downPos = vertices.vertices[downIdx].position;
            solveDistanceConstraint(&pos, &downPos, restLength);
            if (downIdx >= uniforms.gridWidth) {
                vertices.vertices[downIdx].position = downPos;
            }
        }

        position = pos;
    }

    // Pin constraints for top row
    if (idx < uniforms.gridWidth) {
        position = vertices.vertices[idx].position;
        velocity = vec3<f32>(0.0);
    }

    // Update velocity based on position change
    velocity = (position - originalPos) / timeStep;

    // Calculate normal
    let x = idx % uniforms.gridWidth;
    let y = idx / uniforms.gridWidth;
    var normal = vec3<f32>(0.0, 0.0, 0.0);
    var normalCount = 0u;

    // Contribute to normal from surrounding triangles
    if (x > 0u && y > 0u) {
        let p0 = position;
        let p1 = vertices.vertices[idx - 1u].position;
        let p2 = vertices.vertices[idx - uniforms.gridWidth].position;
        normal += calculateNormal(p0, p1, p2);
        normalCount += 1u;
    }

    if (x < uniforms.gridWidth - 1u && y > 0u) {
        let p0 = position;
        let p1 = vertices.vertices[idx - uniforms.gridWidth].position;
        let p2 = vertices.vertices[idx + 1u].position;
        normal += calculateNormal(p0, p1, p2);
        normalCount += 1u;
    }

    if (x > 0u && y < uniforms.gridWidth - 1u) {
        let p0 = position;
        let p1 = vertices.vertices[idx + uniforms.gridWidth].position;
        let p2 = vertices.vertices[idx - 1u].position;
        normal += calculateNormal(p0, p1, p2);
        normalCount += 1u;
    }

    if (x < uniforms.gridWidth - 1u && y < uniforms.gridWidth - 1u) {
        let p0 = position;
        let p1 = vertices.vertices[idx + 1u].position;
        let p2 = vertices.vertices[idx + uniforms.gridWidth].position;
        normal += calculateNormal(p0, p1, p2);
        normalCount += 1u;
    }

    if (normalCount > 0u) {
        normal = normalize(normal / f32(normalCount));
    } else {
        normal = vec3<f32>(0.0, 1.0, 0.0);
    }

    // Store final results
    previousPositions[idx] = vertices.vertices[idx].position;
    vertices.vertices[idx].position = position;
    vertices.vertices[idx].normal = normal;
    velocities[idx] = velocity;
}