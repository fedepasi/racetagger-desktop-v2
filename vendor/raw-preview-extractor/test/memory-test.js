const { extractPreview, createDefaultOptions } = require('../dist/index');
const fs = require('fs');
const path = require('path');

// Memory leak test
async function memoryLeakTest() {
  console.log('Starting memory leak test...');
  
  // Force garbage collection if available
  if (global.gc) {
    global.gc();
  }
  
  const initialMemory = process.memoryUsage();
  console.log('Initial memory:', initialMemory);
  
  // Create a fake RAW file buffer for testing (minimum valid TIFF structure)
  const fakeRawBuffer = Buffer.alloc(1024 * 1024); // 1MB buffer
  // Write TIFF header (little-endian)
  fakeRawBuffer.writeUInt8(0x49, 0); // 'I'
  fakeRawBuffer.writeUInt8(0x49, 1); // 'I' 
  fakeRawBuffer.writeUInt16LE(0x2A, 2); // TIFF magic
  fakeRawBuffer.writeUInt32LE(8, 4); // First IFD offset
  
  const tempFilePath = path.join(__dirname, 'temp_test.raw');
  fs.writeFileSync(tempFilePath, fakeRawBuffer);
  
  try {
    // Perform many extractions to test for memory leaks
    for (let i = 0; i < 100; i++) {
      try {
        await extractPreview(tempFilePath, createDefaultOptions({
          timeout: 1000, // 1 second timeout
          maxMemory: 50  // 50MB limit
        }));
      } catch (error) {
        // Expected to fail, but shouldn't leak memory
        if (i % 10 === 0) {
          console.log(`Iteration ${i}: ${error.message}`);
        }
      }
      
      // Force garbage collection every 10 iterations
      if (i % 10 === 0 && global.gc) {
        global.gc();
      }
    }
    
    // Final memory check
    if (global.gc) {
      global.gc();
    }
    
    const finalMemory = process.memoryUsage();
    console.log('Final memory:', finalMemory);
    
    const memoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed;
    console.log(`Memory increase: ${Math.round(memoryIncrease / 1024)} KB`);
    
    if (memoryIncrease > 10 * 1024 * 1024) { // 10MB threshold
      console.error('WARNING: Potential memory leak detected!');
      process.exit(1);
    } else {
      console.log('✅ Memory leak test passed');
    }
    
  } finally {
    // Cleanup
    fs.unlinkSync(tempFilePath);
  }
}

// Concurrent access test
async function concurrentAccessTest() {
  console.log('Starting concurrent access test...');
  
  const fakeRawBuffer = Buffer.alloc(512 * 1024); // 512KB buffer
  fakeRawBuffer.writeUInt8(0x49, 0); // 'I'
  fakeRawBuffer.writeUInt8(0x49, 1); // 'I'
  fakeRawBuffer.writeUInt16LE(0x2A, 2); // TIFF magic
  fakeRawBuffer.writeUInt32LE(8, 4); // First IFD offset
  
  const tempFilePath = path.join(__dirname, 'temp_concurrent.raw');
  fs.writeFileSync(tempFilePath, fakeRawBuffer);
  
  try {
    const promises = [];
    const startTime = Date.now();
    
    // Launch 10 concurrent extraction attempts
    for (let i = 0; i < 10; i++) {
      promises.push(
        extractPreview(tempFilePath, createDefaultOptions({
          timeout: 2000
        })).catch(err => ({ error: err.message }))
      );
    }
    
    const results = await Promise.all(promises);
    const endTime = Date.now();
    
    console.log(`Completed ${results.length} concurrent operations in ${endTime - startTime}ms`);
    
    let errorCount = 0;
    results.forEach((result, index) => {
      if (result.error) {
        errorCount++;
        if (index < 3) { // Show first 3 errors
          console.log(`  Result ${index}: ${result.error}`);
        }
      }
    });
    
    console.log(`✅ Concurrent access test completed (${errorCount} expected errors)`);
    
  } finally {
    fs.unlinkSync(tempFilePath);
  }
}

// Run tests
async function runTests() {
  try {
    await memoryLeakTest();
    await concurrentAccessTest();
    console.log('✅ All memory tests passed!');
  } catch (error) {
    console.error('❌ Memory test failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  runTests();
}

module.exports = { memoryLeakTest, concurrentAccessTest };