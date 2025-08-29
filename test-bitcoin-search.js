/**
 * Simplified Bitcoin price search test
 * Tests Cortensor API with Tavily web search integration
 */

const fs = require('fs');
const path = require('path');

// Setup logging with immediate flushing
const logFile = path.join(__dirname, 'bitcoin-test.log');
const logStream = fs.createWriteStream(logFile, { flags: 'w' });

function log(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;
  
  // Write to file and flush immediately
  logStream.write(logMessage);
  
  // Also write to console
  process.stdout.write(logMessage);
  
  // Force flush to ensure immediate write
  if (logStream.flush) {
    logStream.flush();
  }
}

// Set environment variables
process.env.CORTENSOR_API_KEY = '7412395a-011f-420d-bd1b-0e4960b3f3be';
process.env.CORTENSOR_BASE_URL = 'https://cortensor-ssh-production.up.railway.app';
process.env.TAVILY_API_KEY = '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';

// Load modules
const { cortensorModel, createTavilySearch } = require('./dist/index.js');
const { generateText } = require('ai');

async function testBitcoinSearch() {
  log('🚀 Starting Bitcoin search test...');
  log(`📋 Session ID: 73`);
  log(`📋 API Key: ${process.env.CORTENSOR_API_KEY?.substring(0, 8)}...`);
  
  try {
    // Create Tavily search provider
    log('🔍 Creating Tavily search provider...');
    const tavilySearch = createTavilySearch({
      apiKey: process.env.TAVILY_API_KEY,
      maxResults: 1,
      searchDepth: 'basic',
      includeImages: false
    });
    log('✅ Tavily provider created');

    // Create model
    log('🤖 Creating Cortensor model...');
    const model = cortensorModel({
      sessionId: 75,
      modelName: 'cortensor-chat',
      temperature: 0.7,
      maxTokens: 4000, // Reduced for faster response
      webSearch: {
        mode: 'prompt',
        provider: tavilySearch,
        maxResults: 1
      }
    });
    log('✅ Model created');

    // Make request (no timeout)
    log('💰 Sending Bitcoin price query...');
    log('⏳ Waiting for AI response (this may take a while)...');
    const startTime = Date.now();
    
    const result = await generateText({
      model: model,
      messages: [{
        role: 'user',
        content: ' What is the price of Bitcoin today?'
      }],
      maxRetries: 0,
    });

    const duration = Date.now() - startTime;

    // Log success with immediate flush
    log('🎉 SUCCESS! Request completed');
    log(`⏱️ Duration: ${duration}ms`);
    log(`📝 Response length: ${result.text?.length || 0} characters`);
    log('');
    log('📄 FULL AI RESPONSE:');
    log('='.repeat(80));
    
    // Split response into lines to ensure proper logging
    if (result.text) {
      const lines = result.text.split('\n');
      lines.forEach(line => log(line));
    } else {
      log('❌ No response text received');
    }
    
    log('='.repeat(80));
    log('');
    
    // Log usage stats
    if (result.usage) {
      log('📊 TOKEN USAGE STATS:');
      log(`   - Prompt tokens: ${result.usage.promptTokens}`);
      log(`   - Completion tokens: ${result.usage.completionTokens}`);
      log(`   - Total tokens: ${result.usage.totalTokens}`);
    } else {
      log('❌ No usage stats available');
    }
    
    // Log the complete result object for debugging
    log('');
    log('🔍 COMPLETE RESULT OBJECT:');
    log(JSON.stringify(result, null, 2))
    
  } catch (error) {
    log('❌ TEST FAILED');
    log(`Error Type: ${error.name || 'Unknown'}`);
    log(`Error Message: ${error.message}`);
    
    if (error.stack) {
      log('📚 FULL ERROR STACK:');
      const stackLines = error.stack.split('\n');
      stackLines.forEach(line => log(`   ${line}`));
    }
    
    if (error.cause) {
      log('🔍 ERROR CAUSE:');
      log(JSON.stringify(error.cause, null, 2));
    }
    
    throw error;
  }
}

// Main test runner
async function runTest() {
  try {
    log('🔧 Verifying environment...');
    const requiredVars = ['CORTENSOR_API_KEY', 'CORTENSOR_BASE_URL', 'TAVILY_API_KEY'];
    
    for (const varName of requiredVars) {
      if (!process.env[varName]) {
        throw new Error(`Missing ${varName}`);
      }
      log(`✅ ${varName} is set`);
    }
    
    log('🔄 Running Bitcoin search test...');
    await testBitcoinSearch();
    log('✅ ALL TESTS PASSED');
    
  } catch (error) {
    log(`💥 TEST FAILED: ${error.message}`);
    if (error.stack) {
      log(`Stack: ${error.stack}`);
    }
    process.exit(1);
  }
}

// Improved cleanup function
function cleanup() {
  log('🔧 Cleaning up...');
  
  // Force flush any remaining data
  if (logStream.writable) {
    logStream.end();
  }
  
  // Wait a bit for stream to close
  setTimeout(() => {
    console.log(`📄 Complete logs written to: ${logFile}`);
  }, 100);
}

// Enhanced process handlers
process.on('exit', (code) => {
  log(`🚪 Process exiting with code: ${code}`);
  cleanup();
});

process.on('SIGINT', () => {
  log('🛑 Received SIGINT (Ctrl+C)');
  cleanup();
  process.exit(0);
});

process.on('SIGTERM', () => {
  log('🛑 Received SIGTERM');
  cleanup();
  process.exit(0);
});

process.on('uncaughtException', (error) => {
  log(`💥 UNCAUGHT EXCEPTION: ${error.message}`);
  if (error.stack) {
    log('Stack trace:');
    error.stack.split('\n').forEach(line => log(line));
  }
  cleanup();
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  log(`💥 UNHANDLED REJECTION at: ${promise}`);
  log(`Reason: ${reason}`);
  cleanup();
  process.exit(1);
});

// Run if called directly
if (require.main === module) {
  runTest()
    .then(() => {
      log('🎯 Test completed successfully');
    })
    .catch((error) => {
      log(`💥 Test failed: ${error.message}`);
    })
    .finally(() => {
      cleanup();
    });
}

module.exports = { testBitcoinSearch, runTest };