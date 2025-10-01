/**
 * Test script per verificare che il temporal clustering usi SOLO DateTimeOriginal
 *
 * Questo script testa:
 * 1. Estrazione timestamp solo da DateTimeOriginal
 * 2. Esclusione di immagini senza DateTimeOriginal
 * 3. Ignorare CreateDate/ModifyDate anche se presenti
 */

const { exec } = require('child_process');
const fs = require('fs').promises;
const path = require('path');

class TemporalClusteringTest {
  constructor() {
    this.exiftoolPath = './vendor/darwin/exiftool';
    this.testDir = '/tmp/temporal-test';
    this.testImages = [
      {
        name: 'with_datetimeoriginal.jpg',
        hasDateTimeOriginal: true,
        description: 'Image WITH DateTimeOriginal - should be included'
      },
      {
        name: 'without_datetimeoriginal.jpg',
        hasDateTimeOriginal: false,
        description: 'Image WITHOUT DateTimeOriginal - should be excluded'
      },
      {
        name: 'only_createdate.jpg',
        hasDateTimeOriginal: false,
        hasCreateDate: true,
        description: 'Image with CreateDate but NO DateTimeOriginal - should be excluded'
      }
    ];
  }

  async runTest() {
    console.log('🧪 Starting Temporal Clustering DateTimeOriginal Test');
    console.log('='*70);

    try {
      await this.setupTestEnvironment();
      await this.createTestImages();
      await this.testTimestampExtraction();
      await this.testClusteringBehavior();
      await this.cleanup();

      console.log('\n✅ All tests completed successfully!');
    } catch (error) {
      console.error('\n❌ Test failed:', error);
    }
  }

  async setupTestEnvironment() {
    console.log('\n📁 Setting up test environment...');

    try {
      await fs.mkdir(this.testDir, { recursive: true });
      console.log(`   Created test directory: ${this.testDir}`);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      console.log(`   Test directory already exists: ${this.testDir}`);
    }
  }

  async createTestImages() {
    console.log('\n🖼️  Creating test images...');

    // Find a source image to copy (these should have DateTimeOriginal)
    const sampleImagePaths = [
      '/Users/federicopasinetti/Desktop/racetagger_sample/racetaggerraw/Mix-raw-jpeg/ACI_Sport_MONZA_009_7.jpg',
      '/Users/federicopasinetti/Desktop/racetagger_sample/racetaggerraw/Mix-raw-jpeg/ACI_Sport_MONZA_009_6.jpg',
      '/Users/federicopasinetti/Desktop/racetagger_sample/racetaggerraw/Mix-raw-jpeg/ACI_Sport_MONZA_017_2.jpg'
    ];

    let sourceImage = null;
    for (const imagePath of sampleImagePaths) {
      try {
        await fs.access(imagePath);
        sourceImage = imagePath;
        break;
      } catch (error) {
        continue;
      }
    }

    if (!sourceImage) {
      throw new Error('No source image found for testing');
    }

    console.log(`   Using source image: ${path.basename(sourceImage)}`);

    // Create test images with different EXIF configurations
    for (const testImage of this.testImages) {
      const testImagePath = path.join(this.testDir, testImage.name);

      // Copy source image with EXIF preservation
      await this.execCommand(`cp "${sourceImage}" "${testImagePath}"`);

      if (testImage.hasDateTimeOriginal) {
        // Keep original EXIF including DateTimeOriginal
        console.log(`   ✅ ${testImage.name}: Kept DateTimeOriginal`);
      } else {
        // Remove DateTimeOriginal but keep CreateDate/ModifyDate
        await this.execCommand(`"${this.exiftoolPath}" -DateTimeOriginal= -overwrite_original "${testImagePath}"`);

        if (testImage.hasCreateDate) {
          // Ensure CreateDate exists
          const testDate = '2024:01:15 10:30:45';
          await this.execCommand(`"${this.exiftoolPath}" -CreateDate="${testDate}" -overwrite_original "${testImagePath}"`);
          console.log(`   🚫 ${testImage.name}: Removed DateTimeOriginal, kept CreateDate`);
        } else {
          console.log(`   🚫 ${testImage.name}: Removed DateTimeOriginal`);
        }
      }
    }
  }

