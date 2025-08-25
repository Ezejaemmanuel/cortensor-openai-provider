/**
 * TypeScript Type Definitions for Cortensor OpenAI Provider
 * 
 * This module contains all the interface and type definitions used throughout
 * the Cortensor OpenAI Provider package for type safety and consistency.
 */

import type { ModelMessage } from 'ai';
import type { 
  WebSearchResult, 
  WebSearchCallback, 
  WebSearchProvider,
  CortensorModelConfig,
  WebSearchRequest,
  WebSearchConfig 
} from './provider';

// ============================================================================
// RE-EXPORTED TYPES FROM PROVIDER
// ============================================================================

// Re-export commonly used types from provider for convenience
export type { 
  WebSearchResult, 
  WebSearchCallback, 
  WebSearchProvider,
  CortensorModelConfig,
  WebSearchRequest,
  WebSearchConfig 
};

// ============================================================================
// CORTENSOR API TYPES
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
// OPENAI API TYPES
// ============================================================================

/**
 * Request format from OpenAI/Vercel AI SDK
 */
export interface OpenAIRequest {
  model: string;
  messages: ModelMessage[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  [key: string]: unknown;
}

/**
 * Tool call structure in OpenAI format
 */
export interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

/**
 * Message structure in OpenAI response
 */
export interface OpenAIMessage {
  role: string;
  content: string | null;
  tool_calls?: OpenAIToolCall[];
  refusal?: string | null;
}

/**
 * Choice structure in OpenAI response
 */
export interface OpenAIChoice {
  index: number;
  message: OpenAIMessage;
  finish_reason: string | null;
  logprobs?: any | null;
}

/**
 * Usage information in OpenAI response
 */
export interface OpenAIUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

/**
 * Response format expected by OpenAI/Vercel AI SDK
 */
export interface OpenAIResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: OpenAIChoice[];
  usage?: OpenAIUsage;
  system_fingerprint?: string;
}

// ============================================================================
// WEB SEARCH TYPES
// ============================================================================

/**
 * Search directive information extracted from messages
 */
export interface SearchDirectives {
  shouldSearch: boolean;
  cleanedMessages: ModelMessage[];
}

/**
 * Result of transforming to Cortensor format with optional web search data
 */
export interface CortensorTransformResult {
  request: CortensorRequest;
  webSearchResults?: WebSearchResult[];
  searchQuery?: string;
}