import { Camera } from "./camera";
import { Scene } from "./scene";

export class Stage {
    scene: Scene;
    camera: Camera;
    stats: Stats;

    constructor(scene: Scene, camera: Camera, stats: Stats) {
        this.scene = scene;
        this.camera = camera;
        this.stats = stats;
    }
}
