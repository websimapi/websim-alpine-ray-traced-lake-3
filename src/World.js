import * as THREE from 'three';
import { Terrain } from './components/Terrain.js';
import { WaterSystem } from './components/Water.js';
import { SkySystem } from './components/Sky.js';
import { Trees } from './components/Trees.js';
import { Player } from './components/Player.js';
import { CameraController } from './components/CameraController.js';
import { Atmosphere } from './components/Atmosphere.js';
import { NetworkPlayers } from './components/NetworkPlayers.js';

import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

export class World {
    constructor(canvas, room) {
        this.canvas = canvas;
        this.room = room; // WebsimSocket
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.composer = null; // Post-processing
        this.cameraController = null;
        this.player = null;
        this.raycaster = new THREE.Raycaster();
        this.rayDown = new THREE.Vector3(0, -1, 0);
        
        this.terrain = null;
        this.water = null;
        this.sky = null;
        this.trees = null;
        this.atmosphere = null;
        this.clock = new THREE.Clock();
        this.audioContext = null;
        this.sound = null;
        this.networkPlayers = null;
        this.presenceTimer = 0;
    }

    async init() {
        // Renderer
        this.renderer = new THREE.WebGLRenderer({ 
            canvas: this.canvas, 
            antialias: false, // Turn off native antialias if using post-processing for performance
            powerPreference: "high-performance",
            stencil: false,
            depth: true
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 0.8; // Bump exposure slightly
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

        // Scene
        this.scene = new THREE.Scene();
        
        // Camera
        this.camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.5, 20000);
        this.camera.position.set(0, 30, 100);

        // Fog
        this.defaultFogColor = 0x5ca5c9;
        this.underwaterFogColor = 0x001e0f;
        this.scene.fog = new THREE.FogExp2(this.defaultFogColor, 0.0025); 

        // --- MAP DATA SYNC (Column 11) ---
        // Determine Seed
        let seed = 12345;
        const currentUser = await window.websim.getCurrentUser();
        const createdBy = await window.websim.getCreatedBy();
        const isHost = currentUser && createdBy && currentUser.username === createdBy.username;

        if (this.room.roomState.column11 && this.room.roomState.column11.seed) {
            seed = this.room.roomState.column11.seed;
            console.log("Loaded seed from roomState:", seed);
        } else if (isHost) {
            seed = Math.floor(Math.random() * 100000);
            this.room.updateRoomState({
                column11: {
                    seed: seed,
                    generatedBy: currentUser.username,
                    timestamp: Date.now()
                }
            });
            console.log("Host generated new seed:", seed);
        } else {
            console.log("Waiting for host seed, using default for now...");
        }

        // Components
        this.sky = new SkySystem(this.scene, this.renderer);
        const sunPos = this.sky.updateSky();

        // Lighting
        const sunLight = new THREE.DirectionalLight(0xfffaed, 3.0); // Brighter sun
        sunLight.position.copy(sunPos);
        sunLight.castShadow = true;
        
        // Shadow optimization
        sunLight.shadow.mapSize.width = 4096; // Higher res shadows
        sunLight.shadow.mapSize.height = 4096;
        const d = 400;
        sunLight.shadow.camera.left = -d;
        sunLight.shadow.camera.right = d;
        sunLight.shadow.camera.top = d;
        sunLight.shadow.camera.bottom = -d;
        sunLight.shadow.bias = -0.00005;
        sunLight.shadow.normalBias = 0.05; // Helps with acne on terrain
        
        this.scene.add(sunLight);

        const ambientLight = new THREE.AmbientLight(0x404040, 0.6); 
        this.scene.add(ambientLight);

        // Load Async Components
        this.terrain = new Terrain(this.scene);
        await this.terrain.load();
        const terrainMesh = this.terrain.generate(seed);

        this.water = new WaterSystem(this.scene);
        await this.water.load();
        this.water.setSunDirection(sunLight.position);

        this.trees = new Trees(this.scene, terrainMesh);
        this.trees.generate();
        
        // Atmosphere particles
        this.atmosphere = new Atmosphere(this.scene);
        this.atmosphere.create();

        // Player & Camera Setup
        this.player = new Player(this.scene, false);
        
        // Find safe starting spot (center of map)
        const startY = this.getTerrainHeight(0, 0);
        this.player.position.set(0, startY + 5, 0);

        this.networkPlayers = new NetworkPlayers(this.scene, this.room);

        this.cameraController = new CameraController(this.camera, this.canvas);
        this.cameraController.setTarget(this.player.mesh);

        // Setup Post-Processing
        this.setupPostProcessing();

        // Handle window resize
        window.addEventListener('resize', () => this.onResize());
    }

    setupPostProcessing() {
        this.composer = new EffectComposer(this.renderer);
        
        const renderPass = new RenderPass(this.scene, this.camera);
        this.composer.addPass(renderPass);

        // Underwater Distortion Pass
        const UnderwaterShader = {
            uniforms: {
                tDiffuse: { value: null },
                time: { value: 0 },
                enabled: { value: 0.0 }, // 0 = off, 1 = on
                color: { value: new THREE.Color(0x001e0f) }
            },
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
                }
            `,
            fragmentShader: `
                uniform sampler2D tDiffuse;
                uniform float time;
                uniform float enabled;
                uniform vec3 color;
                varying vec2 vUv;
                
                void main() {
                    vec2 uv = vUv;
                    
                    if (enabled > 0.5) {
                        // Wobble
                        uv.x += sin(uv.y * 15.0 + time) * 0.003;
                        uv.y += cos(uv.x * 12.0 + time * 1.5) * 0.003;
                        
                        // Chromatic aberration (simple shift)
                        float r = texture2D(tDiffuse, uv + vec2(0.002, 0.0)).r;
                        float g = texture2D(tDiffuse, uv).g;
                        float b = texture2D(tDiffuse, uv - vec2(0.002, 0.0)).b;
                        vec3 tex = vec3(r, g, b);
                        
                        // Blue tint
                        vec3 tint = color * 1.5;
                        vec3 final = mix(tex, tint, 0.6);
                        
                        // Vignette
                        float dist = distance(vUv, vec2(0.5));
                        float vignette = smoothstep(0.8, 0.2, dist);
                        
                        gl_FragColor = vec4(final * vignette, 1.0);
                    } else {
                        gl_FragColor = texture2D(tDiffuse, uv);
                    }
                }
            `
        };

        this.underwaterPass = new ShaderPass(UnderwaterShader);
        this.composer.addPass(this.underwaterPass);

        // Bloom for AAA glow
        const bloomPass = new UnrealBloomPass(
            new THREE.Vector2(window.innerWidth, window.innerHeight),
            1.5, 0.4, 0.85
        );
        bloomPass.threshold = 0.6; // Only very bright things glow
        bloomPass.strength = 0.4;
        bloomPass.radius = 0.5;
        this.composer.addPass(bloomPass);

        // Color correction
        const outputPass = new OutputPass();
        this.composer.addPass(outputPass);
    }

    start() {
        this.renderer.setAnimationLoop(() => {
            this.update();
            this.render();
        });
    }

    getTerrainHeight(x, z) {
        if (!this.terrain || !this.terrain.getMesh()) return 0;
        
        // Raycast down from high up
        this.raycaster.set(new THREE.Vector3(x, 5000, z), this.rayDown);
        const intersects = this.raycaster.intersectObject(this.terrain.getMesh());
        
        if (intersects.length > 0) {
            return intersects[0].point.y;
        }
        return -100; // Fall into "water" if off-map
    }

    update() {
        const delta = this.clock.getDelta();
        const time = this.clock.getElapsedTime();

        // 1. Check Underwater State
        const waterLevel = -2; // Hardcoded in Water.js, should match
        const isUnderwater = this.camera.position.y < waterLevel;

        // 2. Update Post-Processing & Fog
        if (isUnderwater) {
            this.scene.fog.density = 0.05; // Dense fog
            this.scene.fog.color.setHex(this.underwaterFogColor);
            if (this.underwaterPass) {
                this.underwaterPass.uniforms.enabled.value = 1.0;
                this.underwaterPass.uniforms.time.value = time;
            }
        } else {
            this.scene.fog.density = 0.0025;
            this.scene.fog.color.setHex(this.defaultFogColor);
            if (this.underwaterPass) {
                this.underwaterPass.uniforms.enabled.value = 0.0;
            }
        }

        if (this.water) this.water.update(time);
        if (this.atmosphere) this.atmosphere.update(time);
        
        // Sync Network Players
        if (this.networkPlayers) this.networkPlayers.update(delta);

        if (this.player && this.cameraController) {
            // Pass terrain height lookup function so player can check height
            this.player.update(delta, (x, z) => this.getTerrainHeight(x, z), this.camera);
            
            // Broadcast Presence (Column 1)
            this.presenceTimer += delta;
            if (this.presenceTimer > 0.05) { // 20Hz update
                this.presenceTimer = 0;
                
                // Infer state for animation
                const isSwimming = this.player.position.y < this.player.waterLevel + 0.5;
                
                this.room.updatePresence({
                    column1: {
                        x: this.player.position.x,
                        y: this.player.position.y,
                        z: this.player.position.z,
                        rot: this.player.rotation,
                        state: isSwimming ? 'swim' : 'idle'
                    }
                });
            }

            // Update camera with terrain mesh for collision
            this.cameraController.update(this.terrain.getMesh());
        }
    }

    render() {
        // Use composer instead of raw renderer
        if (this.composer) {
            this.composer.render();
        } else {
            this.renderer.render(this.scene, this.camera);
        }
    }

    onResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        if (this.composer) {
            this.composer.setSize(window.innerWidth, window.innerHeight);
        }
    }

    enableAudio() {
        if (!this.audioContext) {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            this.audioContext = new AudioContext();
            
            const listener = new THREE.AudioListener();
            this.camera.add(listener);

            const audioLoader = new THREE.AudioLoader();
            this.sound = new THREE.Audio(listener);

            audioLoader.load('ambience.mp3', (buffer) => {
                this.sound.setBuffer(buffer);
                this.sound.setLoop(true);
                this.sound.setVolume(0.5);
                this.sound.play();
            });
        } else if (this.audioContext.state === 'suspended') {
            this.audioContext.resume();
        }
    }
}