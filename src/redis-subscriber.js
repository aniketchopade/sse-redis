/**
 * Redis Subscriber
 * Subscribes to Redis Pub/Sub and routes messages to SSE connections
 */

const Redis = require('ioredis');
const connectionRegistry = require('./connection-registry');

class RedisSubscriber {
  constructor(config) {
    this.config = config;
    this.subscriber = null;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.podName = config.podName || process.env.POD_NAME || 'local-pod';
  }

  /**
   * Initialize Redis subscriber with reconnection logic
   */
  async connect() {
    try {
      console.log(`[REDIS][${this.podName}] Connecting to Redis at ${this.config.host}:${this.config.port}`);
      
      this.subscriber = new Redis({
        host: this.config.host,
        port: this.config.port,
        retryStrategy: (times) => {
          if (times > this.maxReconnectAttempts) {
            console.log(`[REDIS] Max reconnection attempts reached`);
            return null;
          }
          const delay = Math.min(times * 100, 2000);
          console.log(`[REDIS] Reconnecting in ${delay}ms (attempt ${times})`);
          return delay;
        },
        reconnectOnError: (err) => {
          console.log(`[REDIS] Reconnect on error:`, err.message);
          return true;
        }
      });

      // Connection events
      this.subscriber.on('connect', () => {
        console.log(`[REDIS][${this.podName}] Connected to Redis`);
        this.isConnected = true;
        this.reconnectAttempts = 0;
      });

      this.subscriber.on('ready', () => {
        console.log(`[REDIS][${this.podName}] Redis client ready`);
      });

      this.subscriber.on('error', (err) => {
        console.log(`[REDIS][${this.podName}] Error:`, err.message);
        this.isConnected = false;
      });

      this.subscriber.on('close', () => {
        console.log(`[REDIS][${this.podName}] Connection closed`);
        this.isConnected = false;
      });

      this.subscriber.on('reconnecting', () => {
        this.reconnectAttempts++;
        console.log(`[REDIS][${this.podName}] Reconnecting... (attempt ${this.reconnectAttempts})`);
      });

      // Subscribe to channel
      await this.subscriber.subscribe(this.config.channel);
      console.log(`[REDIS][${this.podName}] Subscribed to channel: ${this.config.channel}`);

      // Handle incoming messages
      this.subscriber.on('message', (channel, message) => {
        this.handleMessage(channel, message);
      });

      return true;
    } catch (err) {
      console.log(`[REDIS][${this.podName}] Failed to connect:`, err.message);
      this.isConnected = false;
      return false;
    }
  }

  /**
   * Handle incoming Redis messages
   * Parse JSON and route to appropriate SSE connection
   */
  handleMessage(channel, message) {
    try {
      console.log(`[REDIS][${this.podName}] Received message on ${channel}:`, message);

      // Parse message
      const event = JSON.parse(message);
      
      // Validate message structure
      if (!event.clientName) {
        console.log(`[REDIS][${this.podName}] Invalid message: missing clientName`);
        return;
      }

      // Route to specific client
      this.routeToClient(event);

    } catch (err) {
      console.log(`[REDIS][${this.podName}] Error handling message:`, err.message);
    }
  }

  /**
   * Route event to specific SSE connection
   * With write failure detection
   */
  routeToClient(event) {
    const { clientName } = event;

    // Check if client is connected
    if (!connectionRegistry.has(clientName)) {
      console.log(`[REDIS][${this.podName}] Client ${clientName} not on this pod (${this.podName}) - ignoring`);
      return;
    }

    // Get connection
    const connection = connectionRegistry.get(clientName);
    if (!connection) {
      console.log(`[REDIS][${this.podName}] Connection not found for ${clientName}`);
      return;
    }

    // Send event with write failure detection
    const success = connection.sendEvent(event);
    
    if (!success) {
      console.log(`[REDIS][${this.podName}] Failed to send event to ${clientName}, connection may be broken`);
    } else {
      console.log(`[SSE][${this.podName}] ✅ Event sent to ${clientName} on pod ${this.podName}`);
    }
  }

  /**
   * Publish a test message (used for testing)
   */
  async publish(message) {
    if (!this.isConnected) {
      throw new Error('Redis not connected');
    }

    const messageStr = typeof message === 'string' ? message : JSON.stringify(message);
    const receivers = await this.subscriber.publish(this.config.channel, messageStr);
    console.log(`[REDIS][${this.podName}] Published message to ${this.config.channel} (subscribers: ${receivers})`);
  }

  /**
   * Get connection status
   */
  getStatus() {
    return {
      connected: this.isConnected,
      channel: this.config.channel,
      host: this.config.host,
      port: this.config.port,
      reconnectAttempts: this.reconnectAttempts
    };
  }

  /**
   * Disconnect from Redis
   */
  async disconnect() {
    if (this.subscriber) {
      console.log(`[REDIS][${this.podName}] Disconnecting from Redis`);
      await this.subscriber.quit();
      this.subscriber = null;
      this.isConnected = false;
    }
  }
}

module.exports = RedisSubscriber;
