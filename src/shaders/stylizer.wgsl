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
    // rayDir : vec3<f32>,

    if (shouldStylize(sc) == 0u) {
        // Identity style
        return samples;
    }

    // sc.params.z = path prefix
    // sc.params.z == -4 : basic mirror
    if (sc.params.z == -1) {
        return stylizeGreyscale(sc, samples);
    } else if (sc.params.z == -2) {
        return stylizeContour(sc, samples);
    } else if (sc.params.z == -3) {
        return stylizeStripes(sc, samples);
    } else if (sc.params.z == -5) {
        return stylizeCrossStripes(sc, samples);
    } else if (sc.params.z == -6) {
        return stylizeBvh(sc, samples);
        // return stylizeToon(sc, samples);
    } else if (sc.params.z == -7) {
        return stylizePerlin(sc, samples);
    } else if (sc.params.z == -8) {
        return stylizeBvh(sc, samples);
    }

    // undefined, apply identity stylization
    return samples;
}

fn luminance(samples : vec3f) -> f32
{
    // NTSC formula: 0.299 * Red + 0.587 * Green + 0.114 * Blue
    return 0.299 * samples.x + 0.587 * samples.y + 0.114 * samples.z;
}

fn stylizeContour(sc : StyleContext, samples : vec3f) -> vec3f 
{
    let ndotv = dot(sc.normal, sc.rayDir);

    if (abs(ndotv) < 0.3) {
        return vec3f(0.0);
    }

    return vec3f(1.0f);
}

fn stylizeGreyscale(sc : StyleContext, samples : vec3f) -> vec3f 
{
    let lum = luminance(samples);
    return vec3f(lum, lum, lum);
}

fn stylizeStripes(sc : StyleContext, samples : vec3f) -> vec3f 
{
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

fn stylizeCrossStripes(sc : StyleContext, samples : vec3f) -> vec3f 
{
    // Based on https://machinesdontcare.wordpress.com/2011/02/02/glsl-crosshatch/
    let lum = luminance(samples);
    
    let frequency = 1.0;
    var color = vec3f(1.0, 1.0, 1.0);
     
    if (lum < 1.00) {
        if (abs((sc.position.x + sc.position.y) % frequency) <= 0.05) {
            color = vec3f(0.0, 0.0, 0.0);
        }
    }
     
    if (lum < 0.75) {
        if (abs((sc.position.x - sc.position.y) % frequency) <= 0.05) {
            color = vec3f(0.0, 0.0, 0.0);
        }
    }
     
    if (lum < 0.50) {
        if (abs((sc.position.x + sc.position.y - 5.0) % frequency) <= 0.05) {
            color = vec3f(0.0, 0.0, 0.0);
        }
    }
     
    if (lum < 0.3) {
        if (abs((sc.position.x - sc.position.y - 5.0) % frequency) <= 0.05) {
            color = vec3f(0.0, 0.0, 0.0);
        }
    }

    return color;
}

fn stylizeToon(sc : StyleContext, samples : vec3f) -> vec3f 
{
    let lum = luminance(samples);
    // let toonRamp1 = vec3f(0.17, 0.06, 0.37);
    let toonRamp = vec3f(0.55, 0.48, 0.67);

    // skull is super dark so extreme smoothstep is used but for normal meshes use something like the following
    // let intensity = smoothstep(0.48, 0.52, lum);
    let intensity = smoothstep(0.05, 0.10, lum);
    return toonRamp * intensity;
}

fn inRadiusFreq(x : f32, y : f32, freq : f32, rad : f32, freqScale : f32, radScale : f32) -> bool
{
    let frequency = freq * freqScale;
    let radius = rad * radScale;

    var xmodf = x % frequency;
    var ymodf = y % frequency;

    if (xmodf > 0.5 * frequency) {
        xmodf -= frequency;
    } else if (xmodf < -0.5 * frequency) {
        xmodf += frequency;
    }

    if (ymodf > 0.5 * frequency) {
        ymodf -= frequency;
    } else if (ymodf < -0.5 * frequency) {
        ymodf += frequency;
    }

    return xmodf * xmodf + ymodf * ymodf < radius * radius;
}

// Perlin noise code from https://www.shadertoy.com/view/DsK3W1
fn n22 (p : vec2f) -> vec2f
{
    var a = fract(p.xyx * vec3(123.34, 234.34, 345.65));
    a += dot(a, a + 34.45);
    return fract(vec2(a.x * a.y, a.y * a.z));
}

fn get_gradient(pos : vec2f) -> vec2f
{
    let twoPi = 6.283185;
    let angle = n22(pos).x * twoPi;
    return vec2f(cos(angle), sin(angle));
}

fn perlin_noise(uv : vec2f, cells_count : f32) -> f32
{
    let pos_in_grid = uv * cells_count;
    let cell_pos_in_grid =  floor(pos_in_grid);
    let local_pos_in_cell = (pos_in_grid - cell_pos_in_grid);
    let blend = local_pos_in_cell * local_pos_in_cell * (3.0f - 2.0f * local_pos_in_cell);
    
    let left_top = cell_pos_in_grid + vec2(0, 1);
    let right_top = cell_pos_in_grid + vec2(1, 1);
    let left_bottom = cell_pos_in_grid + vec2(0, 0);
    let right_bottom = cell_pos_in_grid + vec2(1, 0);
    
    let left_top_dot = dot(pos_in_grid - left_top, get_gradient(left_top));
    let right_top_dot = dot(pos_in_grid - right_top,  get_gradient(right_top));
    let left_bottom_dot = dot(pos_in_grid - left_bottom, get_gradient(left_bottom));
    let right_bottom_dot = dot(pos_in_grid - right_bottom, get_gradient(right_bottom));
    
    let noise_value = mix(
                            mix(left_bottom_dot, right_bottom_dot, blend.x), 
                            mix(left_top_dot, right_top_dot, blend.x), 
                            blend.y);
   
    
    return (0.5 + 0.5 * (noise_value / 0.7));
}

fn stylizePerlin(sc : StyleContext, samples : vec3f) -> vec3f 
{
    let lum = luminance(samples);

    let noise_scale = 2.0f;

    let uv = vec2f(sc.position.xy) / noise_scale;

    let noise = perlin_noise(uv, 10.0f);
    
    if (noise < 0.5) {
        return vec3f(1.0, 1.0, 0.0);
    }

    return vec3f(0.0, 0.3, 1.0);
}

fn stylizeBvh(sc : StyleContext, samples : vec3f) -> vec3f 
{
    return vec3f(f32(pcg_hash(u32(sc.bvhNodeIndex) % 7u)) / f32(0xffffffffu), f32(pcg_hash(u32(sc.bvhNodeIndex) % 5u)) / f32(0xffffffffu), f32(pcg_hash(u32(sc.bvhNodeIndex) % 9u)) / f32(0xffffffffu));
}
