@group(0) @binding(0) var renderTexture: texture_2d<f32>;

@fragment
fn main(@builtin(position) coord : vec4f) -> @location(0) vec4f
{
    let color = textureLoad(
        renderTexture,
        vec2i(floor(coord.xy)),
        0
    ).xyz;
    
    return vec4(color, 1);
}
