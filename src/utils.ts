import type { CoreMessage } from "ai";
import type { OpenAIResponse, WebSearchResult } from "./types";

/**
 * Creates a standardized error response in OpenAI format
 * @param errorMessage - The error message to include
 * @returns OpenAI-formatted error response
 */
export function createErrorResponse(errorMessage: string = 'Sorry, I encountered an error processing your request.'): OpenAIResponse {
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
 * Builds a formatted prompt from system and conversation messages
 * @param systemMessages - Array of system messages
 * @param conversationMessages - Array of conversation messages
 * @returns Formatted prompt string
 */
export function buildFormattedPrompt(systemMessages: CoreMessage[], conversationMessages: CoreMessage[]): string {
    console.log('📋 [BUILD_FORMATTED_PROMPT] Starting prompt building');
    console.log('📋 [BUILD_FORMATTED_PROMPT] System messages count:', systemMessages.length);
    console.log('📋 [BUILD_FORMATTED_PROMPT] Conversation messages count:', conversationMessages.length);
    
    let prompt = '';

    // Add system instructions section if present
    if (systemMessages.length > 0) {
        console.log('📋 [BUILD_FORMATTED_PROMPT] Processing system messages');
        const systemInstructions = systemMessages
            .map((msg, index) => {
                const content = extractMessageContent(msg);
                console.log(`📋 [BUILD_FORMATTED_PROMPT] System message ${index + 1} content length:`, content.length);
                return content;
            })
            .join('\n\n');

        prompt += `### SYSTEM INSTRUCTIONS ###\n${systemInstructions}\n\n### CONVERSATION ###\n`;
        console.log('📋 [BUILD_FORMATTED_PROMPT] System instructions added, current prompt length:', prompt.length);
    }

    // Add conversation history with role formatting
    console.log('📋 [BUILD_FORMATTED_PROMPT] Processing conversation messages');
    const conversationText = conversationMessages
        .map((msg, index) => {
            const content = extractMessageContent(msg);
            console.log(`📋 [BUILD_FORMATTED_PROMPT] Conversation message ${index + 1} (${msg.role}):`, {
                contentLength: content.length,
                preview: content.substring(0, 50) + (content.length > 50 ? '...' : '')
            });
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
    console.log('📋 [BUILD_FORMATTED_PROMPT] Conversation text added, current prompt length:', prompt.length);

    // Get current date and time for context
    const now = new Date();
    const currentDateTime = now.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    }) + ' at ' + now.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZoneName: 'short'
    });

    prompt += `\n\n--- CURRENT DATE AND TIME ---\n${currentDateTime}`;
    console.log('📋 [BUILD_FORMATTED_PROMPT] Date/time added:', currentDateTime);

    // Add assistant prompt if the last message is from user
    const lastMessage = conversationMessages[conversationMessages.length - 1];
    if (conversationMessages.length > 0 && lastMessage?.role === 'user') {
        prompt += '\n\nAssistant:';
        console.log('📋 [BUILD_FORMATTED_PROMPT] Assistant prompt added (last message was from user)');
    }

    console.log('📋 [BUILD_FORMATTED_PROMPT] Final prompt built, total length:', prompt.length);
    console.log('📋 [BUILD_FORMATTED_PROMPT] Prompt preview:', prompt.substring(0, 200) + (prompt.length > 200 ? '...' : ''));
    
    return prompt;
}
  

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Extracts text content from a message, handling both string and array formats
 * @param message - The message to extract content from
 * @returns The extracted text content
 */
export function extractMessageContent(message: CoreMessage): string {
    console.log('📝 [EXTRACT_CONTENT] Extracting message content');
    console.log('📝 [EXTRACT_CONTENT] Message role:', message.role);
    console.log('📝 [EXTRACT_CONTENT] Content type:', typeof message.content);
    
    if (typeof message.content === 'string') {
        console.log('📝 [EXTRACT_CONTENT] String content length:', message.content.length);
        console.log('📝 [EXTRACT_CONTENT] String content preview:', message.content.substring(0, 200) + (message.content.length > 200 ? '...' : ''));
        return message.content;
    }

    if (Array.isArray(message.content)) {
        console.log('📝 [EXTRACT_CONTENT] Array content length:', message.content.length);
        const extractedContent = message.content
            .filter(part => {
                // Handle string parts
                if (typeof part === 'string') {
                    console.log('📝 [EXTRACT_CONTENT] Found string part, length:', part);
                    return true;
                }
                // Handle text objects
                if (typeof part === 'object' && part !== null && 'type' in part) {
                    console.log('📝 [EXTRACT_CONTENT] Found object part, type:', (part as any).type);
                    return part.type === 'text';
                }
                console.log('📝 [EXTRACT_CONTENT] Skipping unknown part type:', typeof part);
                return false;
            })
            .map(part => {
                if (typeof part === 'string') {
                    return part;
                }
                // Extract text from text objects
                const text = (part as any).text || '';
                console.log('📝 [EXTRACT_CONTENT] Extracted text from object, length:', text.length);
                return text;
            })
            .join(' ')
            .trim();
        console.log('📝 [EXTRACT_CONTENT] Final extracted content length:', extractedContent.length);
        console.log('📝 [EXTRACT_CONTENT] Final extracted content preview:', extractedContent.substring(0, 200) + (extractedContent.length > 200 ? '...' : ''));
        return extractedContent;
    }

    console.log('📝 [EXTRACT_CONTENT] Unknown content format, returning empty string');
    return '';
}
  

/**
 * Formats search results as numbered citations with a sources section
 * @param results - Array of search results
 * @returns Formatted search results with numbered citations and sources section
 */
export function formatSearchResults(
    results: WebSearchResult[]
): string {
    console.log('🔗 [FORMAT_SEARCH] Starting search results formatting');
    console.log('🔗 [FORMAT_SEARCH] Results count:', results.length);

    if (results.length === 0) {
        console.log('🔗 [FORMAT_SEARCH] No results to format, returning empty string');
        return '';
    }

    // Create the sources section
    console.log('🔗 [FORMAT_SEARCH] Creating sources section');
    const sources = results
        .map((result, index) => {
            console.log(`🔗 [FORMAT_SEARCH] Formatting result ${index + 1}:`, {
                title: result.title,
                url: result.url,
                hasSnippet: !!result.snippet
            });
            return `[${index + 1}] [${result.title}](${result.url})`;
        })
        .join('\n');

    const formattedResults = `\n\n**Sources:**\n${sources}`;
    console.log('🔗 [FORMAT_SEARCH] Formatted results length:', formattedResults.length);
    console.log('🔗 [FORMAT_SEARCH] Formatted results preview:', formattedResults.substring(0, 200) + (formattedResults.length > 200 ? '...' : ''));

    return formattedResults;
}