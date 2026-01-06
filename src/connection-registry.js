/**
 * Connection Registry
 * Purely local (per-pod) in-memory registry with heartbeat and cleanup
 */

const POD_NAME = process.env.POD_NAME || 'local-pod';

class ConnectionEntry {
  constructor(clientName, response, podName, registry) {
    this.clientName = clientName;
    this.response = response;
    this.podName = podName;
    this.registry = registry;
    this.connectedAt = new Date();
    this.lastActivity = new Date();
    this.heartbeatInterval = null;
    this.eventCount = 0;
    this.isAlive = true;

    this.setupDisconnectHandlers();
    this.startHeartbeat();
  }

  /**
   * Strategy 1: Immediate Detection
   * Listen for disconnect events on request and response
   */
  setupDisconnectHandlers() {
    const cleanup = () => {
      if (this.isAlive) {
        console.log(`[DISCONNECT][${POD_NAME}] Client ${this.clientName} disconnected (event handler)`);
        this.close();
      }
    };

    // Request events
    this.response.req.on('close', cleanup);
    this.response.req.on('error', (err) => {
      console.log(`[DISCONNECT][${POD_NAME}] Client ${this.clientName} request error:`, err.message);
      cleanup();
    });

    // Response events
    this.response.on('error', (err) => {
      console.log(`[DISCONNECT][${POD_NAME}] Client ${this.clientName} response error:`, err.message);
      cleanup();
    });

    this.response.on('finish', cleanup);
  }

  /**
   * Strategy 2: Heartbeat
   * Send periodic heartbeat messages to detect broken connections
   */
  startHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      if (!this.isAlive) {
        return;
      }

      try {
        const heartbeatMsg = `: heartbeat ${new Date().toISOString()}\n\n`;
        const success = this.response.write(heartbeatMsg);
        
        if (!success) {
          console.log(`[HEARTBEAT][${POD_NAME}] Failed to write heartbeat to ${this.clientName}`);
          this.close();
        } else {
          console.log(`[HEARTBEAT][${POD_NAME}] Sent to ${this.clientName}`);
        }
      } catch (err) {
        console.log(`[HEARTBEAT][${POD_NAME}] Error sending to ${this.clientName}:`, err.message);
        this.close();
      }
    }, 30000); // 30 seconds
  }

  /**
   * Strategy 3: Write Failure Detection
   * Check return value and catch errors on every write
   */
  sendEvent(event) {
    if (!this.isAlive) {
      console.log(`[SSE][${POD_NAME}] Cannot send to ${this.clientName}: connection is dead`);
      return false;
    }

    try {
      const message = `data: ${JSON.stringify(event)}\n\n`;
      const success = this.response.write(message);
      
      if (!success) {
        console.log(`[SSE][${POD_NAME}] Write failed for ${this.clientName}, closing connection`);
        this.close();
        return false;
      }

      this.eventCount++;
      this.lastActivity = new Date();
      console.log(`[SSE][${POD_NAME}] ✅ Event #${this.eventCount} sent to ${this.clientName} (${event.action || 'event'})`);
      return true;
    } catch (err) {
      console.log(`[SSE][${POD_NAME}] Error writing to ${this.clientName}:`, err.message);
      this.close();
      return false;
    }
  }

  updateActivity() {
    this.lastActivity = new Date();
  }

  getStats() {
    return {
      clientName: this.clientName,
      podName: this.podName,
      connectedAt: this.connectedAt.toISOString(),
      lastActivity: this.lastActivity.toISOString(),
      eventCount: this.eventCount,
      isAlive: this.isAlive,
      uptime: Math.floor((Date.now() - this.connectedAt.getTime()) / 1000)
    };
  }

  close() {
    if (!this.isAlive) {
      return; // Already closed
    }

    console.log(`[DISCONNECT][${POD_NAME}] Closing connection for ${this.clientName}`);
    this.isAlive = false;

    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    try {
      this.response.end();
    } catch (err) {
      console.log(`[DISCONNECT][${POD_NAME}] Error ending response for ${this.clientName}:`, err.message);
    }

    // Remove from registry
    if (this.registry) {
      this.registry.remove(this.clientName);
    }
  }
}

/**
 * Connection Registry
 * Centralized management of all SSE connections
 */
class ConnectionRegistry {
  constructor() {
    this.connections = new Map();
  }

  /**
   * Strategy 4: Forced Eviction
   * When a new connection arrives with the same clientName, close the old one
   */
  register(clientName, response, podName) {
    // Check if connection already exists
    if (this.connections.has(clientName)) {
      console.log(`[REGISTRY][${POD_NAME}] Forced eviction: ${clientName} already connected, closing old connection`);
      const oldConnection = this.connections.get(clientName);
      oldConnection.close();
      this.connections.delete(clientName);
    }

    const connection = new ConnectionEntry(clientName, response, podName, this);
    this.connections.set(clientName, connection);

    console.log(`[REGISTRY][${POD_NAME}] ✅ Registered ${clientName} on pod ${podName} (Total: ${this.connections.size})`);
    
    return connection;
  }

  get(clientName) {
    return this.connections.get(clientName);
  }

  has(clientName) {
    return this.connections.has(clientName);
  }

  remove(clientName) {
    const existed = this.connections.delete(clientName);
    if (existed) {
      console.log(`[REGISTRY][${POD_NAME}] Removed ${clientName}. Total connections: ${this.connections.size}`);
    }
    return existed;
  }

  updateActivity(clientName) {
    const connection = this.connections.get(clientName);
    if (connection) {
      connection.updateActivity();
    }
  }

  count() {
    return this.connections.size;
  }

  getAll() {
    const stats = [];
    for (const [clientName, connection] of this.connections.entries()) {
      stats.push(connection.getStats());
    }
    return stats;
  }

  closeAll() {
    console.log(`[REGISTRY][${POD_NAME}] Closing all ${this.connections.size} connections`);
    for (const connection of this.connections.values()) {
      try {
        connection.close();
      } catch (err) {
        console.log(`[REGISTRY][${POD_NAME}] Error closing connection:`, err.message);
      }
    }
    this.connections.clear();
  }
}

// Export singleton instance
module.exports = new ConnectionRegistry();
