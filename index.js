#!/usr/bin/env node

/**
 * MCP Client Bridge for Warp (REQUIRED FOR WARP)
 * 
 * This file converts HTTP MCP server to stdin/stdout MCP protocol.
 * 
 * Warp terminal expects MCP servers to use either:
 * 1. stdin/stdout JSON-RPC protocol (this bridge)
 * 2. Server-Sent Events (SSE) over HTTP
 * 
 * Since our server uses standard JSON-RPC over HTTP POST (not SSE),
 * we need this bridge to convert between protocols.
 * 
 * This bridge receives JSON-RPC requests via stdin from Warp,
 * forwards them as HTTP POST requests to our server,
 * and returns responses via stdout to Warp.
 */

const { Transform } = require('stream');
// Using native fetch (Node.js v18+) instead of node-fetch package

// Configuration from environment variables
const API_BASE = process.env.POLYNEURAL_API_URL || 'https://polyneural.ai/mcp';
const API_KEY = process.env.POLYNEURAL_API_KEY;
const SHORT_TERM = process.env.SHORT_TERM || 'false';

// Validate required environment variables
if (!API_KEY) {
  console.error('ERROR: POLYNEURAL_API_KEY environment variable is required');
  console.error('Please set your API key: export POLYNEURAL_API_KEY=kg_your_api_key_here');
  process.exit(1);
}

// Enable debug logging with DEBUG=1 environment variable
const DEBUG = process.env.DEBUG === '1';

// Timeout for HTTP requests (30 seconds)
const REQUEST_TIMEOUT_MS = parseInt(process.env.REQUEST_TIMEOUT_MS) || 30000;

function log(message) {
  if (DEBUG) {
    console.error(`[MCP-CLIENT] ${message}`);
  }
}

log(`Starting MCP Client Bridge`);
log(`API Base URL: ${API_BASE}`);
log(`API Key: ${API_KEY ? API_KEY.substring(0, 8) + '...' : 'NOT SET'}`);
log(`Request Timeout: ${REQUEST_TIMEOUT_MS}ms`);
log(`Short-Term Memory: ${SHORT_TERM}`);

/**
 * Custom Transform stream to handle large JSON messages
 * This properly handles large inputs by buffering and processing complete JSON messages
 */
class LargeMessageHandler extends Transform {
  constructor(options = {}) {
    super(options);
    this.buffer = '';
    this.messageDelimiter = '\n';
  }

  _transform(chunk, encoding, callback) {
    try {
      // Add the new chunk to our buffer
      const data = chunk.toString();
      this.buffer += data;
      log(`Buffer size: ${this.buffer.length} bytes`);
      
      // Process any complete messages in the buffer
      let delimiterIndex;
      while ((delimiterIndex = this.buffer.indexOf(this.messageDelimiter)) !== -1) {
        // Extract the complete message
        const message = this.buffer.slice(0, delimiterIndex);
        // Remove the processed message from the buffer
        this.buffer = this.buffer.slice(delimiterIndex + this.messageDelimiter.length);
        
        // If we have a non-empty message, emit it
        if (message.trim()) {
          log(`Processing complete message of size: ${message.length} bytes`);
          this.push(message);
        }
      }
      
      callback();
    } catch (error) {
      log(`Error in transform: ${error.message}`);
      callback(error);
    }
  }

  _flush(callback) {
    // Process any remaining data in the buffer
    if (this.buffer.trim()) {
      log(`Flushing remaining buffer of size: ${this.buffer.length} bytes`);
      this.push(this.buffer);
    }
    this.buffer = '';
    callback();
  }
}

// Set up our custom stream processing
const messageHandler = new LargeMessageHandler();
process.stdin.pipe(messageHandler);

// Monitor memory usage to detect potential leaks
if (DEBUG) {
  setInterval(() => {
    const memoryUsage = process.memoryUsage();
    log(`Memory usage: RSS=${Math.round(memoryUsage.rss / 1024 / 1024)}MB, Heap=${Math.round(memoryUsage.heapUsed / 1024 / 1024)}/${Math.round(memoryUsage.heapTotal / 1024 / 1024)}MB`);
  }, 60000);
}

