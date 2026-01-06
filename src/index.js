/**
 * SSE (Server-Sent Events) Server with Redis Pub/Sub
 * Main Express application
 */

require('dotenv').config();
const express = require('express');
const path = require('path');
const connectionRegistry = require('./connection-registry');
const RedisSubscriber = require('./redis-subscriber');

// Configuration
const PORT = process.env.PORT || 3000;
const POD_NAME = process.env.POD_NAME || 'local-pod';
const NODE_ENV = process.env.NODE_ENV || 'development';

const redisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT) || 6379,
  channel: process.env.REDIS_CHANNEL || 'events-to-store'
};

// Initialize Express app
const app = express();
app.use(express.json());

// Initialize Redis subscriber
const redisSubscriber = new RedisSubscriber({ ...redisConfig, podName: POD_NAME });

// Server start time
const serverStartTime = new Date();
let server;

/**
 * POST /register
 * Client registration endpoint
 * Validates client name before allowing SSE connection
 */
app.post('/register', (req, res) => {
  const { clientName } = req.body;

  if (!clientName) {
    return res.status(400).json({ 
      error: 'clientName is required',
      success: false 
    });
  }

  // Validate client name format
  if (!/^[a-zA-Z0-9_-]+$/.test(clientName)) {
    return res.status(400).json({ 
      error: 'clientName must contain only alphanumeric characters, underscores, and hyphens',
      success: false 
    });
  }

  console.log(`[REGISTRY][${POD_NAME}] Registration request received for ${clientName} (no state stored; actual registration happens on SSE connect)`);

  res.json({
    success: true,
    clientName,
    podName: POD_NAME,
    message: `Client ${clientName} registered. Connect to /events/${clientName} for SSE stream`,
    timestamp: new Date().toISOString()
  });
});

/**
 * GET /events/:clientName
 * SSE endpoint - establishes persistent connection
 */
app.get('/events/:clientName', (req, res) => {
  const { clientName } = req.params;

  console.log(`[SSE][${POD_NAME}] New SSE connection request for ${clientName}`);

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
  
  // Enable CORS for development
  res.setHeader('Access-Control-Allow-Origin', '*');

  // Send initial connection confirmation
  try {
    res.write(`: Connected to ${POD_NAME}\n\n`);
    res.write(`data: ${JSON.stringify({
      type: 'connected',
      clientName,
      podName: POD_NAME,
      timestamp: new Date().toISOString(),
      message: 'SSE connection established'
    })}\n\n`);
  } catch (err) {
    console.log(`[SSE] Error sending initial message to ${clientName}:`, err.message);
    return;
  }

  // Register connection
  connectionRegistry.register(clientName, res, POD_NAME);
});

/**
 * GET /health
 * Health check endpoint with pod statistics
 */
app.get('/health', (req, res) => {
  const uptime = Math.floor((Date.now() - serverStartTime.getTime()) / 1000);
  const redisStatus = redisSubscriber.getStatus();

  res.json({
    status: 'healthy',
    podName: POD_NAME,
    uptime,
    connections: connectionRegistry.count(),
    redis: redisStatus,
    timestamp: new Date().toISOString(),
    environment: NODE_ENV
  });
});

/**
 * GET /admin/connections
 * List all active connections
 */
app.get('/admin/connections', (req, res) => {
  const connections = connectionRegistry.getAll();

  res.json({
    podName: POD_NAME,
    totalConnections: connections.length,
    connections,
    timestamp: new Date().toISOString()
  });
});

/**
 * GET /admin/client/:clientName
 * Get specific client connection info
 */
app.get('/admin/client/:clientName', (req, res) => {
  const { clientName } = req.params;

  if (!connectionRegistry.has(clientName)) {
    return res.status(404).json({
      error: 'Client not found on this pod',
      clientName,
      podName: POD_NAME
    });
  }

  const connection = connectionRegistry.get(clientName);
  const stats = connection.getStats();

  res.json({
    found: true,
    podName: POD_NAME,
    client: stats,
    timestamp: new Date().toISOString()
  });
});

/**
 * GET /
 * Serve test client HTML
 */
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'test-client.html'));
});

/**
 * GET /admin
 * Admin dashboard - list all connections
 */
