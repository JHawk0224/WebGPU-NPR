fn shouldStylize(sc : StyleContext) -> u32 
{
    // sc.params.y = objectId, z = path prefix
    // hero model .y = -1
    if (sc.params.y != 0) {
        return 0u;
    }

    if (sc.params.z < 0) {
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
    // params : vec4<i32>, // materialId, objectId, path prefix
    // position : vec3<f32>,
    // normal : vec3<f32>,

    if (shouldStylize(sc) == 0u) {
        // Identity style
        return samples;
    }

    // sc.params.z = path prefix
    // sc.params.z == -1 : basic mirror
    if (sc.params.z == -2) {
        return stylizeGreyscale(sc, samples);
    } else if (sc.params.z == -3) {
        return stylizeStripes(sc, samples);
    } else if (sc.params.z == -5) {
        return stylizeToon(sc, samples);
    }

    // undefined, apply identity stylization
    return samples;
}

fn stylizeGreyscale(sc : StyleContext, samples : vec3f) -> vec3f 
{
    // NTSC formula: 0.299 * Red + 0.587 * Green + 0.114 * Blue
    let combined = 0.299 * samples.x + 0.587 * samples.y + 0.114 * samples.z;
    return vec3f(combined, combined, combined);
}

fn stylizeStripes(sc : StyleContext, samples : vec3f) -> vec3f 
{
    // NTSC formula: 0.299 * Red + 0.587 * Green + 0.114 * Blue
    let combined = 0.299 * samples.x + 0.587 * samples.y + 0.114 * samples.z;
    let purpleShade = vec3f(0.81, 0.33, 0.88);
    let yellowShade = vec3f(0.96, 0.945, 0.07);
    var stripePat = 0.0;
    if ((sc.position.y > 0 && sc.position.y - f32(i32(sc.position.y)) < 0.5) ||
        (sc.position.y < 0 && f32(i32(sc.position.y)) - sc.position.y > 0.5)) {
        stripePat = 1.0;
    }
    let patternShade = purpleShade * stripePat + yellowShade * (1 - stripePat);
    return patternShade;
}

fn stylizeToon(sc : StyleContext, samples : vec3f) -> vec3f 
{
    // NTSC formula: 0.299 * Red + 0.587 * Green + 0.114 * Blue
    let combined = 0.299 * samples.x + 0.587 * samples.y + 0.114 * samples.z;
    // let toonRamp1 = vec3f(0.17, 0.06, 0.37);
    let toonRamp = vec3f(0.55, 0.48, 0.67);

    // skull is super dark so extreme smoothstep is used but for normal meshes use something like the following
    // let intensity = smoothstep(0.48, 0.52, combined);
    let intensity = smoothstep(0.05, 0.10, combined);
    return toonRamp * intensity;
}