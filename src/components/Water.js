import * as THREE from 'three';
import { Water } from 'three/addons/objects/Water.js';

export class WaterSystem {
    constructor(scene) {
        this.scene = scene;
        this.water = null;
    }

    async load() {
        const loader = new THREE.TextureLoader();
        const normalMap = await new Promise(resolve => loader.load('waternormals.png', resolve));

        normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping;
        // Improve texture quality at grazing angles to reduce shimmering
        if (this.scene.renderer) {
            normalMap.anisotropy = this.scene.renderer.capabilities.getMaxAnisotropy();
        }

        const waterGeometry = new THREE.PlaneGeometry(10000, 10000);

        // Scale UVs so the normal map repeats instead of stretching over the entire 10km area
        // Reduced scale to minimize high-frequency noise/glitchiness
        const uvAttribute = waterGeometry.attributes.uv;
        const uvScale = 100; 
        for (let i = 0; i < uvAttribute.count; i++) {
            uvAttribute.setXY(i, uvAttribute.getX(i) * uvScale, uvAttribute.getY(i) * uvScale);
        }

        this.water = new Water(
            waterGeometry,
            {
                textureWidth: 512,
                textureHeight: 512,
                waterNormals: normalMap,
                sunDirection: new THREE.Vector3(),
                sunColor: 0xffffff,
                waterColor: 0x004a6f, 
                distortionScale: 1.0, // Reduced from 3.7 to prevent glitchy wobbling
                fog: this.scene.fog !== undefined,
                alpha: 0.8
            }
        );

        this.water.rotation.x = -Math.PI / 2;
        this.water.position.y = -2; 
        this.water.material.side = THREE.FrontSide; // Only render top to prevent z-fighting
        this.water.receiveShadow = false; // Disable shadows on water surface to prevent flickering/acne
        
        this.scene.add(this.water);

        // Add an underside mesh for viewing from below
        // Using a custom shader to make the surface distinctive and "water-like" from below
        const underGeo = new THREE.PlaneGeometry(10000, 10000);
        
        const underMat = new THREE.ShaderMaterial({
            uniforms: {
                time: { value: 0 },
                normalMap: { value: normalMap },
                baseColor: { value: new THREE.Color(0x004a6f) },
                surfaceColor: { value: new THREE.Color(0xaaccff) }, // Bright surface color
                repeat: { value: uvScale }
            },
            vertexShader: `
                varying vec2 vUv;
                varying vec3 vViewPosition;
                uniform float repeat;

                void main() {
                    vUv = uv * repeat;
                    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                    vViewPosition = -mvPosition.xyz;
                    gl_Position = projectionMatrix * mvPosition;
                }
            `,
            fragmentShader: `
                uniform float time;
                uniform sampler2D normalMap;
                uniform vec3 baseColor;
                uniform vec3 surfaceColor;
                
                varying vec2 vUv;
                varying vec3 vViewPosition;

                void main() {
                    // Animate normals for wobbly surface
                    float timeScale = 0.5;
                    vec2 uv0 = vUv + vec2(time * 0.03, time * 0.01);
                    vec2 uv1 = vUv + vec2(-time * 0.01, time * 0.02) + vec2(0.5);
                    
                    vec3 normal = texture2D(normalMap, uv0).rgb * 2.0 - 1.0;
                    vec3 n2 = texture2D(normalMap, uv1).rgb * 2.0 - 1.0;
                    normal = normalize(normal + n2);
                    
                    // Simple fresnel / brightness based on viewing angle
                    vec3 viewDir = normalize(vViewPosition);
                    // Assume plane normal is (0, -1, 0) in world, but in tangent space it varies
                    // We just use the texture normal intensity to modulate brightness
                    
                    float brightness = smoothstep(-0.5, 0.8, normal.y);
                    
                    // Mix deep water color with bright surface color
                    vec3 finalColor = mix(baseColor, surfaceColor, brightness * 0.7);
                    
                    // Add bright highlights
                    finalColor += vec3(1.0) * smoothstep(0.6, 0.9, normal.y) * 0.5;

                    gl_FragColor = vec4(finalColor, 0.7); 
                }
            `,
            transparent: true,
            side: THREE.BackSide,
            depthWrite: false
        });

        this.underWaterMesh = new THREE.Mesh(underGeo, underMat);
        this.underWaterMesh.rotation.x = -Math.PI / 2;
        this.underWaterMesh.position.y = -1.95; // Slightly offset from surface to prevent Z-fighting
        this.scene.add(this.underWaterMesh);
    }

    update(time) {
        if (this.water) {
            this.water.material.uniforms['time'].value += 1.0 / 60.0;
        }
        if (this.underWaterMesh) {
            this.underWaterMesh.material.uniforms['time'].value = time;
        }
    }

    setSunDirection(vector) {
        if (this.water) {
            this.water.material.uniforms['sunDirection'].value.copy(vector).normalize();
        }
    }
}