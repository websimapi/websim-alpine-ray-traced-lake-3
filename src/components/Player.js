import * as THREE from 'three';

export class Player {
    constructor(scene, isRemote = false, userData = {}) {
        this.scene = scene;
        this.isRemote = isRemote;
        this.position = new THREE.Vector3(0, 100, 0); 
        this.rotation = 0;

        // Keys only needed for local player
        if (!isRemote) {
            this.keys = { w: false, a: false, s: false, d: false, space: false, shift: false };
            this.initInput();
        }

        this.mesh = this.createStickFigure();
        this.scene.add(this.mesh);

        this.walkSpeed = 15.0;
        this.swimSpeed = 8.0;
        this.animTime = 0;

        this.waterLevel = -2;
        this.heightOffset = 0.2; // Offset to keep feet on ground
        
        // Remote data interpolation
        this.targetPos = new THREE.Vector3();
        this.targetRot = 0;
        this.targetAction = 'idle';
    }

    initInput() {
        document.addEventListener('keydown', (e) => this.onKey(e, true));
        document.addEventListener('keyup', (e) => this.onKey(e, false));
    }

    onKey(e, pressed) {
        if (this.isRemote) return;
        const key = e.code.toLowerCase(); 
        // Support both WASD and Arrow keys
        if (key === 'keyw' || key === 'arrowup') this.keys.w = pressed;
        if (key === 'keya' || key === 'arrowleft') this.keys.a = pressed;
        if (key === 'keys' || key === 'arrowdown') this.keys.s = pressed;
        if (key === 'keyd' || key === 'arrowright') this.keys.d = pressed;
        if (key === 'space') this.keys.space = pressed;
        if (key === 'shiftleft' || key === 'shiftright') this.keys.shift = pressed;
    }

