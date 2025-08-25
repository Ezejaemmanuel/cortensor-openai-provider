/**
 * Cortensor AI Provider
 * 
 * A drop-in OpenAI-compatible provider for the Cortensor API that works seamlessly
 * with the Vercel AI SDK and any framework that supports OpenAI providers.
 * 
 * @example
 * ```typescript
 * import { cortensorProvider, cortensorModel } from 'cortensor-ai-provider';
 * import { generateText } from 'ai';
 * 
 * // Using the provider directly
 * const result = await generateText({
 *   model: cortensorProvider('cortensor-chat'),
 *   prompt: 'Hello, world!',
 * });
 * 
 * // Using the model with configuration
 * const model = cortensorModel({
 *   sessionId: 123,
 *   temperature: 0.7,
 *   maxTokens: 1000,
 * });
 * 
 * const result = await generateText({
 *   model,
 *   prompt: 'Tell me a story',
 * });
 * ```
 */

// Main provider exports
export {
  cortensorProvider,
  cortensorModel,
  createCortensorProvider,
  clearModelConfigurations,
  getStoredConfigurationsCount,
} from './provider';

// Configuration type exports from provider
export type {
  CortensorConfig,
} from './provider';

// All other type exports from types
export type {
  CortensorModelConfig,
  WebSearchConfig,
  WebSearchResult,
  WebSearchRequest,
  WebSearchProvider,
  WebSearchCallback,
  OpenAIRequest,
  CortensorRequest,
  OpenAIResponse,
  CortensorResponse,
  CortensorChoice,
  CortensorUsage,
  SearchDirectives,
  CortensorTransformResult,
  OpenAIToolCall,
  OpenAIMessage,
  OpenAIChoice,
  OpenAIUsage,
} from './types';

// Tavily provider exports
export {
  createTavilySearch,
} from './providers/tavily';

export type {
  TavilySearchOptions,
} from './providers/tavily';

// Transformer function exports
export {
  transformToCortensor,
  transformToOpenAI,
  extractSearchDirectives,
  generateSearchQuery,
  formatSearchResults,
  buildPromptWithSearchResults,
} from './transformers';