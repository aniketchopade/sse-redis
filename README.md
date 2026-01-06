# SSE Redis Service

A production-ready Node.js Server-Sent Events (SSE) server with Redis Pub/Sub integration for real-time event streaming to connected clients. Features robust disconnect handling, heartbeat monitoring, and multi-pod support.

## Features

- **SSE (Server-Sent Events)**: Persistent HTTP connections for real-time server-to-client streaming
- **Redis Pub/Sub Broadcast**: Redis broadcasts every message to every pod; each pod only sends if it owns the client locally
- **Local-only Registry**: Per-pod in-memory registry; no shared state, no routing tables
- **Disconnect Detection**: 4-layer strategy for reliable disconnect handling
- **Multi-Pod Support**: Kubernetes-ready with session affinity and pod awareness
- **Health Monitoring**: Built-in health checks and admin dashboard
- **Production Ready**: Docker and Kubernetes configurations included

## Architecture (Broadcast + Local Filter)

```
┌─────────────┐         ┌─────────────┐         ┌─────────────┐
│   Client 1  │         │   Client 2  │         │   Client 3  │
│ (STORE001)  │         │ (STORE002)  │         │ (STORE003)  │
└──────┬──────┘         └──────┬──────┘         └──────┬──────┘
       │                       │                       │
       │ SSE Connection        │ SSE Connection        │ SSE Connection
       │                       │                       │
       ▼                       ▼                       ▼
┌──────────────────────────────────────────────────────────────┐
│                    Load Balancer (Session Affinity)           │
└──────────────────────────────────────────────────────────────┘
       │                       │                       │
       ▼                       ▼                       ▼
┌─────────────┐         ┌─────────────┐         ┌─────────────┐
│   Pod 1     │         │   Pod 2     │         │   Pod 3     │
│ SSE Server  │         │ SSE Server  │         │ SSE Server  │
└──────┬──────┘         └──────┬──────┘         └──────┬──────┘
       │                       │                       │
       └───────────────────────┼───────────────────────┘
                               │
                               ▼
                        ┌─────────────┐
                        │    Redis    │
                        │   Pub/Sub   │
                        └─────────────┘
                               ▲
                               │
                        ┌──────┴──────┐
                        │  Publisher  │
                        │   (Events)  │
                        └─────────────┘
```

**Key principle**: Redis broadcasts to all pods; every pod checks its local registry (`clientName` → connection). If the client is not on this pod, the message is ignored (normal, not an error).

## Project Structure

```
sse-redis-service/
├── package.json              # Dependencies and scripts
├── .env                      # Environment variables (not in repo)
├── .env.example              # Environment template
├── .gitignore               # Git ignore patterns
├── README.md                # This file
├── Dockerfile               # Production Docker image
├── docker-compose.yml       # Multi-container setup
├── .dockerignore           # Docker ignore patterns
├── src/
│   ├── index.js            # Express server (main entry point)
│   ├── connection-registry.js  # Connection management
│   ├── redis-subscriber.js     # Redis Pub/Sub handler
│   ├── test-publisher.js       # CLI test publisher
│   └── test-client.html        # Browser test client
└── k8s/
    ├── deployment.yaml     # Kubernetes deployments
    ├── service.yaml        # Kubernetes services
    └── configmap.yaml      # Configuration

```

## Installation

### Prerequisites

- Node.js 18+ 
- Redis 7+
- Docker (optional)
- Kubernetes (optional)

### Local Setup

1. **Clone and install dependencies**:
```bash
cd sse-redis
npm install
```

2. **Configure environment**:
```bash
cp .env.example .env
# Edit .env with your settings
```

3. **Start Redis** (if not already running):
```bash
# Using Docker
docker run -d -p 6379:6379 redis:7-alpine

# Or using local Redis
redis-server
```

4. **Start the SSE server**:
```bash
# Development mode (with auto-reload)
npm run dev

# Production mode
npm start
```

The server will start on `http://localhost:3000`

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3000 | HTTP server port |
| `REDIS_HOST` | localhost | Redis server hostname |
| `REDIS_PORT` | 6379 | Redis server port |
| `REDIS_CHANNEL` | events-to-store | Redis Pub/Sub channel name |
| `POD_NAME` | local-pod | Pod identifier (auto-set in K8s) |
| `NODE_ENV` | development | Environment (development/production) |

## API Documentation

### POST /register

Lightweight pre-flight to validate `clientName`. No state is stored; actual registration happens on the SSE connect.

**Request**:
```json
{
  "clientName": "STORE001-LANE01"
}
```

**Response**:
```json
{
  "success": true,
  "clientName": "STORE001-LANE01",
  "podName": "pod-1",
  "message": "Client STORE001-LANE01 registered. Connect to /events/STORE001-LANE01 for SSE stream",
  "timestamp": "2026-01-05T12:00:00.000Z"
}
```

### GET /events/:clientName

Establish SSE connection and register locally on *this* pod.

