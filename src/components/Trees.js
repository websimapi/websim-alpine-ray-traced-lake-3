import * as THREE from 'three';

export class Trees {
    constructor(scene, terrainMesh) {
        this.scene = scene;
        this.terrainMesh = terrainMesh;
        this.count = 2000;
        this.dummy = new THREE.Object3D();
    }

    generate() {
        if (!this.terrainMesh || !this.terrainMesh.geometry) return;

        // Simple Pine Tree Geometry
        // Merged geometry for better performance
        const trunkGeo = new THREE.CylinderGeometry(0.5, 1, 4, 6);
        trunkGeo.translate(0, 2, 0);
        const leavesGeo = new THREE.ConeGeometry(3, 10, 8);
        leavesGeo.translate(0, 9, 0);

        // Materials
        const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3c31, roughness: 0.9 });
        const leavesMat = new THREE.MeshStandardMaterial({ color: 0x1a331a, roughness: 0.8 });

        // Instanced Meshes
        this.trunkMesh = new THREE.InstancedMesh(trunkGeo, trunkMat, this.count);
        this.leavesMesh = new THREE.InstancedMesh(leavesGeo, leavesMat, this.count);
        
        this.trunkMesh.castShadow = true;
        this.trunkMesh.receiveShadow = true;
        this.leavesMesh.castShadow = true;
        this.leavesMesh.receiveShadow = true;

        const posAttribute = this.terrainMesh.geometry.attributes.position;
        const normalAttribute = this.terrainMesh.geometry.attributes.normal;
        
        let instanceIndex = 0;
        const vertex = new THREE.Vector3();
        const normal = new THREE.Vector3();
        const worldPos = new THREE.Vector3();

        // Randomly place trees
        for (let i = 0; i < this.count; i++) {
            // Pick a random vertex index
            const index = Math.floor(Math.random() * posAttribute.count);
            
            vertex.fromBufferAttribute(posAttribute, index);
            normal.fromBufferAttribute(normalAttribute, index);
            
            // Transform to world space (though terrain is at 0,0,0, checking just in case)
            worldPos.copy(vertex);
            
            // Rules for tree placement:
            // 1. Not underwater (y > 1)
            // 2. Not too high (y < 200)
            // 3. Not on steep slopes (normal.y must be close to 1)
            
            const slope = 1.0 - normal.y;
            
            if (worldPos.y > 2 && worldPos.y < 250 && slope < 0.3) {
                // Good spot
                
                // Position
                this.dummy.position.copy(worldPos);
                
                // Scale variation
                const scale = 0.8 + Math.random() * 0.6;
                this.dummy.scale.set(scale, scale, scale);
                
                // Random rotation
                this.dummy.rotation.y = Math.random() * Math.PI * 2;
                
                this.dummy.updateMatrix();
                
                this.trunkMesh.setMatrixAt(instanceIndex, this.dummy.matrix);
                this.leavesMesh.setMatrixAt(instanceIndex, this.dummy.matrix);
                
                instanceIndex++;
            }
        }
        
        // Hide unused instances
        this.trunkMesh.count = instanceIndex;
        this.leavesMesh.count = instanceIndex;

        this.scene.add(this.trunkMesh);
        this.scene.add(this.leavesMesh);
    }
}