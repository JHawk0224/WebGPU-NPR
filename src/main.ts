import Stats from "stats.js";
import { GUI } from "dat.gui";

import { initWebGPU, Renderer } from "./renderer";
import { Pathtracer } from "./renderers/pathtracer";
import { PathtracerNPR } from "./renderers/pathtracer_npr";

import { setupLoaders, Scene } from "./stage/scene";
import { Camera } from "./stage/camera";
import { Stage } from "./stage/stage";
import { vec3 } from "wgpu-matrix";

await initWebGPU();
setupLoaders();

let scene = new Scene();
// await scene.loadGltf("./scenes/box/BoxTextured.gltf", vec3.create(1, 1, 1), vec3.create(0, 3, 0), vec3.create(0, 0, 0));
// await scene.loadGltf(
//     "./scenes/small_airplane/small_airplane.gltf",
//     vec3.create(0.5, 0.5, 0.5),
//     vec3.create(0, 0, 0),
//     vec3.create(0, (3 * Math.PI) / 8, 0)
// );
// await scene.loadGltf(
//     "./scenes/person/person.gltf",
//     vec3.create(1, 1, 1),
//     vec3.create(-4.5, -1, -4.5),
//     vec3.create(0, -Math.PI / 4, 0)
// );
// await scene.loadGltf(
//     "./scenes/suzanne.gltf",
//     vec3.create(1, 1, 1),
//     vec3.create(0, 1.5, 0),
//     vec3.create(0, -Math.PI / 4, 0)
// );
// await scene.loadGltf(
//     "./scenes/skull/skull_textures.gltf",
//     vec3.create(1.5, 1.5, 1.5),
//     vec3.create(0, 0, 0),
//     vec3.create(Math.PI, 0, (Math.PI * 3) / 2)
// );
// await scene.loadGltf(
//     "./scenes/halo/scene.gltf",
//     vec3.create(60, 60, 60),
//     vec3.create(0, -2, 0),
//     vec3.create(0, Math.PI / 4, 0)
// );

const camera = new Camera();

const stats = new Stats();
stats.showPanel(0);
document.body.appendChild(stats.dom);

const gui = new GUI();

const stage = new Stage(scene, camera, stats);

var renderer: Renderer | undefined;

const settings = {
    mode: "pathtracerNPR",
    enableBVH: scene.enableBVH,
};

function setRenderer(settings: { mode: string; enableBVH: boolean }) {
    renderer?.stop();

    stage.scene.setBVHEnabled(settings.enableBVH);
    switch (settings.mode) {
        case renderModes.Pathtracer:
            renderer = new Pathtracer(stage);
            break;
        case renderModes.PathtracerNPR:
            renderer = new PathtracerNPR(stage);
            break;
    }
}

const renderModes = { Pathtracer: "pathtracer", PathtracerNPR: "pathtracerNPR" };
let renderModeController = gui.add(settings, "mode", renderModes).name("Render Mode");
renderModeController.onChange((value) => {
    settings.mode = value;
    setRenderer(settings);
});

const enableBVHController = gui.add(settings, "enableBVH").name("Enable BVH");
enableBVHController.onChange((value) => {
    settings.enableBVH = value;
    setRenderer(settings);
});

setRenderer(settings);
