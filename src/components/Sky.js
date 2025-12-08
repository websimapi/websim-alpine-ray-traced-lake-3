import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

export class SkySystem {
    constructor(scene, renderer) {
        this.scene = scene;
        this.renderer = renderer;
        this.sky = new Sky();
        this.sun = new THREE.Vector3();
        
        // Setup Sky
        this.sky.scale.setScalar(450000);
        this.scene.add(this.sky);

        // Sun Parameters (Golden Hour)
        this.effectController = {
            turbidity: 10,
            rayleigh: 3,
            mieCoefficient: 0.005,
            mieDirectionalG: 0.7,
            elevation: 2, // Low sun
            azimuth: 180,
            exposure: renderer.toneMappingExposure
        };

        this.updateSky();
    }

    updateSky() {
        const uniforms = this.sky.material.uniforms;
        uniforms['turbidity'].value = this.effectController.turbidity;
        uniforms['rayleigh'].value = this.effectController.rayleigh;
        uniforms['mieCoefficient'].value = this.effectController.mieCoefficient;
        uniforms['mieDirectionalG'].value = this.effectController.mieDirectionalG;

        const phi = THREE.MathUtils.degToRad(90 - this.effectController.elevation);
        const theta = THREE.MathUtils.degToRad(this.effectController.azimuth);

        this.sun.setFromSphericalCoords(1, phi, theta);
        uniforms['sunPosition'].value.copy(this.sun);

        return this.sun;
    }
}

