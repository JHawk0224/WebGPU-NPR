import Stats from "stats.js";
import { GUI } from "dat.gui";

import { initWebGPU, Renderer } from "./renderer";
import { NaiveRenderer } from "./renderers/naive";
import { ClusteredDeferredRenderer } from "./renderers/clustered_deferred";
import { Pathtracer } from "./renderers/pathtracer";

import { setupLoaders, Scene } from "./stage/scene";
import { Lights } from "./stage/lights";
import { Camera } from "./stage/camera";
import { Stage } from "./stage/stage";

await initWebGPU();
setupLoaders();

let scene = new Scene();
await scene.loadGltf("./scenes/suzanne.gltf");

const camera = new Camera();
const lights = new Lights(camera);

const stats = new Stats();
stats.showPanel(0);
document.body.appendChild(stats.dom);

const gui = new GUI();
gui.add(lights, "numLights")
    .min(1)
    .max(Lights.maxNumLights)
    .step(1)
    .onChange(() => {
        lights.updateLightSetUniformNumLights();
    });

const stage = new Stage(scene, lights, camera, stats);

var renderer: Renderer | undefined;

function setRenderer(mode: string) {
    renderer?.stop();

    switch (mode) {
        case renderModes.naive:
            renderer = new NaiveRenderer(stage);
            break;
        case renderModes.clusteredDeferred:
            renderer = new ClusteredDeferredRenderer(stage);
            break;
        case renderModes.pathtracer:
            renderer = new Pathtracer(stage);
            break;
    }
}

const renderModes = { naive: "naive", clusteredDeferred: "clustered deferred", pathtracer: "pathtracer" };
let renderModeController = gui.add({ mode: renderModes.pathtracer }, "mode", renderModes);
renderModeController.onChange(setRenderer);

setRenderer(renderModeController.getValue());