  async testTimestampExtraction() {
    console.log('\n⏰ Testing timestamp extraction...');

    // Import the temporal clustering module
    const { TemporalClusterManager } = require('./dist/src/matching/temporal-clustering.js');
    const temporal = new TemporalClusterManager(this.exiftoolPath);

    for (const testImage of this.testImages) {
      const imagePath = path.join(this.testDir, testImage.name);

      console.log(`\n   Testing: ${testImage.description}`);
      console.log(`   File: ${testImage.name}`);

      // Show raw EXIF data first
      const exifData = await this.getExifData(imagePath);
      console.log(`   Raw EXIF - DateTimeOriginal: ${exifData.DateTimeOriginal || 'MISSING'}`);
      console.log(`   Raw EXIF - CreateDate: ${exifData.CreateDate || 'MISSING'}`);
      console.log(`   Raw EXIF - ModifyDate: ${exifData.ModifyDate || 'MISSING'}`);

      // Test our extraction
      const result = await temporal.extractTimestamp(imagePath);

      console.log(`   Extracted timestamp: ${result.timestamp ? result.timestamp.toISOString() : 'NULL'}`);
      console.log(`   Timestamp source: ${result.timestampSource}`);

      if (result.excludedReason) {
        console.log(`   Exclusion reason: ${result.excludedReason}`);
      }

      // Verify expectations
      if (testImage.hasDateTimeOriginal) {
        if (result.timestamp && result.timestampSource === 'exif') {
          console.log(`   ✅ PASS: Image correctly included in clustering`);
        } else {
          console.log(`   ❌ FAIL: Image should have been included but was excluded`);
        }
      } else {
        if (result.timestamp === null && result.timestampSource === 'excluded') {
          console.log(`   ✅ PASS: Image correctly excluded from clustering`);
        } else {
          console.log(`   ❌ FAIL: Image should have been excluded but was included`);
        }
      }
    }
  }

  async testClusteringBehavior() {
    console.log('\n📊 Testing clustering behavior...');

    const { TemporalClusterManager } = require('./dist/src/matching/temporal-clustering.js');
    const temporal = new TemporalClusterManager(this.exiftoolPath);

    // Extract timestamps for all test images
    const imageTimestamps = [];
    for (const testImage of this.testImages) {
      const imagePath = path.join(this.testDir, testImage.name);
      const timestamp = await temporal.extractTimestamp(imagePath);
      imageTimestamps.push(timestamp);
    }

    console.log(`\n   Processing ${imageTimestamps.length} images for clustering...`);

    // Create clusters
    const clusters = temporal.createClusters(imageTimestamps, 'motorsport');

    console.log(`   Created ${clusters.length} clusters`);

    // Analyze results
    const validImages = imageTimestamps.filter(img => img.timestamp !== null);
    const excludedImages = imageTimestamps.filter(img => img.timestamp === null);

    console.log(`   Valid images (with DateTimeOriginal): ${validImages.length}`);
    console.log(`   Excluded images (no DateTimeOriginal): ${excludedImages.length}`);

    // Expected: 1 valid image, 2 excluded
    if (validImages.length === 1 && excludedImages.length === 2) {
      console.log(`   ✅ PASS: Clustering correctly processed only DateTimeOriginal images`);
    } else {
      console.log(`   ❌ FAIL: Expected 1 valid, 2 excluded images`);
    }

    // Show excluded details
    if (excludedImages.length > 0) {
      console.log(`\n   Excluded images details:`);
      for (const excluded of excludedImages) {
        console.log(`   - ${excluded.fileName}: ${excluded.excludedReason}`);
      }
    }
  }

  async getExifData(imagePath) {
    try {
      const command = `"${this.exiftoolPath}" -DateTimeOriginal -CreateDate -ModifyDate -json "${imagePath}"`;
      const { stdout } = await this.execCommand(command);
      const jsonData = JSON.parse(stdout);
      return jsonData[0] || {};
    } catch (error) {
      console.warn(`Failed to get EXIF data for ${imagePath}:`, error.message);
      return {};
    }
  }

  async execCommand(command) {
    return new Promise((resolve, reject) => {
      exec(command, (error, stdout, stderr) => {
        if (error) reject(error);
        else resolve({ stdout, stderr });
      });
    });
  }

  async cleanup() {
    console.log('\n🧹 Cleaning up test files...');
    try {
      await fs.rm(this.testDir, { recursive: true, force: true });
      console.log(`   Removed test directory: ${this.testDir}`);
    } catch (error) {
      console.warn(`   Warning: Could not remove test directory: ${error.message}`);
    }
  }
}

// Run the test
if (require.main === module) {
  const test = new TemporalClusteringTest();
  test.runTest().catch(console.error);
}

module.exports = { TemporalClusteringTest };