    createStickFigure() {
        const group = new THREE.Group();
        group.rotation.order = 'YXZ'; 
        group.castShadow = true;

        const mat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.6 });
        const jointMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.5 }); 

        // 1. Container for body parts that can be tilted independently of the root Y-axis rotation
        this.bodyGroup = new THREE.Group();
        group.add(this.bodyGroup);

        // --- Torso ---
        // Slight taper for better shape
        const torsoGeo = new THREE.CapsuleGeometry(0.22, 0.7, 4, 8);
        this.torso = new THREE.Mesh(torsoGeo, mat);
        this.torso.position.y = 1.35;
        this.torso.castShadow = true;
        this.bodyGroup.add(this.torso);

        // --- Head ---
        this.head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 16), mat);
        this.head.position.y = 1.95;
        this.head.castShadow = true;
        this.bodyGroup.add(this.head);

        // --- Joint/Limb Factory ---
        const createSegment = (length, width = 0.11) => {
            const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(width, length, 4, 8), mat);
            // Center of capsule is (0,0,0), so we move it down by half length to rotate from top
            mesh.position.y = -length / 2; 
            mesh.castShadow = true;
            return mesh;
        };

        const createJoint = (x, y, z) => {
            const joint = new THREE.Group();
            joint.position.set(x, y, z);
            
            // Visual joint sphere
            const sphere = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), jointMat);
            sphere.castShadow = true;
            joint.add(sphere);
            
            return joint;
        };

        // --- Arms ---
        const armWidth = 0.09;
        const upperArmLen = 0.55;
        const lowerArmLen = 0.55;
        const shoulderY = 1.6;
        const shoulderX = 0.35;

        // Left Arm
        this.shoulderL = createJoint(-shoulderX, shoulderY, 0);
        this.upperArmL = createSegment(upperArmLen, armWidth);
        this.shoulderL.add(this.upperArmL);
        
        this.elbowL = createJoint(0, -upperArmLen, 0);
        this.upperArmL.add(this.elbowL); // Attach elbow to end of upper arm mesh? No, grouping is better.
        // Actually, upperArmL mesh is offset y. So (0, -len, 0) relative to shoulder is the elbow spot.
        // We need to structure it: Shoulder -> UpperArmGroup -> Elbow -> LowerArmGroup
        
        // Re-doing factory for hierarchy
        const buildLimb = (origin, upperLen, lowerLen, width) => {
            const root = new THREE.Group();
            root.position.copy(origin);

            const upperMesh = createSegment(upperLen, width);
            root.add(upperMesh);

            const joint = new THREE.Group();
            joint.position.y = -upperLen; // At end of upper
            root.add(joint);

            // Visual elbow/knee
            const jointSphere = new THREE.Mesh(new THREE.SphereGeometry(width * 1.2, 8, 8), jointMat);
            joint.add(jointSphere);

            const lowerMesh = createSegment(lowerLen, width * 0.9);
            joint.add(lowerMesh);
            
            return { root, joint, upperMesh, lowerMesh };
        };

        this.armL = buildLimb(new THREE.Vector3(-shoulderX, shoulderY, 0), upperArmLen, lowerArmLen, armWidth);
        this.armR = buildLimb(new THREE.Vector3(shoulderX, shoulderY, 0), upperArmLen, lowerArmLen, armWidth);
        
        this.bodyGroup.add(this.armL.root);
        this.bodyGroup.add(this.armR.root);

        // --- Legs ---
        const legWidth = 0.12;
        const upperLegLen = 0.65;
        const lowerLegLen = 0.65;
        const hipY = 1.0;
        const hipX = 0.2;

        this.legL = buildLimb(new THREE.Vector3(-hipX, hipY, 0), upperLegLen, lowerLegLen, legWidth);
        this.legR = buildLimb(new THREE.Vector3(hipX, hipY, 0), upperLegLen, lowerLegLen, legWidth);

        this.bodyGroup.add(this.legL.root);
        this.bodyGroup.add(this.legR.root);

        return group;
    }

    // For remote players to update their state
    updateRemote(dt, data) {
        if (!data) return;
        
        // Lerp position and rotation
        this.targetPos.set(data.x, data.y, data.z);
        this.targetRot = data.rot;
        
        this.position.lerp(this.targetPos, 10 * dt);
        
        // Handle rotation wrapping
        let rotDiff = this.targetRot - this.rotation;
        while (rotDiff > Math.PI) rotDiff -= Math.PI * 2;
        while (rotDiff < -Math.PI) rotDiff += Math.PI * 2;
        this.rotation += rotDiff * 10 * dt;
        
        this.mesh.position.copy(this.position);
        this.mesh.rotation.y = this.rotation;
        
        // Animation
        const isMoving = this.position.distanceTo(this.targetPos) > 0.1;
        // Determine swimming from y height relative to water roughly? 
        // Or pass 'isSwimming' in data. Assuming 'state' field in data for now.
        const isSwimming = data.state === 'swim';
        
        this.animateLimbs(dt, isMoving, isSwimming);
        
        // Pitch body based on move
        if (isSwimming) {
             // Simple pitch approx from vertical movement
             // Ideally this comes from network but we can infer
             const dy = this.targetPos.y - this.position.y;
             let targetPitch = Math.PI / 2;
             if (Math.abs(dy) > 0.01) targetPitch -= dy * 5.0;
             this.bodyGroup.rotation.x = THREE.MathUtils.lerp(this.bodyGroup.rotation.x, targetPitch, 5 * dt);
        } else {
             this.bodyGroup.rotation.x = THREE.MathUtils.lerp(this.bodyGroup.rotation.x, 0, 10 * dt);
             this.bodyGroup.position.y = 0;
        }
    }

    update(dt, getTerrainHeight, camera) {
        if (this.isRemote) return;

        // State Check
        const terrainHeight = getTerrainHeight(this.position.x, this.position.z);
        const waterHeight = this.waterLevel;
        
        // Determine if we are in swimming depth (and submerged enough)
        const depth = waterHeight - terrainHeight;
        const isDeepWater = depth > 1.5;
        const isSubmerged = this.position.y < (waterHeight - 0.5);
        
        // Mode switch hysteresis or simple check?
        const isSwimming = isDeepWater && (this.position.y < waterHeight + 0.5);
        
        const speed = isSwimming ? this.swimSpeed : this.walkSpeed;
        const moveDir = new THREE.Vector3();

        // --- Movement Logic ---
        if (isSwimming) {
            // 3D Underwater Movement (Orientation based)
            // Get camera forward direction
            const camForward = new THREE.Vector3();
            camera.getWorldDirection(camForward);
            
            // Use local camera Right vector to avoid gimbal lock and inversion when looking down
            const camRight = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);

            if (this.keys.w) moveDir.add(camForward);
            if (this.keys.s) moveDir.sub(camForward);
            if (this.keys.d) moveDir.add(camRight);
            if (this.keys.a) moveDir.sub(camRight);

            // Vertical strafe
            if (this.keys.space) moveDir.y += 0.8; // Swim Up
            if (this.keys.shift) moveDir.y -= 0.8; // Swim Down

            if (moveDir.length() > 0) moveDir.normalize();

            // Apply movement
            this.position.addScaledVector(moveDir, speed * dt);
            
            // Clamp height (Don't fly out of water like Superman)
            if (this.position.y > waterHeight - 0.2 && !this.keys.space) {
                this.position.y = waterHeight - 0.2;
            }
            // Prevent going below terrain
            if (this.position.y < terrainHeight + 1.0) {
                this.position.y = terrainHeight + 1.0;
            }
            
            // --- Rotation Logic for Swimming ---
            // 1. Yaw (Player Rotation) - Face horizontal movement direction
            const flatDir = new THREE.Vector2(moveDir.x, moveDir.z);
            if (flatDir.length() > 0.1) {
                const targetRotation = Math.atan2(moveDir.x, moveDir.z);
                let rotDiff = targetRotation - this.rotation;
                while (rotDiff > Math.PI) rotDiff -= Math.PI * 2;
                while (rotDiff < -Math.PI) rotDiff += Math.PI * 2;
                this.rotation += rotDiff * 5 * dt;
            }

            // 2. Pitch (Body Tilt) - Dive up/down
            // Calculate pitch from moveDir.y
            // Base swimming is 90 degrees (Math.PI / 2)
            let targetPitch = Math.PI / 2; 
            
            if (moveDir.length() > 0.1) {
                // If moving down (y < 0), pitch should increase (head down)
                // If moving up (y > 0), pitch should decrease (head up)
                targetPitch -= moveDir.y * 1.0; 
            } else {
                 targetPitch = Math.PI / 2.5; // Idle float
            }
            
            this.bodyGroup.rotation.x = THREE.MathUtils.lerp(this.bodyGroup.rotation.x, targetPitch, 5 * dt);
            
        } else {
            // Standard Ground Movement
            const camAngleY = Math.atan2(
                camera.position.x - this.position.x, 
                camera.position.z - this.position.z
            ) + Math.PI; // Face away from camera effectively, or use controller yaw
            
            // Actually, better to use the camera's pure yaw
            const euler = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
            const yaw = euler.y;

            const forward = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
            const right = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);

            if (this.keys.w) moveDir.add(forward);
            if (this.keys.s) moveDir.sub(forward);
            if (this.keys.d) moveDir.add(right);
            if (this.keys.a) moveDir.sub(right);

            if (moveDir.length() > 0) moveDir.normalize();

            this.position.x += moveDir.x * speed * dt;
            this.position.z += moveDir.z * speed * dt;

            // Snap to ground
            this.position.y = terrainHeight + this.heightOffset;
            
            // Reset rotation
            this.bodyGroup.rotation.x = THREE.MathUtils.lerp(this.bodyGroup.rotation.x, 0, 10 * dt);
            this.bodyGroup.position.y = 0;
            
            // Face direction
            if (moveDir.length() > 0.1) {
                const targetRotation = Math.atan2(moveDir.x, moveDir.z);
                let rotDiff = targetRotation - this.rotation;
                while (rotDiff > Math.PI) rotDiff -= Math.PI * 2;
                while (rotDiff < -Math.PI) rotDiff += Math.PI * 2;
                this.rotation += rotDiff * 10 * dt;
            }
        }

        this.mesh.position.copy(this.position);
        this.mesh.rotation.y = this.rotation;

        this.animateLimbs(dt, moveDir.length() > 0.1, isSwimming);
    }

    animateLimbs(dt, isMoving, isSwimming) {
        // Reset all joints
        // Helper to reset
        const reset = (limb) => {
            limb.root.rotation.set(0,0,0);
            limb.joint.rotation.set(0,0,0);
        }

        if (isSwimming) {
            if (isMoving) {
                // Freestyle / Flutter kick
                this.animTime += dt * 10;
                
                // Arms: Windmill / Crawl
                // Left Arm
                const armLPhase = this.animTime;
                this.armL.root.rotation.x = Math.sin(armLPhase) * 2.5; // Big swing
                this.armL.root.rotation.z = Math.abs(Math.sin(armLPhase)) * 0.5 + 0.2; // Move out slightly
                this.armL.joint.rotation.x = -Math.max(0, Math.cos(armLPhase)) * 1.5; // Bend elbow on return

                // Right Arm (Opposite phase)
                const armRPhase = this.animTime + Math.PI;
                this.armR.root.rotation.x = Math.sin(armRPhase) * 2.5;
                this.armR.root.rotation.z = -(Math.abs(Math.sin(armRPhase)) * 0.5 + 0.2);
                this.armR.joint.rotation.x = -Math.max(0, Math.cos(armRPhase)) * 1.5;

                // Legs: Flutter Kick (Quick, small amplitude)
                const legSpeed = this.animTime * 1.5;
                this.legL.root.rotation.x = Math.sin(legSpeed) * 0.5;
                this.legL.joint.rotation.x = Math.sin(legSpeed - 0.5) * 0.3 + 0.3; // Slight knee bend

                this.legR.root.rotation.x = Math.sin(legSpeed + Math.PI) * 0.5;
                this.legR.joint.rotation.x = Math.sin(legSpeed + Math.PI - 0.5) * 0.3 + 0.3;

            } else {
                // Treading Water (Vertical-ish)
                this.animTime += dt * 3;

                // Arms sculling
                this.armL.root.rotation.x = 0.5; // Forward
                this.armL.root.rotation.z = 0.5 + Math.sin(this.animTime) * 0.3;
                this.armL.joint.rotation.x = -0.5; // Forearms angled

                this.armR.root.rotation.x = 0.5;
                this.armR.root.rotation.z = -0.5 - Math.sin(this.animTime) * 0.3;
                this.armR.joint.rotation.x = -0.5;

                // Legs eggbeater (cycling)
                this.legL.root.rotation.x = Math.sin(this.animTime) * 0.5;
                this.legL.root.rotation.z = Math.cos(this.animTime) * 0.3;
                this.legL.joint.rotation.x = 1.0;

                this.legR.root.rotation.x = Math.sin(this.animTime + Math.PI) * 0.5;
                this.legR.root.rotation.z = Math.cos(this.animTime + Math.PI) * 0.3;
                this.legR.joint.rotation.x = 1.0;
            }
        } else if (isMoving) {
            // Walking
            this.animTime += dt * 10;

            // Arms (Opposite to legs)
            this.armL.root.rotation.x = Math.cos(this.animTime) * 0.6;
            this.armL.root.rotation.z = 0.1;
            this.armL.joint.rotation.x = -0.4 - Math.sin(this.animTime) * 0.2; // Slight elbow bend

            this.armR.root.rotation.x = Math.cos(this.animTime + Math.PI) * 0.6;
            this.armR.root.rotation.z = -0.1;
            this.armR.joint.rotation.x = -0.4 - Math.sin(this.animTime + Math.PI) * 0.2;

            // Legs
            // Hip
            this.legL.root.rotation.x = Math.sin(this.animTime) * 0.8;
            this.legR.root.rotation.x = Math.sin(this.animTime + Math.PI) * 0.8;
            
            // Knee (Only bends back when lifting)
            // If sin > 0 (leg moving forward), knee straight. If sin < 0 (leg moving back/up), knee bend.
            // Actually, in walk cycle:
            // Forward swing: Knee straight
            // Backward push: Knee straight
            // Recovery (passing under): Knee bent
            const kneeL = Math.sin(this.animTime - 1.5); 
            const kneeR = Math.sin(this.animTime + Math.PI - 1.5);
            
            this.legL.joint.rotation.x = kneeL > 0 ? kneeL * 1.5 : 0;
            this.legR.joint.rotation.x = kneeR > 0 ? kneeR * 1.5 : 0;

        } else {
            // Idle
            const s = Math.sin(Date.now() * 0.003);
            this.armL.root.rotation.z = 0.1 + s * 0.02;
            this.armR.root.rotation.z = -0.1 - s * 0.02;
            this.armL.root.rotation.x = 0;
            this.armR.root.rotation.x = 0;
            
            this.legL.root.rotation.set(0,0,0);
            this.legR.root.rotation.set(0,0,0);
            this.legL.joint.rotation.set(0,0,0);
            this.legR.joint.rotation.set(0,0,0);
            
            // Breathing
            this.torso.rotation.x = s * 0.05;
        }
    }

    getForward() {
        return this.rotation;
    }
}