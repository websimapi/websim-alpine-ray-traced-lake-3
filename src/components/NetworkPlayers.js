import * as THREE from 'three';
import { Player } from './Player.js';

export class NetworkPlayers {
    constructor(scene, room) {
        this.scene = scene;
        this.room = room;
        this.players = new Map(); // clientId -> Player instance
        this.lastUpdate = 0;
    }

    update(dt) {
        // 1. Manage Peers
        const peers = this.room.peers;
        const connectedIds = new Set(Object.keys(peers));
        
        // Remove disconnected
        for (const [id, player] of this.players) {
            if (!connectedIds.has(id) || id === this.room.clientId) {
                this.scene.remove(player.mesh);
                this.players.delete(id);
            }
        }

        // Add new / Update existing
        for (const id of connectedIds) {
            if (id === this.room.clientId) continue; // Skip self

            let remotePlayer = this.players.get(id);
            
            // Spawn if new
            if (!remotePlayer) {
                remotePlayer = new Player(this.scene, true); // true = isRemote
                // Add nametag? 
                this.players.set(id, remotePlayer);
            }

            // Get data from presence (Column 1 as requested)
            const presence = this.room.presence[id];
            if (presence && presence.column1) {
                remotePlayer.updateRemote(dt, presence.column1);
            }
        }
    }
}