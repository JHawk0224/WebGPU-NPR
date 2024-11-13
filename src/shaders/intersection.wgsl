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

fn boxIntersectionTest(box: ptr<storage, Geom, read>, r: Ray) -> HitInfo
{
    var ret : HitInfo;
    ret.hitTriIndex = -1;

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

fn sphereIntersectionTest(sphere: ptr<storage, Geom, read>, r: Ray) -> HitInfo {
    var ret : HitInfo;
    ret.hitTriIndex = -1;

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

fn triangleIntersectionTest(tri: Triangle, r: Ray) -> HitInfo {
    var ret: HitInfo;
    ret.hitTriIndex = -1;
    let EPSILON = 1e-4;

    let edge1 = tri.v1.xyz - tri.v0.xyz;
    let edge2 = tri.v2.xyz - tri.v0.xyz;
    let h = cross(r.direction, edge2);
    let a = dot(edge1, h);

    if (abs(a) < EPSILON) {
        ret.dist = -1.0;
        return ret;
    }

    let f = 1.0 / a;
    let s = r.origin - tri.v0.xyz;
    let u = f * dot(s, h);
    if (u < 0.0 || u > 1.0) {
        ret.dist = -1.0;
        return ret;
    }

    let q = cross(s, edge1);
    let v = f * dot(r.direction, q);
    if (v < 0.0 || u + v > 1.0) {
        ret.dist = -1.0;
        return ret;
    }

    let t = f * dot(edge2, q);
    if (t > EPSILON) {
        ret.intersectionPoint = getPointOnRay(r, t);
        ret.normal = normalize(cross(edge1, edge2));
        ret.outside = select(0u, 1u, dot(r.direction, ret.normal) < 0.0);
        if (ret.outside == 0) {
            ret.normal = -ret.normal;
        }
        ret.dist = t;
        return ret;
    }

    ret.dist = -1.0;
    return ret;
}

fn rayIntersectsAABB(ray: Ray, boundsMin: vec3f, boundsMax: vec3f) -> bool {
    var tmin = (boundsMin - ray.origin) / ray.direction;
    var tmax = (boundsMax - ray.origin) / ray.direction;
    var t1 = min(tmin, tmax);
    var t2 = max(tmin, tmax);
    var tNear = max(max(t1.x, t1.y), t1.z);
    var tFar = min(min(t2.x, t2.y), t2.z);
    return tNear <= tFar && tFar >= 0.0;
}

fn meshIntersectionTest(mesh: ptr<storage, Geom, read>, tris: ptr<storage, Triangles, read>, bvhNodes: ptr<storage, BVHNodes, read>, r: Ray) -> HitInfo {
    var ret: HitInfo;
    ret.dist = -1.0;
    ret.hitTriIndex = -1;

    let ro = (mesh.inverseTransform * vec4f(r.origin, 1.0)).xyz;
    let rd = normalize((mesh.inverseTransform * vec4f(r.direction, 0.0)).xyz);

    var objRay: Ray;
    objRay.origin = ro;
    objRay.direction = rd;

    var t_min = 1e38;

    if (mesh.bvhRootNodeIdx == -1) {
        // BVH disabled, use normal triangle intersection
        if (mesh.triangleStartIdx >= 0) {
            for (var i = 0u; i < mesh.triangleCount; i = i + 1u) {
                let tri = tris.tris[u32(mesh.triangleStartIdx) + i];
                let hitInfo = triangleIntersectionTest(tri, objRay);
                if (hitInfo.dist > 0.0 && hitInfo.dist < t_min) {
                    t_min = hitInfo.dist;
                    ret.intersectionPoint = hitInfo.intersectionPoint;
                    ret.normal = hitInfo.normal;
                    ret.outside = hitInfo.outside;
                    ret.dist = hitInfo.dist;
                    ret.hitTriIndex = mesh.triangleStartIdx + i32(i);
                }
            }
        }
    } else {
        // BVH enabled
        var stack: array<u32, 32>;
        var stackPtr: i32 = 0;
        stack[0] = u32(mesh.bvhRootNodeIdx);
        stackPtr = 1;

        while (stackPtr > 0) {
            stackPtr -= 1;
            let nodeIdx = stack[stackPtr];
            let node = bvhNodes.nodes[nodeIdx];

            if (node.triangleCount <= 0) {
                continue;
            }

            let triangleStart = u32(node.triangleStart);

            if (rayIntersectsAABB(objRay, node.boundsMin.xyz, node.boundsMax.xyz)) {
                if (node.leftChild == -1 && node.rightChild == -1) {
                    // Leaf node
                    for (var i = triangleStart; i < triangleStart + node.triangleCount; i = i + 1u) {
                        let tri = tris.tris[i];
                        let hitInfo = triangleIntersectionTest(tri, objRay);
                        if (hitInfo.dist > 0.0 && hitInfo.dist < t_min) {
                            t_min = hitInfo.dist;
                            ret.intersectionPoint = hitInfo.intersectionPoint;
                            ret.normal = hitInfo.normal;
                            ret.outside = hitInfo.outside;
                            ret.dist = hitInfo.dist;
                            ret.hitTriIndex = i32(i);
                        }
                    }
                } else {
                    // Internal node
                    if (node.leftChild != -1) {
                        stack[stackPtr] = u32(node.leftChild);
                        stackPtr += 1;
                    }
                    if (node.rightChild != -1) {
                        stack[stackPtr] = u32(node.rightChild);
                        stackPtr += 1;
                    }
                }
            }
        }
    }

    if (ret.dist > 0.0) {
        ret.intersectionPoint = (mesh.transform * vec4f(ret.intersectionPoint, 1.0)).xyz;
        ret.normal = normalize((mesh.invTranspose * vec4f(ret.normal, 0.0)).xyz);
        if (ret.outside == 0u) {
            ret.normal = -ret.normal;
        }
        ret.dist = length(r.origin - ret.intersectionPoint);
    } else {
        ret.dist = -1.0;
        ret.hitTriIndex = -1;
    }
    return ret;
}
