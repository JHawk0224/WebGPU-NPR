fn randomDirectionInHemisphere(normal: vec3f) -> vec3f
{
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