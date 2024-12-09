import commonRaw from "./common.wgsl?raw";
import intersectionRaw from "./intersection.wgsl?raw";
import integratorRaw from "./integrator.wgsl?raw";
import samplerRaw from "./sampler.wgsl?raw";
import stylizerRaw from "./stylizer.wgsl?raw";

import pathtracerVertRaw from "./pathtracer.vs.wgsl?raw";
import pathtracerFragRaw from "./pathtracer.fs.wgsl?raw";
import pathtracerComputeRaw from "./pathtracer.cs.wgsl?raw";
import pathtracerComputeNPRRaw from "./pathtracer_npr.cs.wgsl?raw";
import clothSimComputeRaw from "./cloth_sim.cs.wgsl?raw";

// CONSTANTS (for use in shaders)
// =================================

// Note that these are declared in a somewhat roundabout way because otherwise minification will drop variables
// that are unused in host side code.
export const constants = {
    bindGroup_scene: 0,
    bindGroup_pathtracer: 1,
    bindGroup_geometry: 2,
    bindGroup_textures: 2,

    workgroupSizeX: 4,
    workgroupSizeY: 4,
    workgroupSizeZ: 8,

    maxResolutionWidth: 1920,
    maxResolutionHeight: 1080,

    presentationFormat: "bgra8unorm",
};

// =================================

function evalShaderRaw(raw: string) {
    return eval("`" + raw.replaceAll("${", "${constants.") + "`");
}

const commonSrc: string = evalShaderRaw(commonRaw);
const intersectionSrc: string = evalShaderRaw(intersectionRaw);
const integratorSrc: string = evalShaderRaw(integratorRaw);
const samplerSrc: string = evalShaderRaw(samplerRaw);
const stylizerSrc: string = evalShaderRaw(stylizerRaw);

function processShaderRaw(raw: string) {
    return commonSrc + intersectionSrc + evalShaderRaw(raw);
}

function processShaderRawPT(raw: string) {
    return commonSrc + intersectionSrc + integratorSrc + samplerSrc + evalShaderRaw(raw);
}

function processShaderRawPTNPR(raw: string) {
    return commonSrc + intersectionSrc + integratorSrc + samplerSrc + stylizerSrc + evalShaderRaw(raw);
}

export const pathtracerVertSrc: string = processShaderRaw(pathtracerVertRaw);
export const pathtracerFragSrc: string = processShaderRaw(pathtracerFragRaw);
export const pathtracerComputeSrc: string = processShaderRawPT(pathtracerComputeRaw);
export const pathtracerComputeNPRSrc: string = processShaderRawPTNPR(pathtracerComputeNPRRaw);
export const clothSimComputeSrc: string = processShaderRawPT(clothSimComputeRaw);