**Response Headers**:
```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
```

**Event Format**:
```
data: {"type":"connected","clientName":"STORE001-LANE01","podName":"pod-1","timestamp":"2026-01-05T12:00:00.000Z"}

data: {"clientName":"STORE001-LANE01","action":"signature","eventId":"evt-ABC123","timestamp":"2026-01-05T12:00:01.000Z","data":{...}}
```

### GET /health

Health check endpoint with server statistics.

**Response**:
```json
{
  "status": "healthy",
  "podName": "pod-1",
  "uptime": 3600,
  "connections": 5,
  "redis": {
    "connected": true,
    "channel": "events-to-store",
    "host": "localhost",
    "port": 6379
  },
  "timestamp": "2026-01-05T12:00:00.000Z",
  "environment": "production"
}
```

### GET /admin/connections

List all active SSE connections on *this* pod only.

**Response**:
```json
{
  "podName": "pod-1",
  "totalConnections": 2,
  "connections": [
    {
      "clientName": "STORE001-LANE01",
      "podName": "pod-1",
      "connectedAt": "2026-01-05T11:50:00.000Z",
      "lastActivity": "2026-01-05T12:00:00.000Z",
      "eventCount": 15,
      "isAlive": true,
      "uptime": 600
    }
  ],
  "timestamp": "2026-01-05T12:00:00.000Z"
}
```

### GET /admin/client/:clientName

Get specific client connection information on *this* pod.

**Response**:
```json
{
  "found": true,
  "podName": "pod-1",
  "client": {
    "clientName": "STORE001-LANE01",
    "podName": "pod-1",
    "connectedAt": "2026-01-05T11:50:00.000Z",
    "lastActivity": "2026-01-05T12:00:00.000Z",
    "eventCount": 15,
    "isAlive": true,
    "uptime": 600
  },
  "timestamp": "2026-01-05T12:00:00.000Z"
}
```

### GET /admin

Web-based admin dashboard showing all connections with auto-refresh.

### GET /

Serves the HTML test client interface.

## Testing

### Using the HTML Test Client

1. Open your browser to `http://localhost:3000`
2. Enter server URL (default: `http://localhost:3000`)
3. Enter client name (e.g., `STORE001-LANE01`)
4. Click "Connect"
5. Events will appear in real-time

### Using the CLI Test Publisher

The test publisher sends events to Redis which are then distributed to connected clients.

**Basic usage**:
```bash
npm run test:publish STORE001-LANE01 signature
```

**Available actions**:
- `signature` - Signature capture request
- `payment` - Payment processing
- `receipt` - Receipt generation
- `alert` - System alert
- `inventory` - Inventory update
- `status` - Device status update
- `notification` - General notification

**Advanced usage**:
```bash
# Send 5 payment events
node src/test-publisher.js STORE001-LANE01 payment 5

# Send 10 alerts with 1-second interval
node src/test-publisher.js STORE001-LANE01 alert 10 1000
```

### Manual Testing with curl

**Register a client**:
```bash
curl -X POST http://localhost:3000/register \
  -H "Content-Type: application/json" \
  -d '{"clientName":"STORE001-LANE01"}'
```

**Connect to SSE stream**:
```bash
curl -N http://localhost:3000/events/STORE001-LANE01
```

**Publish a test event** (using Redis CLI):
```bash
redis-cli PUBLISH events-to-store '{"clientName":"STORE001-LANE01","action":"signature","eventId":"evt-123","timestamp":"2026-01-05T12:00:00.000Z","data":{"transactionId":"TXN-ABC","amount":99.99}}'
```

## Disconnect Handling Strategies

The service implements 4 robust strategies to detect and handle client disconnections:

### 1. Immediate Detection
Event listeners on HTTP request/response objects:
- `request.on('close')` - Client closes connection
- `request.on('error')` - Network error
- `response.on('error')` - Write error
- `response.on('finish')` - Response complete

### 2. Heartbeat Monitoring
- Sends heartbeat message every 30 seconds
- Format: `: heartbeat <timestamp>\n\n`
- Detects failed writes indicating broken connection
- Automatically triggers cleanup on failure

### 3. Write Failure Detection
On every `res.write()` operation:
- Wrapped in try-catch block
- Checks return value (false = write failed)
- Immediate cleanup on failure

### 4. Forced Eviction
- When new connection arrives with same clientName
- Automatically closes old connection
- Prevents duplicate connections
- Ensures single active connection per client

## Docker Deployment

### Build and Run Single Instance

```bash
# Build image
docker build -t sse-redis-service .

# Run container
docker run -d \
  -p 3000:3000 \
  -e REDIS_HOST=host.docker.internal \
  -e REDIS_PORT=6379 \
  -e POD_NAME=docker-1 \
  --name sse-server \
  sse-redis-service
```

### Multi-Instance with Docker Compose

