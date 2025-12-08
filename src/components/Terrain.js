import * as THREE from 'three';
import { createNoise2D } from 'simplex-noise';
import { RNG } from '../Utils.js';

export class Terrain {
    constructor(scene, loadingManager) {
        this.scene = scene;
        this.noise2D = null; // Will init with seed
        this.geometry = null;
        this.material = null;
        this.mesh = null;
        
        // Settings
        this.size = 2000;
        this.segments = 256; 
        this.maxHeight = 350;
        this.textureRepeat = 10;
        this.rng = new RNG(12345);
    }

    async load() {
        // Load textures
        const textureLoader = new THREE.TextureLoader();
        
        const [rockTex, grassTex] = await Promise.all([
            new Promise(resolve => textureLoader.load('terrain_rock.png', resolve)),
            new Promise(resolve => textureLoader.load('terrain_grass.png', resolve))
        ]);

        [rockTex, grassTex].forEach(t => {
            t.wrapS = THREE.RepeatWrapping;
            t.wrapT = THREE.RepeatWrapping;
            t.repeat.set(this.textureRepeat, this.textureRepeat);
            t.colorSpace = THREE.SRGBColorSpace;
        });

        this.rockTex = rockTex;
        this.grassTex = grassTex;
    }

    generate(seed) {
        // Init seeded noise
        const rng = new RNG(seed);
        this.noise2D = createNoise2D(() => rng.nextFloat());
        console.log("Generating terrain with seed:", seed);

        this.geometry = new THREE.PlaneGeometry(this.size, this.size, this.segments, this.segments);
        this.geometry.rotateX(-Math.PI / 2);

        const posAttribute = this.geometry.attributes.position;
        const vertex = new THREE.Vector3();

        // Noise configuration - Smoother settings
        const scale = 0.0012; // Broader features
        const octaves = 5; // Reduced octaves for less jitter
        const persistance = 0.42; // Smoother falloff
        const lacunarity = 2.1;

        for (let i = 0; i < posAttribute.count; i++) {
            vertex.fromBufferAttribute(posAttribute, i);
            
            let amplitude = 1;
            let frequency = 1;
            let noiseHeight = 0;
            
            // FBM Noise
            for(let o = 0; o < octaves; o++) {
                const n = this.noise2D(vertex.x * scale * frequency, vertex.z * scale * frequency);
                noiseHeight += n * amplitude;
                amplitude *= persistance;
                frequency *= lacunarity;
            }

            // Shape terrain: flatten center for lake, raise edges for mountains
            const distFromCenter = Math.sqrt(vertex.x * vertex.x + vertex.z * vertex.z);
            const mask = Math.max(0, (distFromCenter - 200) / (this.size * 0.45)); // Broader transition
            
            // Apply height
            let y = noiseHeight * this.maxHeight;
            
            // Crater/Lake effect
            y = THREE.MathUtils.lerp(y * 0.15 - 25, y + Math.pow(mask, 2.5) * 200, mask);

            posAttribute.setY(i, y);
        }

        this.geometry.computeVertexNormals();
        this.geometry.computeBoundingBox();
        this.geometry.computeBoundingSphere();

        // Custom Shader Material setup for texture splatting based on slope/height
        // We hook into MeshStandardMaterial to keep lighting/shadows support
        this.material = new THREE.MeshStandardMaterial({
            roughness: 0.8,
            metalness: 0.1,
            color: 0xffffff,
            side: THREE.DoubleSide
        });

        this.material.onBeforeCompile = (shader) => {
            shader.uniforms.rockTexture = { value: this.rockTex };
            shader.uniforms.grassTexture = { value: this.grassTex };
            shader.uniforms.textureRepeat = { value: this.textureRepeat };

            shader.vertexShader = `
                varying vec3 vPos;
                varying vec3 vNormalWorld;
                ${shader.vertexShader}
            `.replace(
                '#include <worldpos_vertex>',
                `
                #include <worldpos_vertex>
                vPos = (modelMatrix * vec4(position, 1.0)).xyz;
                vNormalWorld = normalize(mat3(modelMatrix) * normal);
                `
            );

            shader.fragmentShader = `
                uniform sampler2D rockTexture;
                uniform sampler2D grassTexture;
                varying vec3 vPos;
                varying vec3 vNormalWorld;

                vec4 getTriplanar(sampler2D tex, vec3 pos, vec3 normal, float scale) {
                    vec3 blend = abs(normal);
                    blend /= (blend.x + blend.y + blend.z);
                    
                    vec4 cx = texture2D(tex, pos.yz * scale);
                    vec4 cy = texture2D(tex, pos.xz * scale);
                    vec4 cz = texture2D(tex, pos.xy * scale);
                    
                    return cx * blend.x + cy * blend.y + cz * blend.z;
                }

                ${shader.fragmentShader}
            `.replace(
                '#include <map_fragment>',
                `
                float scale = 0.03; // Texture scale
                
                // 1. Textures
                vec4 grassCol = texture2D(grassTexture, vPos.xz * scale);
                // Use triplanar for rock to prevent stretching on cliffs
                vec4 rockCol = getTriplanar(rockTexture, vPos, vNormalWorld, scale);

                // 2. Terrain Analysis
                float slope = 1.0 - vNormalWorld.y; // 0=flat, 1=vertical
                
                // Noise for organic blending
                float blendNoise = sin(vPos.x * 0.05) * cos(vPos.z * 0.05) * 0.1;
                
                // Slope Blending (Grass vs Rock)
                float slopeThreshold = 0.3 + blendNoise;
                float slopeFactor = smoothstep(slopeThreshold - 0.15, slopeThreshold + 0.15, slope);
                
                // Height Blending (Beach / Snow)
                float beachLevel = 2.0 + blendNoise * 5.0;
                float snowLevel = 180.0 + blendNoise * 30.0;
                
                float beachFactor = 1.0 - smoothstep(beachLevel - 3.0, beachLevel, vPos.y);
                float snowFactor = smoothstep(snowLevel - 20.0, snowLevel, vPos.y);

                // 3. Mixing Layers
                
                // Base: Mix grass and rock based on slope
                vec4 finalColor = mix(grassCol, rockCol, slopeFactor);
                
                // Beach: Tint sandy color near water, but mostly on flat ground
                vec3 sandTint = vec3(1.2, 1.1, 0.9);
                vec4 sandColor = rockCol * vec4(sandTint, 1.0); // Use rock texture for sand grain
                float sandMix = beachFactor * (1.0 - slopeFactor); // Don't put sand on steep underwater cliffs
                finalColor = mix(finalColor, sandColor, sandMix);

                // Snow: White cap on peaks
                vec4 snowColor = vec4(0.95, 0.96, 1.0, 1.0);
                // Snow doesn't stick to very steep cliffs
                float snowStick = snowFactor * (1.0 - smoothstep(0.5, 0.8, slope)); 
                finalColor = mix(finalColor, snowColor, snowStick);

                // Underwater depth effect (simple darkening)
                if(vPos.y < -2.0) {
                    finalColor *= 0.5;
                    finalColor.b += 0.1;
                }

                diffuseColor *= finalColor;
                `
            );
        };

        this.mesh = new THREE.Mesh(this.geometry, this.material);
        this.mesh.receiveShadow = true;
        this.mesh.castShadow = true;
        this.mesh.updateMatrixWorld(); // Ensure world matrix is ready for raycasting immediately
        this.scene.add(this.mesh);
        
        return this.mesh;
    }

    getMesh() {
        return this.mesh;
    }
}