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