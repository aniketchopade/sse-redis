/**
 * Test Publisher
 * CLI tool to publish test events to Redis channel
 * Usage: node test-publisher.js <clientName> <action> [count]
 */

require('dotenv').config();
const Redis = require('ioredis');

// Configuration
const redisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT) || 6379,
  channel: process.env.REDIS_CHANNEL || 'events-to-store'
};

// Action types with realistic payloads
const actionTemplates = {
  signature: {
    action: 'signature',
    description: 'Signature capture request',
    getData: () => ({
      transactionId: `TXN-${randomString(6)}`,
      amount: (Math.random() * 500 + 10).toFixed(2),
      message: 'Please capture signature on the device',
      timeout: 60
    })
  },
  
  payment: {
    action: 'payment',
    description: 'Payment processing',
    getData: () => ({
      transactionId: `TXN-${randomString(6)}`,
      amount: (Math.random() * 1000 + 50).toFixed(2),
      paymentMethod: randomChoice(['credit', 'debit', 'cash', 'mobile']),
      status: randomChoice(['pending', 'processing', 'approved']),
      cardLast4: Math.floor(Math.random() * 10000).toString().padStart(4, '0')
    })
  },
  
  receipt: {
    action: 'receipt',
    description: 'Receipt generation',
    getData: () => ({
      transactionId: `TXN-${randomString(6)}`,
      amount: (Math.random() * 500 + 10).toFixed(2),
      items: Math.floor(Math.random() * 10) + 1,
      receiptNumber: `RCP-${randomString(8)}`,
      printRequired: randomChoice([true, false])
    })
  },
  
  alert: {
    action: 'alert',
    description: 'System alert',
    getData: () => ({
      severity: randomChoice(['info', 'warning', 'error', 'critical']),
      message: randomChoice([
        'System maintenance scheduled',
        'Network connectivity issue',
        'Low paper warning',
        'Device temperature high',
        'Software update available'
      ]),
      alertId: `ALT-${randomString(6)}`,
      requiresAck: randomChoice([true, false])
    })
  },
  
  inventory: {
    action: 'inventory',
    description: 'Inventory update',
    getData: () => ({
      sku: `SKU-${randomString(6)}`,
      quantity: Math.floor(Math.random() * 100),
      location: `AISLE-${Math.floor(Math.random() * 20) + 1}`,
      status: randomChoice(['in-stock', 'low-stock', 'out-of-stock']),
      lastUpdated: new Date().toISOString()
    })
  },
  
  status: {
    action: 'status',
    description: 'Device status update',
    getData: () => ({
      deviceId: `DEV-${randomString(4)}`,
      status: randomChoice(['online', 'offline', 'busy', 'maintenance']),
      uptime: Math.floor(Math.random() * 86400),
      temperature: (Math.random() * 20 + 30).toFixed(1),
      memoryUsage: Math.floor(Math.random() * 100)
    })
  },
  
  notification: {
    action: 'notification',
    description: 'General notification',
    getData: () => ({
      title: randomChoice([
        'New Order Received',
        'Customer Arrival',
        'Delivery Update',
        'Manager Request',
        'Break Time Reminder'
      ]),
      message: `Notification message ${randomString(4)}`,
      priority: randomChoice(['low', 'medium', 'high']),
      notificationId: `NOT-${randomString(8)}`
    })
  }
};

// Helper functions
function randomString(length) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function randomChoice(array) {
  return array[Math.floor(Math.random() * array.length)];
}

function generateEvent(clientName, action) {
  const template = actionTemplates[action];
  
  if (!template) {
    throw new Error(`Unknown action: ${action}. Available: ${Object.keys(actionTemplates).join(', ')}`);
  }

  return {
    clientName,
    action: template.action,
    eventId: `evt-${randomString(8)}`,
    timestamp: new Date().toISOString(),
    data: template.getData()
  };
}

async function publishEvent(publisher, clientName, action) {
  const event = generateEvent(clientName, action);
  const message = JSON.stringify(event);
  
  const subscribers = await publisher.publish(redisConfig.channel, message);
  console.log(`[PUBLISHED] Event for ${clientName} (subscribers: ${subscribers}):`);
  console.log(JSON.stringify(event, null, 2));
  
  return event;
}

async function main() {
  const args = process.argv.slice(2);

  // Parse arguments
  if (args.length < 2) {
    console.log('Usage: node test-publisher.js <clientName> <action> [count] [interval]');
    console.log('\nAvailable actions:');
    Object.entries(actionTemplates).forEach(([key, template]) => {
      console.log(`  ${key.padEnd(15)} - ${template.description}`);
    });
    console.log('\nExamples:');
    console.log('  node test-publisher.js STORE001-LANE01 signature');
    console.log('  node test-publisher.js STORE001-LANE01 payment 5');
    console.log('  node test-publisher.js STORE001-LANE01 alert 10 1000');
    process.exit(1);
  }

  const clientName = args[0];
  const action = args[1];
  const count = parseInt(args[2]) || 1;
  const interval = parseInt(args[3]) || 2000; // Default 2 seconds between messages

  // Validate action
  if (!actionTemplates[action]) {
    console.log(`Error: Unknown action '${action}'`);
    console.log(`Available actions: ${Object.keys(actionTemplates).join(', ')}`);
    process.exit(1);
  }

  console.log(`[PUBLISHER] Connecting to Redis at ${redisConfig.host}:${redisConfig.port}`);
  console.log(`[PUBLISHER] Channel: ${redisConfig.channel}`);
  console.log(`[PUBLISHER] Client: ${clientName}`);
  console.log(`[PUBLISHER] Action: ${action}`);
  console.log(`[PUBLISHER] Count: ${count}`);
  console.log(`[PUBLISHER] Interval: ${interval}ms`);
  console.log('');

  // Create Redis publisher
  const publisher = new Redis({
    host: redisConfig.host,
    port: redisConfig.port
  });

  publisher.on('error', (err) => {
    console.log('[ERROR] Redis error:', err.message);
    process.exit(1);
  });

  try {
    // Wait for Redis connection
    await new Promise((resolve) => {
      publisher.once('ready', resolve);
    });

    console.log('[PUBLISHER] Connected to Redis\n');

    // Publish events
    for (let i = 0; i < count; i++) {
      await publishEvent(publisher, clientName, action);
      
      if (i < count - 1) {
        console.log(`[WAIT] Waiting ${interval}ms before next event...\n`);
        await new Promise(resolve => setTimeout(resolve, interval));
      }
    }

    console.log(`\n[PUBLISHER] Successfully published ${count} event(s)`);

  } catch (err) {
    console.log('[ERROR] Failed to publish:', err.message);
    process.exit(1);
  } finally {
    await publisher.quit();
    console.log('[PUBLISHER] Disconnected from Redis');
  }
}

// Run publisher
main().catch(err => {
  console.log('[ERROR]', err.message);
  process.exit(1);
});
