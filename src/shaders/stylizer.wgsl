fn shouldStylize(sc : StyleContext) -> u32 
{
    // sc.params.y = objectId, z = path prefix
    if (sc.params.y == 0.0f && sc.params.z > 2.9f && sc.params.z < 8.1f) {
        // hero model .y = 0
        // mirrors objectId = 3 ~ 8 
        return 1u;
    }
    return 0u;
}

// fn requiredSamples(sc : StyleContext) -> u32
// {
//     return 32u;
// }

// full implementation should have an array of samples (array<vec3f, 32u>)
// however, for demonstration we will only use perfect mirrors, meaning only 
// one path is ever valid, so we only need one vec3f
fn style(sc : StyleContext, samples : vec3f) -> vec3f
{
    if (shouldStylize(sc) == 0u) {
        return samples;
    }

    if (sc.params.z == 3.0f) {
        // greyscale
        return styleGreyscale(sc, samples);
    } else if (sc.params.z == 4.0f) {
        // ???
    }

    return vec3f(0.0);
}

fn styleGreyscale(sc : StyleContext, samples : vec3f) -> vec3f 
{
    // NTSC formula: 0.299 * Red + 0.587 * Green + 0.114 * Blue
    var combined = 0.299 * samples.x + 0.587 * samples.y + 0.114 * samples.z;
    return vec3f(combined, combined, combined);
}