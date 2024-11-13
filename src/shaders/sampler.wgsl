fn randomDirectionInHemisphere(normal_: vec3f) -> vec3f
{
    let normal = normalize(normal_);
    let up = sqrt(rand()); // cos(theta)
    let over = sqrt(1.0 - up * up); // sin(theta)
    let around = rand() * TWO_PI;

    // Find a direction that is not the normal based off of whether or not the
    // normal's components are all equal to sqrt(1/3) or whether or not at
    // least one component is less than sqrt(1/3). Learned this trick from
    // Peter Kutz.

    var directionNotNormal: vec3f;
    if (abs(normal.x) < SQRT_OF_ONE_THIRD)
    {
        directionNotNormal = vec3f(1, 0, 0);
    }
    else if (abs(normal.y) < SQRT_OF_ONE_THIRD)
    {
        directionNotNormal = vec3f(0, 1, 0);
    }
    else
    {
        directionNotNormal = vec3f(0, 0, 1);
    }

    // Use not-normal direction to generate two perpendicular directions
    let perpendicularDirection1 = normalize(cross(normal, directionNotNormal));
    let perpendicularDirection2 = normalize(cross(normal, perpendicularDirection1));

    return up * normal + cos(around) * over * perpendicularDirection1 + sin(around) * over * perpendicularDirection2;
}

fn randomOnUnitSphere() -> vec3f
{
    let phi = rand() * (2 * PI);
    let cosTheta = 2 * rand() - 1;
    let sinTheta = sqrt(1 - cosTheta * cosTheta);

    return vec3f(cos(phi) * sinTheta, sin(phi) * sinTheta, cosTheta);
}

fn randomOnUnitCircle() -> vec2f
{
    // Rejection sampling for a unit circle of radius 1
    let middle = vec2f(1.0);
    var xi1 = rand() * 2.0;
    var xi2 = rand() * 2.0;
    var p = vec2f(xi1, xi2) - middle;
    while (length(p) >= 1.0) {
        xi1 = rand() * 2.0;
        xi2 = rand() * 2.0;
        p = vec2f(xi1, xi2) - middle;
    } 

    return p;
}