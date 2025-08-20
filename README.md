# Cortensor OpenAI Provider

**Version: 0.0.1** | 🚧 **EXPERIMENTAL - ACTIVELY IN DEVELOPMENT** 🚧

OpenAI-compatible provider for Cortensor AI models, designed to work seamlessly with Vercel AI SDK and popular agent frameworks.

## Features

- 🔄 **OpenAI Compatibility**: Drop-in replacement for OpenAI provider
- 🎯 **Session Management**: Built-in session handling for conversation continuity
- 🔀 **Request/Response Transformation**: Seamless format conversion between OpenAI and Cortensor APIs
- 📘 **TypeScript Support**: Full type safety with comprehensive TypeScript definitions
- 🤖 **Agent Framework Ready**: Compatible with Mastra, Convex, and other AI agent frameworks
- ⚡ **Lightweight**: Minimal dependencies for optimal performance

> **Note**: Streaming responses are currently disabled and will be available in future releases.

## Installation

```bash
pnpm add cortensor-openai-provider
# or
npm install cortensor-openai-provider
# or
yarn add cortensor-openai-provider
```

## Environment Setup

```bash
# .env.local or .env
CORTENSOR_API_KEY=your_cortensor_api_key_here
CORTENSOR_BASE_URL=https://your-cortensor-api-url.com
```

> **Important**: Both `CORTENSOR_API_KEY` and `CORTENSOR_BASE_URL` are required environment variables.

## Quick Start

### Basic Usage with Vercel AI SDK

```typescript
import { cortensorModel } from 'cortensor-openai-provider';
import { generateText } from 'ai';

const result = await generateText({
  model: cortensorModel({
    sessionId: 12345,
    modelName: 'cortensor-chat',
    temperature: 0.7,
    maxTokens: 128,
  }),
  messages: [{ role: 'user', content: 'Hello!' }],
});

console.log(result.text);
```

### Environment Variables Required

```bash
# .env.local or .env
CORTENSOR_API_KEY=your_cortensor_api_key_here
CORTENSOR_BASE_URL=https://your-cortensor-api-url.com
```

## Agent Framework Integration

### 🤖 Mastra Agents

```typescript
import { cortensorModel } from 'cortensor-openai-provider';
import { Agent, createMastra } from '@mastra/core';

const mastra = createMastra({
  agents: {
    cortensorAgent: new Agent({
      name: 'cortensor-agent',
      instructions: 'You are a helpful AI assistant.',
      model: cortensorModel({
        sessionId: 11111,
        modelName: 'cortensor-chat',
        temperature: 0.7,
        maxTokens: 256,
      }),
    }),
  },
});

// Use the agent
const response = await mastra.agents.cortensorAgent.generate({
  messages: [{ role: 'user', content: 'Hello!' }],
});
```

### 🔄 Convex Agents

```typescript
// convex/agents.ts
import { cortensorModel } from 'cortensor-openai-provider';
import { generateText } from 'ai';
import { mutation } from './_generated/server';
import { v } from 'convex/values';

export const sendMessage = mutation({
  args: {
    conversationId: v.id('conversations'),
    message: v.string(),
    sessionId: v.number(),
  },
  handler: async (ctx, { conversationId, message, sessionId }) => {
    const conversation = await ctx.db.get(conversationId);
    if (!conversation) throw new Error('Conversation not found');

    const messages = [...conversation.messages, { role: 'user' as const, content: message }];

    const result = await generateText({
      model: cortensorModel({
        sessionId,
        modelName: 'cortensor-chat',
        temperature: 0.7,
        maxTokens: 512,
      }),
      messages,
    });

    const aiMessage = { role: 'assistant' as const, content: result.text };
    const updatedMessages = [...messages, aiMessage];

    await ctx.db.patch(conversationId, {
      messages: updatedMessages,
      updatedAt: Date.now(),
    });

    return { message: result.text };
  },
});
```

## Framework Examples

### Next.js API Route

```typescript
// app/api/chat/route.ts
import { cortensorModel } from 'cortensor-openai-provider';
import { generateText } from 'ai';
import { NextRequest } from 'next/server';

export async function POST(req: NextRequest) {
  const { messages, sessionId } = await req.json();

  const result = await generateText({
    model: cortensorModel({
      sessionId,
      modelName: 'cortensor-chat',
      temperature: 0.7,
      maxTokens: 256,
    }),
    messages,
  });

  return Response.json({ response: result.text });
}
```

### Express.js Server

```typescript
import express from 'express';
import { cortensorModel } from 'cortensor-openai-provider';
import { generateText } from 'ai';

const app = express();
app.use(express.json());

app.post('/api/chat', async (req, res) => {
  const { messages, sessionId } = req.body;
  
  const result = await generateText({
    model: cortensorModel({
      sessionId,
      modelName: 'cortensor-chat',
      temperature: 0.7,
      maxTokens: 256,
    }),
    messages,
  });
  
  res.json({ response: result.text });
});
```

## API Reference

### `cortensorModel(config)`

Creates a Cortensor model instance with session management.

