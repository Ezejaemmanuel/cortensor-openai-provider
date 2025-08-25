/**
 * Default configuration constants for Cortensor Provider
 * 
 * This file centralizes all default values used throughout the provider
 * to ensure consistency and easy maintenance.
 */

/**
 * Default model configuration values
 */
export const DEFAULT_MODEL_CONFIG = {
  modelName: 'cortensor-chat',
  temperature: 0.7,
  maxTokens: 3000,
  topP: 0.95,
  topK: 40,
  presencePenalty: 0,
  frequencyPenalty: 0,
  stream: false,
  timeout: 60 * 5,
  promptType: 1,
  promptTemplate: ''
} as const;

