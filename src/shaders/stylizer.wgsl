fn shouldStylize(sc : StyleContext) -> u32 
{
    // sc.params.y = objectId, z = path prefix, w = styleType
    if ((sc.params.w == 1u && sc.params.y == 1u) || sc.params.w == 2u) {
        // hero model .y = 1
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
fn stylize (sc : StyleContext, samples : vec3f) -> vec3f
{
    if (shouldStylize(sc) == 0u) {
        // Identity style
        return samples;
    }

    if (sc.params.w == 1u) {
        // greyscale target models
        return stylizeGreyscale(sc, samples);
    } else if (sc.params.w == 2u) {
        // greyscale whole scene
        return stylizeGreyscale(sc, samples);
    }

    // undefined, apply identity stylization
    return samples;
}

fn stylizeGreyscale(sc : StyleContext, samples : vec3f) -> vec3f 
{
    // NTSC formula: 0.299 * Red + 0.587 * Green + 0.114 * Blue
    var combined = 0.299 * samples.x + 0.587 * samples.y + 0.114 * samples.z;
    return vec3f(combined, combined, combined);
}