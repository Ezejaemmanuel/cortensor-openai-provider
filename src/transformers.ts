/**
 * Cortensor API Transformers
 * 
 * This module handles the conversion between OpenAI format and Cortensor API format.
 * It provides utilities to transform requests and responses between the two formats,
 * enabling seamless integration with the Vercel AI SDK.
 */

import type { CoreMessage } from 'ai';
import type { CortensorModelConfig } from './provider';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Request format expected by the Cortensor API
 */
export interface CortensorRequest {
  session_id: number;
  prompt: string;
  prompt_type?: number;
  prompt_template?: string;
  stream?: boolean;
  timeout?: number;
  client_reference?: string;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  presence_penalty?: number;
  frequency_penalty?: number;
}

/**
 * Request format from OpenAI/Vercel AI SDK
 */
export interface OpenAIRequest {
  model: string;
  messages: CoreMessage[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  [key: string]: unknown;
}

/**
 * Response format expected by OpenAI/Vercel AI SDK
 */
export interface OpenAIResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * Individual choice in Cortensor API response
 */
export interface CortensorChoice {
  finish_reason: string;
  index: number;
  logprobs: null | any;
  text: string;
}

/**
 * Token usage information from Cortensor API
 */
export interface CortensorUsage {
  completion_tokens: number;
  prompt_tokens: number;
  total_tokens: number;
}

/**
 * Response format from Cortensor API
 */
export interface CortensorResponse {
  choices: CortensorChoice[];
  created: number;
  id: string;
  model: string;
  object: string;
  usage: CortensorUsage;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Extracts text content from a CoreMessage, handling different content types
 * @param message - The message to extract content from
 * @returns The extracted text content
 */
function extractMessageContent(message: CoreMessage): string {
  // Handle simple string content
  if (typeof message.content === 'string') {
    return message.content;
  }

  // Handle array content (multimodal messages)
  if (Array.isArray(message.content)) {
    return message.content
      .map(part => {
        if (typeof part === 'string') {
          return part;
        }
        // Extract text from text parts, skip other types (images, files)
        if (part.type === 'text') {
          return part.text;
        }
        return '';
      })
      .filter(text => text.length > 0)
      .join(' ');
  }

  return '';
}

/**
 * Builds a formatted prompt from system and conversation messages
 * @param systemMessages - Array of system messages
 * @param conversationMessages - Array of conversation messages
 * @returns Formatted prompt string
 */
function buildFormattedPrompt(systemMessages: CoreMessage[], conversationMessages: CoreMessage[]): string {
  let prompt = '';

  // Add system instructions section if present
  if (systemMessages.length > 0) {
    const systemInstructions = systemMessages
      .map(msg => extractMessageContent(msg))
      .join('\n\n');

    prompt += `### SYSTEM INSTRUCTIONS ###\n${systemInstructions}\n\n### CONVERSATION ###\n`;
  }

  // Add conversation history with role formatting
  const conversationText = conversationMessages
    .map(msg => {
      const content = extractMessageContent(msg);
      switch (msg.role) {
        case 'user':
          return `Human: ${content}`;
        case 'assistant':
          return `Assistant: ${content}`;
        default:
          return content;
      }
    })
    .join('\n\n');

  prompt += conversationText;

  // Add assistant prompt if the last message is from user
  const lastMessage = conversationMessages[conversationMessages.length - 1];
  if (conversationMessages.length > 0 && lastMessage?.role === 'user') {
    prompt += '\n\nAssistant:';
  }

  return prompt;
}

/**
 * Transforms OpenAI request format to Cortensor API format
 * @param requestBody - The OpenAI-formatted request body as string
 * @param sessionId - The session ID to include in the request
 * @param modelConfig - Optional model configuration to override defaults
 * @returns Cortensor-formatted request object
 */
export function transformToCortensor(
  requestBody: string,
  sessionId: number,
  modelConfig?: CortensorModelConfig
): CortensorRequest {
  try {
    const openAIRequest: OpenAIRequest = JSON.parse(requestBody);

    // Separate system instructions from conversation messages
    const systemMessages = openAIRequest.messages.filter(msg => msg.role === 'system');
    const conversationMessages = openAIRequest.messages.filter(msg => msg.role !== 'system');

    // Build the formatted prompt
    const prompt = buildFormattedPrompt(systemMessages, conversationMessages);

    // Create Cortensor request with model config or defaults
    const cortensorRequest: CortensorRequest = {
      session_id: sessionId,
      prompt,
      prompt_type: modelConfig?.promptType ?? 1,
      prompt_template: modelConfig?.promptTemplate ?? '',
      stream: modelConfig?.stream ?? false,
      timeout: modelConfig?.timeout ?? 60,
      client_reference: `user-request-${Date.now()}`,
      max_tokens: modelConfig?.maxTokens ?? openAIRequest.max_tokens ?? 128,
      temperature: modelConfig?.temperature ?? openAIRequest.temperature ?? 0.7,
      top_p: modelConfig?.topP ?? 0.95,
      top_k: modelConfig?.topK ?? 40,
      presence_penalty: modelConfig?.presencePenalty ?? 0,
      frequency_penalty: modelConfig?.frequencyPenalty ?? 0
    };

    

    return cortensorRequest;
  } catch (error) {
    console.error('Error transforming to Cortensor format:', error);
    throw new Error('Failed to transform request to Cortensor format');
  }
}

/**
 * Creates a standardized error response in OpenAI format
 * @param errorMessage - The error message to include
 * @returns OpenAI-formatted error response
 */
function createErrorResponse(errorMessage: string = 'Sorry, I encountered an error processing your request.'): OpenAIResponse {
  return {
    id: `cortensor-error-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: 'cortensor-model',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant' as const,
          content: errorMessage
        },
        finish_reason: 'stop'
      }
    ]
  };
}


/**
 * Transforms Cortensor response to OpenAI format
 * @param cortensorResponse - The response from Cortensor API
 * @returns Promise<Response> - OpenAI-formatted response
 */
export async function transformToOpenAI(cortensorResponse: Response): Promise<Response> {
  try {
    const cortensorData = await cortensorResponse.json() as CortensorResponse;

    // Transform choices to OpenAI format
    const transformedChoices = cortensorData.choices.map((choice: CortensorChoice, index: number) => ({
      index: choice.index ?? index,
      message: {
        role: 'assistant' as const,
        content: choice.text || ''
      },
      finish_reason: choice.finish_reason || 'stop'
    }));

    // Transform usage information
    const transformedUsage = cortensorData.usage ? {
      prompt_tokens: cortensorData.usage.prompt_tokens,
      completion_tokens: cortensorData.usage.completion_tokens,
      total_tokens: cortensorData.usage.total_tokens
    } : {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0
    };

    // Create OpenAI-formatted response
    const openAIResponse: OpenAIResponse = {
      id: cortensorData.id || `cortensor-${Date.now()}`,
      object: 'chat.completion',
      created: cortensorData.created || Math.floor(Date.now() / 1000),
      model: cortensorData.model || 'cortensor-model',
      choices: transformedChoices,
      usage: transformedUsage
    };

    // Return as Response object
    return new Response(
      JSON.stringify(openAIResponse),
      {
        status: cortensorResponse.status,
        statusText: cortensorResponse.statusText,
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );
  } catch (error) {
    console.error('Error transforming from Cortensor format:', error);

    // Return standardized error response
    const errorResponse = createErrorResponse();
    return new Response(
      JSON.stringify(errorResponse),
      {
        status: 500,
        statusText: 'Internal Server Error',
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}

// ============================================================================
// NOTES
// ============================================================================
// - Streaming is currently disabled - all responses are sent at once
// - The transformer handles both successful responses and error cases
// - All responses are converted to OpenAI-compatible format for SDK integration