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

// Type exports
export type {
  CortensorConfig,
  CortensorModelConfig,
} from './provider';

// Transformer exports (for advanced usage)
export {
  transformToCortensor,
  transformToOpenAI,
} from './transformers';

// Transformer type exports
export type {
  OpenAIRequest,
  CortensorRequest,
  OpenAIResponse,
  CortensorResponse,
  CortensorChoice,
  CortensorUsage,
} from './transformers';