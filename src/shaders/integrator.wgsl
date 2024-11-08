fn scatterLambertian(index: u32, intersect: vec3f, normal: vec3f) -> PathSegment
{
    var pathSegment : PathSegment;

    pathSegment.ray.origin = intersect + normal * EPSILON;
    pathSegment.ray.direction = randomDirectionInHemisphere(normal);

    return pathSegment;
}

fn evalLambertian(dirIn: vec3f, dirOut: vec3f, normal: vec3f, mColor: vec3f) -> vec3f
{
    return mColor * max(0.0, dot(dirOut, normal) / PI);
}

fn pdfLambertian(dirIn: vec3f, dirOut: vec3f, normal: vec3f) -> f32
{
    return max(0.0, dot(dirOut, normal) / PI);
}