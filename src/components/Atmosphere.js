import * as THREE from 'three';

export class Atmosphere {
    constructor(scene) {
        this.scene = scene;
        this.particles = null;
    }
    
    create() {
        const particleCount = 3000;
        const geometry = new THREE.BufferGeometry();
        const positions = [];
        
        // Create particles around the play area
        for (let i = 0; i < particleCount; i++) {
            positions.push(
                (Math.random() - 0.5) * 600,
                Math.random() * 100 + 2, // Keep above water
                (Math.random() - 0.5) * 600
            );
        }
        
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        
        const sprite = new THREE.TextureLoader().load('https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/sprites/disc.png');

        const material = new THREE.PointsMaterial({
            color: 0xfffee0, // Warm sunlight dust color
            size: 0.5,
            map: sprite,
            transparent: true,
            opacity: 0.4,
            blending: THREE.AdditiveBlending,
            sizeAttenuation: true,
            depthWrite: false
        });
        
        this.particles = new THREE.Points(geometry, material);
        this.scene.add(this.particles);
    }
    
    update(time) {
        if (!this.particles) return;
        
        const positions = this.particles.geometry.attributes.position.array;
        
        // Simple wind simulation
        for (let i = 0; i < positions.length; i += 3) {
            // Gentle drift
            positions[i] += Math.sin(time * 0.1 + positions[i+1]) * 0.05; // X wobble
            positions[i+1] += Math.sin(time * 0.2 + positions[i]) * 0.02; // Y float
            positions[i+2] += 0.05; // Constant wind Z direction
            
            // Loop particles
            if (positions[i+2] > 300) positions[i+2] = -300;
            if (positions[i] > 300) positions[i] = -300;
            if (positions[i] < -300) positions[i] = 300;
        }
        
        this.particles.geometry.attributes.position.needsUpdate = true;
    }
}