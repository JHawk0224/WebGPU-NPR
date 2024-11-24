// Emissive
fn scatterEmissive(index: u32, intersect: vec3f, dirIn: vec3f, normal: vec3f) -> PathSegment
{
    var pathSegment : PathSegment;
    return pathSegment;
}

fn evalEmissive(dirIn: vec3f, dirOut: vec3f, normal: vec3f, mColor: vec3f, mEmittance: f32) -> vec3f
{
    return mColor * mEmittance;
}

fn pdfEmissive(dirIn: vec3f, dirOut: vec3f, normal: vec3f) -> f32
{
    return 1.0;
}

// Lambertian
fn scatterLambertian(index: u32, intersect: vec3f, dirIn: vec3f, normal: vec3f) -> PathSegment
{
    var pathSegment : PathSegment;

    pathSegment.ray.origin = intersect + normal * EPSILON;
    pathSegment.ray.direction = normalize(randomDirectionInHemisphere(normal));

    return pathSegment;
}

fn evalLambertian(dirIn: vec3f, dirOut: vec3f, normal: vec3f, mColor: vec3f) -> vec3f
{
    return mColor * max(0.0, dot(normalize(dirOut), normalize(normal)) / PI);
}

fn pdfLambertian(dirIn: vec3f, dirOut: vec3f, normal: vec3f) -> f32
{
    return max(0.0, dot(dirOut, normal) / PI);
}

// Metal
fn scatterMetal(index: u32, intersect: vec3f, dirIn: vec3f, normal: vec3f, mRoughness: f32) -> PathSegment
{
    var pathSegment : PathSegment;

    pathSegment.ray.origin = intersect + normal * EPSILON;

    // Imperfect specular lighting based on
    // https://raytracing.github.io/books/RayTracingInOneWeekend.html#metal/fuzzyreflection
    // i.e. we importance sample a point on a unit sphere 
    // (uniformly w.r.t. surface area), scale it by roughness, 
    // and tweak ray direction by this offset
    var reflected = reflect(normalize(dirIn), normal);
    reflected += randomOnUnitSphere() * mRoughness;
    reflected = normalize(reflected);

    pathSegment.ray.direction = reflected;
    
    if (dot(reflected, normal) <= 0) {
        pathSegment.pixelIndex = -1;
    }
    return pathSegment;
}

fn evalMetal(dirIn: vec3f, dirOut: vec3f, normal: vec3f, mColor: vec3f) -> vec3f
{
    return mColor;
}

fn pdfMetal(dirIn: vec3f, dirOut: vec3f, normal: vec3f) -> f32
{
    return 0.0;
}