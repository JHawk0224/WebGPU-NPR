import Stats from "stats.js";
import { GUI } from "dat.gui";

import { initWebGPU, Renderer } from "./renderer";
import { Pathtracer } from "./renderers/pathtracer";

import { setupLoaders, Scene } from "./stage/scene";
import { Camera } from "./stage/camera";
import { Stage } from "./stage/stage";
import { vec3 } from "wgpu-matrix";

await initWebGPU();
setupLoaders();

let scene = new Scene();
// await scene.loadGltf("./scenes/box/BoxTextured.gltf", vec3.create(1, 1, 1), vec3.create(0, 1, 2), vec3.create(0, 0, 0));
// await scene.loadGltf(
//     "./scenes/small_airplane/small_airplane.gltf",
//     vec3.create(0.5, 0.5, 0.5),
//     vec3.create(0, 0.8, 0),
//     vec3.create(0, (3 * Math.PI) / 8, 0)
// );
// await scene.loadGltf(
//     "./scenes/person/person.gltf",
//     vec3.create(1, 1, 1),
//     vec3.create(-4.5, -0.8, -4),
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
//     vec3.create(1, 1, 1),
//     vec3.create(0, 3, 0),
//     vec3.create(Math.PI, 0, Math.PI / 2)
// );
// await scene.loadGltf("./scenes/sponza/Sponza.gltf"); // too big for storage

const camera = new Camera();

const stats = new Stats();
stats.showPanel(0);
document.body.appendChild(stats.dom);

const gui = new GUI();

const stage = new Stage(scene, camera, stats);

var renderer: Renderer | undefined;

function setRenderer(mode: string) {
    renderer?.stop();

    switch (mode) {
        case renderModes.pathtracer:
            renderer = new Pathtracer(stage);
            break;
    }
}

const renderModes = { pathtracer: "pathtracer" };
let renderModeController = gui.add({ mode: renderModes.pathtracer }, "mode", renderModes);
renderModeController.onChange(setRenderer);

setRenderer(renderModeController.getValue());