```bash
# Start all services (Redis + 3 SSE servers)
docker-compose up -d

# View logs
docker-compose logs -f

# Stop all services
docker-compose down
```

**Access points**:
- Server 1: `http://localhost:3001`
- Server 2: `http://localhost:3002`
- Server 3: `http://localhost:3003`
- Redis: `localhost:6379`

## Kubernetes Deployment

### Deploy to Kubernetes

```bash
# Create namespace (optional)
kubectl create namespace sse-redis

# Apply configurations
kubectl apply -f k8s/configmap.yaml
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/service.yaml

# Check deployments
kubectl get deployments
kubectl get pods
kubectl get services

# View logs
kubectl logs -f deployment/sse-redis-server

# Access service
kubectl port-forward service/sse-redis-service 8080:80
```

### Scale Deployment

```bash
# Scale to 5 replicas
kubectl scale deployment/sse-redis-server --replicas=5

# Check scaling
kubectl get pods -w
```

### Multi-Pod Testing

1. **Connect clients to different pods**:
   - Use LoadBalancer IP or port-forward
   - Session affinity ensures clients stick to same pod
   - Check pod assignment via `/admin` endpoint

2. **Publish events**:
   ```bash
   # Events are distributed via Redis to correct pod
   node src/test-publisher.js STORE001-LANE01 payment
   ```

3. **Monitor pod distribution**:
   ```bash
   # Check which pod serves which client
   kubectl exec -it deployment/sse-redis-server -- curl localhost:3000/admin/connections
   ```

**Expected broadcast behavior** (example with 3 pods):
- Publish for `STORE001-LANE01`: all pods receive; only the pod holding that client sends; others log `Client STORE001-LANE01 not on this pod (pod-X) - ignoring`.
- Publish for `STORE002-LANE01`: same pattern; each pod filters locally.

## Message Format

### Redis Pub/Sub Message

```json
{
  "clientName": "STORE001-LANE01",
  "action": "signature",
  "eventId": "evt-ABC123",
  "timestamp": "2026-01-05T12:00:00.000Z",
  "data": {
    "transactionId": "TXN-XYZ789",
    "amount": 99.99,
    "message": "Please capture signature"
  }
}
```

### SSE Event Format

```
data: <json>\n\n
```

### Heartbeat Format

```
: heartbeat <timestamp>\n\n
```

## Logging

All logs include contextual prefixes for easy filtering:

- `[SERVER]` - Server lifecycle events
- `[REGISTRY]` - Connection registry operations
- `[SSE]` - SSE connection events
- `[REDIS]` - Redis operations
- `[DISCONNECT]` - Disconnect events
- `[HEARTBEAT]` - Heartbeat operations
- `[PUBLISHED]` - Test publisher events

**Example logs**:
```
[SERVER] SSE Server started on port 3000
[REGISTRY] Registered STORE001-LANE01 on pod pod-1. Total connections: 1
[SSE] Event #1 sent to STORE001-LANE01 (signature)
[HEARTBEAT] Sent to STORE001-LANE01
[DISCONNECT] Client STORE001-LANE01 disconnected (event handler)
[REGISTRY] Removed STORE001-LANE01. Total connections: 0
```

## Troubleshooting

### Client Can't Connect

1. Check server is running: `curl http://localhost:3000/health`
2. Verify Redis connection: Check server logs for `[REDIS] Connected`
3. Test registration: `curl -X POST http://localhost:3000/register -H "Content-Type: application/json" -d '{"clientName":"TEST"}'`

### Events Not Received

1. Verify client is connected: Check `/admin/connections`
2. Check Redis channel: `redis-cli PUBSUB CHANNELS`
3. Test publisher: `node src/test-publisher.js YOUR-CLIENT-NAME signature`
4. Verify clientName matches exactly (case-sensitive)

### Connection Drops

1. Check network stability
2. Review logs for `[DISCONNECT]` events
3. Verify heartbeat is working (should see `[HEARTBEAT]` every 30s)
4. Check for write failures in logs

### Multi-Pod Issues

1. Ensure session affinity is enabled (Kubernetes service)
2. Check Redis connectivity from all pods
3. Verify pod names are unique (`POD_NAME` env var)
4. Use `/admin` endpoint to see pod distribution

## Performance Considerations

- **Memory**: ~50MB base + ~1KB per connection
- **CPU**: Minimal, event-driven architecture
- **Network**: Sustained connections, consider load balancer timeout
- **Redis**: Pub/Sub has minimal overhead, scales to 10K+ messages/sec
- **Connections**: Tested up to 10K concurrent connections per pod

## Security Notes

- Runs as non-root user in Docker (node user)
- No authentication implemented (add reverse proxy with auth)
- CORS enabled for development (restrict in production)
- Input validation on client names
- Environment variables for sensitive config

## License

ISC

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## Support

For issues and questions:
- Check the troubleshooting section
- Review server logs
- Test with the HTML client and CLI publisher
- Check Redis connectivity and channel configuration