**Parameters:**
- `config` (object, required):
  - `sessionId` (number, required): Session ID for conversation continuity
  - `modelName` (string, optional): Model name (default: 'cortensor-chat')
  - `temperature` (number, optional): Sampling temperature 0.0-2.0 (default: 0.7)
  - `maxTokens` (number, optional): Maximum tokens to generate (default: 128)
  - `topP` (number, optional): Top-p sampling parameter (default: 0.95)
  - `topK` (number, optional): Top-k sampling parameter (default: 40)
  - `presencePenalty` (number, optional): Presence penalty -2.0 to 2.0 (default: 0)
  - `frequencyPenalty` (number, optional): Frequency penalty -2.0 to 2.0 (default: 0)
  - `stream` (boolean, optional): Enable streaming (default: false, currently disabled)
  - `timeout` (number, optional): Request timeout in seconds (default: 60)
  - `promptType` (number, optional): Prompt type identifier (default: 1)
  - `promptTemplate` (string, optional): Custom prompt template (default: '')

### `createCortensorProvider(config?)`

Creates a custom Cortensor provider with specific configuration.

**Parameters:**
- `config` (object, optional):
  - `apiKey` (string, optional): Override API key
  - `baseURL` (string, optional): Override base URL
  - `timeout` (number, optional): Request timeout
  - `sessionTimeout` (number, optional): Session timeout

### `clearModelConfigurations(sessionId?)`

Clears stored model configurations.

**Parameters:**
- `sessionId` (number, optional): Clear configs for specific session, or all if omitted

## Session Management

Sessions maintain conversation context across multiple requests:

```typescript
// Use consistent sessionId for conversation continuity
const sessionId = 98765;

const model = cortensorModel({
  sessionId,
  modelName: 'cortensor-chat',
  temperature: 0.7,
  maxTokens: 256,
});

// All requests with this model will share the same session
const response1 = await generateText({ model, messages: [...] });
const response2 = await generateText({ model, messages: [...] });

// Clear session when done
import { clearModelConfigurations } from 'cortensor-openai-provider';
clearModelConfigurations(sessionId);
```

## Error Handling

```typescript
try {
  const result = await generateText({
    model: cortensorModel({
      sessionId: 12345,
      modelName: 'cortensor-chat',
      temperature: 0.7,
      maxTokens: 128,
    }),
    messages,
  });
} catch (error) {
  console.error('Cortensor API error:', error);
  // Handle error appropriately
}
```

## Development Status

### Current Status
- ✅ Basic OpenAI compatibility
- ✅ Session management with automatic cleanup
- ✅ Full TypeScript support with comprehensive types
- ✅ Agent framework integration (Mastra, Convex)
- ✅ Request/response transformation
- ✅ Error handling and validation
- ❌ Streaming responses (coming in future releases)
- ❌ Image handling (planned)
- ❌ Advanced prompt template handling (experimental)

### Known Limitations
- Streaming is currently disabled
- Image processing not yet supported
- Prompt template functionality may not work reliably

## Roadmap

### 🚀 Upcoming Features

#### Support for LanguageModelV2
- **Enhanced model capabilities**: Leverage Cortensor's advanced language models with LanguageModelV2 interface
- **Batch processing**: Support for processing multiple requests in parallel
- **Advanced model features**: Full compatibility with AI SDK's LanguageModelV2 specification
- **Improved type safety**: Enhanced TypeScript support for LanguageModelV2 methods
- **Better error handling**: Comprehensive error management for LanguageModelV2 operations

### Streaming Support
- **Real-time streaming responses**: Enable streaming for real-time AI responses
- **Stream cancellation**: Support for cancelling ongoing streams
- **Backpressure handling**: Proper stream flow control
- **Error recovery**: Graceful handling of stream interruptions

#### Multimodal Support
- **Image input handling**: Support for image uploads and processing
- **Vision model integration**: Connect with Cortensor's vision capabilities
- **File attachment support**: Handle various file formats
- **Base64 image encoding**: Automatic image format conversion

#### Advanced Prompt Engineering
- **Custom prompt templates**: Robust template system with variable substitution
- **Template validation**: Ensure prompt templates are properly formatted
- **Template library**: Pre-built templates for common use cases
- **Dynamic prompt generation**: Context-aware prompt modification

#### Tool Calling & Enhanced Features
- **Tool calling**: Proper tool/function calling capabilities for agent interactions
- **Function calling**: Support for external function execution
- **Persistent sessions**: Database-backed session storage
- **Rate limiting**: Built-in request throttling
- **Caching layer**: Response caching for improved performance
- **Metrics and monitoring**: Usage analytics and performance tracking

> **Note**: Some features depend on capabilities that are not yet available in the Cortensor network infrastructure. This provider is designed to work seamlessly with the Cortensor network as new features become available.

### 🔬 Experimental Features

> **Note**: These features are experimental and may not work reliably in the current version.

- **Prompt Templates**: Basic template support is available but may have limitations
- **Custom Model Parameters**: Advanced model configuration options
- **Session Persistence**: Experimental session storage mechanisms

### 🌐 Cortensor Network Integration

This provider is specifically built to work with the Cortensor network infrastructure. For comprehensive documentation on building with Cortensor network, including API reference and integration guides, visit:

**📚 [Cortensor Web2 API Reference](https://docs.cortensor.network/getting-started/web2-api-reference)**

The provider abstracts the complexity of direct API calls while maintaining full compatibility with Cortensor's RESTful endpoints for sessions, tasks, miners, and completions.

## Contributing

This is an experimental package. Contributions, feedback, and bug reports are welcome!

## License

MIT License

## Support

For issues and questions, please open an issue on the repository.