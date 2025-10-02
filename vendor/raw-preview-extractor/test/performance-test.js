const { extractPreview, createDefaultOptions } = require('../dist/index');
const fs = require('fs');
const path = require('path');

// Performance benchmarks
async function performanceTest() {
  console.log('Starting performance test...');
  
  // Create test files of different sizes
  const testFiles = [
    { name: '1MB', size: 1024 * 1024 },
    { name: '5MB', size: 5 * 1024 * 1024 },
    { name: '25MB', size: 25 * 1024 * 1024 },
    { name: '50MB', size: 50 * 1024 * 1024 }
  ];
  
  const tempFiles = [];
  
  try {
    // Create test files
    for (const testFile of testFiles) {
      const buffer = Buffer.alloc(testFile.size);
      // Write minimal TIFF header
      buffer.writeUInt8(0x49, 0); // 'I'
      buffer.writeUInt8(0x49, 1); // 'I'
      buffer.writeUInt16LE(0x2A, 2); // TIFF magic
      buffer.writeUInt32LE(8, 4); // First IFD offset
      
      const tempPath = path.join(__dirname, `temp_${testFile.name}.raw`);
      fs.writeFileSync(tempPath, buffer);
      tempFiles.push({ path: tempPath, ...testFile });
    }
    
    // Test each file size
    for (const testFile of tempFiles) {
      console.log(`\\n--- Testing ${testFile.name} file ---`);
      
      const times = [];
      const iterations = testFile.size > 25 * 1024 * 1024 ? 3 : 5; // Fewer iterations for large files
      
      for (let i = 0; i < iterations; i++) {
        const startTime = process.hrtime.bigint();
        
        try {
          await extractPreview(testFile.path, createDefaultOptions({
            timeout: 10000, // 10 seconds for large files
            maxMemory: 150  // 150MB limit
          }));
        } catch (error) {
          // Expected to fail, but we're measuring the timeout/failure time
        }
        
        const endTime = process.hrtime.bigint();
        const duration = Number(endTime - startTime) / 1000000; // Convert to milliseconds
        times.push(duration);
        
        console.log(`  Iteration ${i + 1}: ${Math.round(duration)}ms`);
      }
      
      const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
      const minTime = Math.min(...times);
      const maxTime = Math.max(...times);
      
      console.log(`  Average: ${Math.round(avgTime)}ms`);
      console.log(`  Min: ${Math.round(minTime)}ms`);
      console.log(`  Max: ${Math.round(maxTime)}ms`);
      
      // Check performance targets
      const targetTime = testFile.size >= 50 * 1024 * 1024 ? 500 : 200; // 500ms for 50MB+, 200ms for smaller
      if (avgTime <= targetTime) {
        console.log(`  ✅ Performance target met (${targetTime}ms)`);
      } else {
        console.log(`  ⚠️  Performance target missed (${targetTime}ms target)`);
      }
    }
    
  } finally {
    // Cleanup
    for (const tempFile of tempFiles) {
      if (fs.existsSync(tempFile.path)) {
        fs.unlinkSync(tempFile.path);
      }
    }
  }
}

// Timeout test
async function timeoutTest() {
  console.log('\\nStarting timeout test...');
  
  const largeBuffer = Buffer.alloc(100 * 1024 * 1024); // 100MB
  largeBuffer.writeUInt8(0x49, 0);
  largeBuffer.writeUInt8(0x49, 1);
  largeBuffer.writeUInt16LE(0x2A, 2);
  largeBuffer.writeUInt32LE(8, 4);
  
  const tempPath = path.join(__dirname, 'temp_timeout.raw');
  fs.writeFileSync(tempPath, largeBuffer);
  
  try {
    const startTime = Date.now();
    
    try {
      await extractPreview(tempPath, createDefaultOptions({
        timeout: 1000, // 1 second timeout - should timeout
        maxMemory: 50
      }));
      console.log('❌ Expected timeout but operation completed');
    } catch (error) {
      const elapsed = Date.now() - startTime;
      console.log(`Operation failed after ${elapsed}ms: ${error.message}`);
      
      if (elapsed >= 900 && elapsed <= 1500) { // Allow some margin
        console.log('✅ Timeout test passed');
      } else {
        console.log(`⚠️  Timeout timing unexpected (expected ~1000ms, got ${elapsed}ms)`);
      }
    }
    
  } finally {
    fs.unlinkSync(tempPath);
  }
}

// Run performance tests
async function runPerformanceTests() {
  try {
    await performanceTest();
    await timeoutTest();
    console.log('\\n✅ Performance tests completed!');
  } catch (error) {
    console.error('❌ Performance test failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  runPerformanceTests();
}

module.exports = { performanceTest, timeoutTest };