app.get('/admin', (req, res) => {
  const connections = connectionRegistry.getAll();
  const redisStatus = redisSubscriber.getStatus();

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>SSE Admin Dashboard</title>
    <style>
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
            background: #f5f5f5;
        }
        h1 { color: #333; }
        .status {
            background: white;
            padding: 20px;
            border-radius: 8px;
            margin-bottom: 20px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .stat {
            display: inline-block;
            margin-right: 30px;
            margin-bottom: 10px;
        }
        .stat-label {
            font-weight: bold;
            color: #666;
        }
        .stat-value {
            color: #0066cc;
            font-size: 1.2em;
        }
        .connections {
            background: white;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        table {
            width: 100%;
            border-collapse: collapse;
        }
        th, td {
            padding: 12px;
            text-align: left;
            border-bottom: 1px solid #ddd;
        }
        th {
            background: #f8f8f8;
            font-weight: bold;
        }
        .badge {
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 0.85em;
            font-weight: bold;
        }
        .badge-success { background: #d4edda; color: #155724; }
        .badge-danger { background: #f8d7da; color: #721c24; }
        button {
            background: #0066cc;
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
        }
        button:hover { background: #0052a3; }
    </style>
</head>
<body>
    <h1>SSE Admin Dashboard</h1>
    
    <div class="status">
        <h2>Server Status</h2>
        <div class="stat">
            <div class="stat-label">Pod Name:</div>
            <div class="stat-value">${POD_NAME}</div>
        </div>
        <div class="stat">
            <div class="stat-label">Active Connections:</div>
            <div class="stat-value">${connections.length}</div>
        </div>
        <div class="stat">
            <div class="stat-label">Redis:</div>
            <div class="stat-value">
                <span class="badge ${redisStatus.connected ? 'badge-success' : 'badge-danger'}">
                    ${redisStatus.connected ? 'Connected' : 'Disconnected'}
                </span>
            </div>
        </div>
        <div class="stat">
            <div class="stat-label">Channel:</div>
            <div class="stat-value">${redisStatus.channel}</div>
        </div>
        <button onclick="location.reload()">Refresh</button>
    </div>

    <div class="connections">
        <h2>Active Connections</h2>
        ${connections.length === 0 ? '<p>No active connections</p>' : `
        <table>
            <thead>
                <tr>
                    <th>Client Name</th>
                    <th>Pod</th>
                    <th>Connected At</th>
                    <th>Last Activity</th>
                    <th>Events</th>
                    <th>Uptime (s)</th>
                    <th>Status</th>
                </tr>
            </thead>
            <tbody>
                ${connections.map(conn => `
                <tr>
                    <td><strong>${conn.clientName}</strong></td>
                    <td>${conn.podName}</td>
                    <td>${new Date(conn.connectedAt).toLocaleTimeString()}</td>
                    <td>${new Date(conn.lastActivity).toLocaleTimeString()}</td>
                    <td>${conn.eventCount}</td>
                    <td>${conn.uptime}</td>
                    <td>
                        <span class="badge ${conn.isAlive ? 'badge-success' : 'badge-danger'}">
                            ${conn.isAlive ? 'Alive' : 'Dead'}
                        </span>
                    </td>
                </tr>
                `).join('')}
            </tbody>
        </table>
        `}
    </div>

    <script>
        // Auto-refresh every 5 seconds
        setTimeout(() => location.reload(), 5000);
    </script>
</body>
</html>
  `;

  res.send(html);
});

/**
 * 404 handler
 */
app.use((req, res) => {
  res.status(404).json({
    error: 'Not found',
    path: req.path,
    podName: POD_NAME
  });
});

/**
 * Error handler
 */
app.use((err, req, res, next) => {
  console.log(`[ERROR] ${err.message}`);
  res.status(500).json({
    error: 'Internal server error',
    message: err.message,
    podName: POD_NAME
  });
});

/**
 * Graceful shutdown handler
 */
async function gracefulShutdown(signal) {
  console.log(`\n[SHUTDOWN] Received ${signal}, starting graceful shutdown...`);

  // Stop accepting new connections
  if (server) {
    server.close(() => {
      console.log('[SHUTDOWN] HTTP server closed');
    });
  }

  // Close all SSE connections
  connectionRegistry.closeAll();

  // Disconnect from Redis
  await redisSubscriber.disconnect();

  console.log('[SHUTDOWN] Graceful shutdown completed');
  process.exit(0);
}

// Register shutdown handlers
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

/**
 * Start server
 */
async function start() {
  try {
    // Connect to Redis
    await redisSubscriber.connect();

    // Start HTTP server
    server = app.listen(PORT, () => {
      console.log(`[SERVER] SSE Server started on port ${PORT}`);
      console.log(`[SERVER] Pod name: ${POD_NAME}`);
      console.log(`[SERVER] Environment: ${NODE_ENV}`);
      console.log(`[SERVER] Redis: ${redisConfig.host}:${redisConfig.port}`);
      console.log(`[SERVER] Channel: ${redisConfig.channel}`);
      console.log(`[SERVER] Test client: http://localhost:${PORT}`);
      console.log(`[SERVER] Admin dashboard: http://localhost:${PORT}/admin`);
    });

    // Make server available to shutdown handler
    global.server = server;

  } catch (err) {
    console.log('[ERROR] Failed to start server:', err.message);
    process.exit(1);
  }
}

// Start the server
start();
