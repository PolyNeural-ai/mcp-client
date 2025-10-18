# Polyneural AI MCP Client

An MCP (Model Context Protocol) client bridge that converts HTTP MCP server requests to stdin/stdout JSON-RPC protocol for integration with Warp terminal and other MCP-compatible AI assistants.

## Overview

This client acts as a bridge between:
- **AI clients** (like Warp terminal) that expect stdin/stdout JSON-RPC protocol
- **Polyneural AI HTTP server** that uses JSON-RPC over HTTP POST

## Prerequisites

- Node.js v18.0.0 or higher
- A Polyneural AI API key

## Installation

```bash
# Install dependencies (none required - uses built-in Node.js modules)
cd mcp-client
npm install
```

## Configuration

The client is configured via environment variables:

### Required Environment Variables

- `POLYNEURAL_API_KEY` - Your Polyneural.ai API key (format: `kg_xxxxxxxx`)

### Optional Environment Variables

- `POLYNEURAL_API_URL` - API base URL (default: `https://api.polyneural.ai/mcp`)
- `DEBUG` - Enable debug logging (`1` to enable, `0` or unset to disable)
- `REQUEST_TIMEOUT_MS` - HTTP request timeout in milliseconds (default: `30000`)
- `SHORT_TERM` - Enable embedded short-term memory in tool descriptions (`true`/`false`, default: `false`)

## Usage

### Basic Usage

```bash
export POLYNEURAL_API_KEY=kg_your_api_key_here
node index.js
```

### With Debug Logging

```bash
export POLYNEURAL_API_KEY=kg_your_api_key_here
export DEBUG=1
node index.js
```

### Using npm scripts

```bash
# Basic usage
export POLYNEURAL_API_KEY=kg_your_api_key_here
npm start

# With debug logging
export POLYNEURAL_API_KEY=kg_your_api_key_here
npm run dev
```

### Custom API URL

```bash
export POLYNEURAL_API_KEY=kg_your_api_key_here
export POLYNEURAL_API_URL=https://api.polyneural.ai/mcp  # or staging/local as needed
node index.js
```

## Integration with Warp Terminal

To use this client with Warp terminal, add it to your MCP configuration:

```json
{
  "mcpServers": {
    "polyneural": {
      "command": "node",
      "args": ["/path/to/polyneural.ai/mcp-client/index.js"],
      "env": {
        "POLYNEURAL_API_KEY": "kg_your_api_key_here",
        "SHORT_TERM": "true"
      }
    }
  }
}
```

## Integration with Claude Desktop

For Claude Desktop, add to your configuration file:

```json
{
  "mcpServers": {
    "polyneural": {
      "command": "node",
      "args": ["/path/to/polyneural.ai/mcp-client/index.js"],
      "env": {
        "POLYNEURAL_API_KEY": "kg_your_api_key_here",
        "POLYNEURAL_API_URL": "https://polyneural.ai/mcp",
        "SHORT_TERM": "true"
      }
    }
  }
}
```

## Supported MCP Methods

The client supports the following MCP protocol methods:

- `initialize` - Initialize the MCP connection
- `tools/list` - List available tools
- `tools/call` - Call a specific tool
- `resources/list` - List resources (returns empty list)
- `resources/read` - Read resources (returns error - not supported)
- `prompts/list` - List prompts (returns empty list)
- `initialized` - Initialization notification
- `ping` - Health check

## Error Handling

The client includes comprehensive error handling:

- **Connection errors** - Returned as JSON-RPC error responses
- **Timeout errors** - Configurable timeout with graceful error responses
- **Parse errors** - Malformed JSON requests are handled gracefully
- **Memory monitoring** - Optional memory usage logging in debug mode

## Logging

When `DEBUG=1` is set, the client provides detailed logging including:

- Request/response sizes and previews
- Memory usage monitoring
- HTTP status codes and error details
- Message processing statistics

All debug logs are sent to stderr to avoid interfering with the JSON-RPC communication on stdout.

## Protocol Details

### Input (stdin)
- Expects newline-delimited JSON-RPC 2.0 requests
- Each line should be a complete JSON object
- Supports large message buffering

### Output (stdout)
- Returns newline-delimited JSON-RPC 2.0 responses
- Each response corresponds to a request (except notifications)
- Includes proper error handling and ID matching

### HTTP Communication
- Forwards requests to the configured API URL via HTTP POST
- Includes authentication via Bearer token
- Handles response mapping and error translation

## Troubleshooting

### Common Issues

1. **"POLYNEURAL_API_KEY environment variable is required"**
   - Make sure to set your API key: `export POLYNEURAL_API_KEY=kg_your_key_here`

2. **Connection timeouts**
   - Check your network connection
   - Verify the API URL is correct
   - Try increasing `REQUEST_TIMEOUT_MS`

3. **Authentication errors**
   - Verify your API key is correct
   - Check that your key has proper permissions

4. **Large response handling**
   - The client automatically handles large responses
   - Monitor memory usage with `DEBUG=1`

### Debug Mode

Enable debug mode for detailed troubleshooting:

```bash
export DEBUG=1
export POLYNEURAL_API_KEY=kg_your_key_here
node index.js
```

This will show:
- All request/response details
- Memory usage statistics
- Error details and stack traces
- Message processing information

## Development

### Project Structure

```
mcp-client/
├── index.js          # Main MCP client bridge
├── package.json      # Project configuration
└── README.md         # This file
```

### Making Changes

1. Edit `index.js` for client logic changes
2. Update `package.json` for dependency or metadata changes
3. Test with your MCP client (Warp, Claude Desktop, etc.)

### Testing

Test the client manually:

```bash
export POLYNEURAL_API_KEY=kg_your_key_here
export DEBUG=1
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | node index.js
```

## License

MIT License - see the main project repository for details.
