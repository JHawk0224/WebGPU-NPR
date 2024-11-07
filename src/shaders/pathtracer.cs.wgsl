@group(${bindGroup_scene}) @binding(0) var<uniform> cameraUniforms: CameraUniforms;
@group(${bindGroup_scene}) @binding(1) var<storage, read> lightSet: LightSet;

@group(${bindGroup_pathtracer}) @binding(0) var outputTex : texture_storage_2d<rgba8unorm, write>;

@compute
@workgroup_size(${workgroupSizeX}, ${workgroupSizeY})
fn main(@builtin(global_invocation_id) globalIdx: vec3u) {
    
    textureStore(outputTex, globalIdx.xy, vec4(f32(globalIdx.x) / 1000.0f, f32(globalIdx.y) / 1000.0f, 0, 1));
}