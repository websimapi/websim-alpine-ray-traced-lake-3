import * as THREE from 'three';

export class CameraController {
    constructor(camera, domElement) {
        this.camera = camera;
        this.domElement = domElement;
        this.target = null;

        this.distance = 15;
        this.minDistance = 0.1;
        this.maxDistance = 60;

        this.theta = Math.PI; // Yaw
        this.phi = 1.4; // Pitch (High angle default)

        this.isLocked = false;
        
        this.collisionRaycaster = new THREE.Raycaster();
        this.downRaycaster = new THREE.Raycaster();
        this.downVec = new THREE.Vector3(0, -1, 0);

        this.initInput();
    }

    setTarget(targetMesh) {
        this.target = targetMesh;
    }

    initInput() {
        // Pointer Lock request
        this.domElement.addEventListener('click', () => {
            this.domElement.requestPointerLock();
        });

        document.addEventListener('pointerlockchange', () => {
            this.isLocked = document.pointerLockElement === this.domElement;
        });

        document.addEventListener('mousemove', (e) => {
            if (!this.isLocked) return;

            // Mouse Look
            const sensitivity = 0.002;
            this.theta -= e.movementX * sensitivity;
            this.phi -= e.movementY * sensitivity;

            // Clamp Vertical Look
            // Prevent flipping over
            this.phi = Math.max(0.01, Math.min(Math.PI - 0.01, this.phi));
        });

        document.addEventListener('wheel', (e) => {
            if (!this.isLocked) return;

            const zoomSpeed = 0.02;
            this.distance += e.deltaY * zoomSpeed;
            this.distance = Math.max(this.minDistance, Math.min(this.maxDistance, this.distance));
        });
    }

    update(terrainMesh) {
        if (!this.target) return;

        const isFirstPerson = this.distance < 1.0;

        // Focus on player head/upper body
        const targetPos = this.target.position.clone().add(new THREE.Vector3(0, 1.8, 0));

        if (isFirstPerson) {
            // First Person: Camera is at eye level
            this.camera.position.copy(targetPos);

            // Look direction determined by theta/phi
            const lookX = Math.sin(this.phi) * Math.sin(this.theta);
            const lookY = Math.cos(this.phi);
            const lookZ = Math.sin(this.phi) * Math.cos(this.theta);

            const lookTarget = targetPos.clone().add(new THREE.Vector3(lookX, lookY, lookZ));
            this.camera.lookAt(lookTarget);

            // Hide player model so we don't clip through face
            this.target.visible = false;
        } else {
            // Third Person: Camera orbits player
            this.target.visible = true;

            // Calculate spherical position
            const x = this.distance * Math.sin(this.phi) * Math.sin(this.theta);
            const y = this.distance * Math.cos(this.phi);
            const z = this.distance * Math.sin(this.phi) * Math.cos(this.theta);

            const camPos = targetPos.clone().add(new THREE.Vector3(x, y, z));

            // AAA Camera Collision
            if (terrainMesh) {
                // 1. Line of Sight Check (Target -> Camera)
                // Prevents camera from going through walls/mountains
                const dirToCam = camPos.clone().sub(targetPos);
                const distToCam = dirToCam.length();
                dirToCam.normalize();

                // Raycast only up to the camera distance
                this.collisionRaycaster.set(targetPos, dirToCam);
                this.collisionRaycaster.far = distToCam;
                
                const intersects = this.collisionRaycaster.intersectObject(terrainMesh);
                
                if (intersects.length > 0) {
                    // Hit terrain! Move camera to hit point minus buffer
                    const hitDistance = intersects[0].distance;
                    // Smoothly pull camera in, or snap? Snap is safer to avoid clipping.
                    const buffer = 0.5; // Keep camera 0.5 units away from wall
                    camPos.copy(targetPos).add(dirToCam.multiplyScalar(Math.max(0.1, hitDistance - buffer)));
                }

                // 2. Ground Collision Check
                // Ensures camera doesn't go underground at its final position
                this.downRaycaster.set(new THREE.Vector3(camPos.x, 1000, camPos.z), this.downVec);
                const groundIntersects = this.downRaycaster.intersectObject(terrainMesh);

                if (groundIntersects.length > 0) {
                    const groundHeight = groundIntersects[0].point.y;
                    const minHeight = groundHeight + 0.5; // Keep 0.5 units above ground
                    
                    if (camPos.y < minHeight) {
                        camPos.y = minHeight;
                        
                        // If we raised the camera, it might have pushed it further back or forward awkwardly.
                        // For a simple orbit, this height clamp is usually sufficient, 
                        // though it changes the effective pitch relative to target.
                    }
                }
            }

            // Just apply position
            this.camera.position.copy(camPos);
            this.camera.lookAt(targetPos);
        }
    }

    getYaw() {
        return this.theta;
    }
}