// Helper function to make HTTP requests to our MCP server
async function makeRequest(endpoint, data) {
  try {
    log(`Making request to ${API_BASE}${endpoint}`);
    log(`Request body size: ${JSON.stringify(data).length} bytes`);
    if (DEBUG) {
      // Only log full request in debug mode to avoid overwhelming logs
      const shortData = JSON.stringify(data).substring(0, 1000);
      log(`Request body preview: ${shortData}${shortData.length < JSON.stringify(data).length ? '...' : ''}`);
    }
    
    // Create an AbortController for request timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    
    try {
      const response = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${API_KEY}`,
          'X-Short-Term-Memory': SHORT_TERM
        },
        body: JSON.stringify(data),
        signal: controller.signal
      });
      
      clearTimeout(timeoutId); // Clear the timeout if the request completes
      
      log(`HTTP Response status: ${response.status}`);
      
      if (!response.ok) {
        const errorText = await response.text();
        log(`HTTP Error response: ${errorText}`);
        throw new Error(`HTTP ${response.status}: ${response.statusText} - ${errorText}`);
      }
      
      const responseData = await response.json();
      log(`HTTP Response data size: ${JSON.stringify(responseData).length} bytes`);
      if (DEBUG) {
        const shortResponse = JSON.stringify(responseData).substring(0, 1000);
        log(`HTTP Response preview: ${shortResponse}${shortResponse.length < JSON.stringify(responseData).length ? '...' : ''}`);
      }
      
      // Fix the ID to match the original request
      if (responseData.jsonrpc && data.id !== undefined) {
        responseData.id = data.id;
      }
      
      return responseData;
    } finally {
      clearTimeout(timeoutId); // Ensure timeout is cleared even if there's an error
    }
  } catch (error) {
    // Handle timeout error specifically
    if (error.name === 'AbortError') {
      log(`Request timed out after ${REQUEST_TIMEOUT_MS}ms`);
      return {
        jsonrpc: '2.0',
        id: data.id,
        error: {
          code: -32603,
          message: `Request timed out after ${REQUEST_TIMEOUT_MS}ms`
        }
      };
    }
    
    log(`Request failed: ${error.message}`);
    return {
      jsonrpc: '2.0',
      id: data.id,
      error: {
        code: -32603,
        message: `Connection error: ${error.message}`
      }
    };
  }
}

// Handle incoming MCP requests
messageHandler.on('data', async (data) => {
  // Log incoming request for debugging
  const line = data.toString();
  log(`Received message of size: ${line.length} bytes`);
  
  try {
    let request;
    try {
      request = JSON.parse(line);
      log(`Successfully parsed JSON request of method: ${request.method}`);
    } catch (parseError) {
      log(`JSON parse error: ${parseError.message}`);
      log(`Problematic input: ${line.substring(0, 200)}...`);
      throw new Error(`Failed to parse JSON: ${parseError.message}`);
    }
    
    let response;
    
    switch (request.method) {
      case 'initialize':
        log(`Handling initialize request`);
        response = await makeRequest('/initialize', request);
        break;
        
      case 'tools/list':
        log(`Handling tools/list request`);
        response = await makeRequest('/tools/list', request);
        break;
        
      case 'tools/call':
        log(`Handling tools/call request`);
        response = await makeRequest('/tools/call', request);
        break;
        
      case 'resources/list':
        log(`Handling resources/list request`);
        // Return empty resources list since we don't support resources
        response = {
          jsonrpc: '2.0',
          id: request.id,
          result: {
            resources: []
          }
        };
        break;
        
      case 'resources/read':
        log(`Handling resources/read request`);
        // Return error since we don't support resources
        response = {
          jsonrpc: '2.0',
          id: request.id,
          error: {
            code: -32601,
            message: 'Resources not supported'
          }
        };
        break;
        
      case 'prompts/list':
        log(`Handling prompts/list request`);
        // Return empty prompts list since we don't support prompts
        response = {
          jsonrpc: '2.0',
          id: request.id,
          result: {
            prompts: []
          }
        };
        break;
        
      case 'initialized':
      case 'notifications/initialized':
        log(`Handling initialized notification`);
        // Notifications don't get responses
        return;
        
      case 'ping':
        log(`Handling ping request`);
        // Simple ping response
        response = {
          jsonrpc: '2.0',
          id: request.id,
          result: {}
        };
        break;
        
      default:
        log(`Unknown method: ${request.method}`);
        response = {
          jsonrpc: '2.0',
          id: request.id,
          error: {
            code: -32601,
            message: `Method not found: ${request.method}`
          }
        };
    }
    
    log(`Sending response of size: ${JSON.stringify(response).length} bytes`);
    try {
      // Make sure we handle large responses properly by explicitly encoding and flushing
      const responseStr = JSON.stringify(response) + '\n';
      const written = process.stdout.write(responseStr, 'utf8');
      if (!written) {
        log('Output buffer full, waiting for drain event');
        await new Promise(resolve => process.stdout.once('drain', resolve));
      }
      log('Response sent successfully');
    } catch (writeError) {
      log(`Error writing to stdout: ${writeError.message}`);
      // Try to send a simpler error response if we had trouble with the main one
      try {
        const fallbackResponse = {
          jsonrpc: '2.0',
          id: request.id,
          error: {
            code: -32603,
            message: 'Internal error: Failed to write response'
          }
        };
        process.stdout.write(JSON.stringify(fallbackResponse) + '\n');
      } catch (secondaryError) {
        log(`Critical error: Failed to send error response: ${secondaryError.message}`);
      }
    }
  } catch (error) {
    log(`Processing error: ${error.message}`);
    let errorId = null;
    try {
      // Try to extract the request id if possible
      errorId = JSON.parse(line).id;
    } catch (e) {
      // If we can't parse the id, just use null
    }
    const errorResponse = {
      jsonrpc: '2.0',
      id: errorId,
      error: {
        code: -32700,
        message: `Error: ${error.message}`
      }
    };
    
    try {
      process.stdout.write(JSON.stringify(errorResponse) + '\n');
    } catch (writeError) {
      log(`Critical error: Failed to write error response: ${writeError.message}`);
    }
  }
});

// Handle process termination gracefully
process.on('SIGINT', () => {
  log('Received SIGINT, shutting down...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  log('Received SIGTERM, shutting down...');
  process.exit(0);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  log(`Uncaught exception: ${error.message}`);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  log(`Unhandled rejection at ${promise}: ${reason}`);
  process.exit(1);
});

log('MCP Client bridge started, ready to handle requests');
