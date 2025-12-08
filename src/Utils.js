import * as THREE from 'three';

export const loadTexture = (path) => {
    return new Promise((resolve, reject) => {
        const loader = new THREE.TextureLoader();
        loader.load(
            path,
            (texture) => {
                texture.colorSpace = THREE.SRGBColorSpace;
                texture.wrapS = THREE.RepeatWrapping;
                texture.wrapT = THREE.RepeatWrapping;
                resolve(texture);
            },
            undefined,
            (err) => reject(err)
        );
    });
};

export class RNG {
    constructor(seed) {
        this.m = 0x80000000;
        this.a = 1103515245;
        this.c = 12345;
        this.state = seed ? seed : Math.floor(Math.random() * (this.m - 1));
    }

    nextFloat() {
        this.state = (this.a * this.state + this.c) % this.m;
        return this.state / (this.m - 1);
    }
}

// Simple pseudo-random for procedural generation consistency if needed
export const random = (seed) => {
    const x = Math.sin(seed++) * 10000;
    return x - Math.floor(x);
};

