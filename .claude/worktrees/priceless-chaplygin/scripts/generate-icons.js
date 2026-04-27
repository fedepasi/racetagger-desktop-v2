#!/usr/bin/env node

/**
 * Generate multi-resolution icons for Windows from the main PNG logo
 * Creates .ico file with multiple sizes for proper Windows integration
 */

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

// Icon sizes for Windows ICO file (standard Windows icon sizes)
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

// PNG logo path
const SOURCE_PNG = path.join(__dirname, '..', 'racetagger-logo.png');
const OUTPUT_ICO = path.join(__dirname, '..', 'resources', 'icon.ico');
const OUTPUT_DIR = path.join(__dirname, '..', 'resources', 'icons');

async function generateIcons() {
  console.log('🎨 Generating Windows icons from PNG logo...');
  console.log(`Source: ${SOURCE_PNG}`);
  console.log(`Output: ${OUTPUT_ICO}`);

  // Check if source exists
  if (!fs.existsSync(SOURCE_PNG)) {
    console.error(`❌ Source PNG not found: ${SOURCE_PNG}`);
    process.exit(1);
  }

  // Create output directories
  if (!fs.existsSync(path.dirname(OUTPUT_ICO))) {
    fs.mkdirSync(path.dirname(OUTPUT_ICO), { recursive: true });
  }
  
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  try {
    // Get source image info
    const sourceInfo = await sharp(SOURCE_PNG).metadata();
    console.log(`📏 Source image: ${sourceInfo.width}x${sourceInfo.height} pixels`);

    // Generate individual PNG files for each size
    console.log('🔄 Generating individual icon sizes...');
    const pngFiles = [];

    for (const size of ICO_SIZES) {
      const outputPath = path.join(OUTPUT_DIR, `icon-${size}x${size}.png`);
      
      await sharp(SOURCE_PNG)
        .resize(size, size, {
          kernel: sharp.kernel.lanczos3,
          fit: 'contain',
          background: { r: 0, g: 0, b: 0, alpha: 0 }
        })
        .png({
          compressionLevel: 9,
          adaptiveFiltering: true
        })
        .toFile(outputPath);

      pngFiles.push(outputPath);
      console.log(`  ✓ ${size}x${size} saved to ${path.basename(outputPath)}`);
    }

    // Create ICO file using to-ico for proper multi-resolution support
    console.log('🔧 Creating ICO file...');
    await createProperIcoFile(pngFiles, OUTPUT_ICO);

    // Create additional formats for different use cases
    console.log('🎯 Creating additional icon formats...');
    
    // Create 512x512 PNG for high-DPI displays
    await sharp(SOURCE_PNG)
      .resize(512, 512, {
        kernel: sharp.kernel.lanczos3,
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      })
      .png()
      .toFile(path.join(OUTPUT_DIR, 'icon-512x512.png'));
    console.log('  ✓ 512x512 PNG for high-DPI');

    // Create 1024x1024 PNG for very high-DPI displays
    await sharp(SOURCE_PNG)
      .resize(1024, 1024, {
        kernel: sharp.kernel.lanczos3,
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      })
      .png()
      .toFile(path.join(OUTPUT_DIR, 'icon-1024x1024.png'));
    console.log('  ✓ 1024x1024 PNG for ultra high-DPI');

    console.log('');
    console.log('✅ Icon generation completed successfully!');
    console.log('');
    console.log('Generated files:');
    console.log(`  📁 ${OUTPUT_DIR}/`);
    ICO_SIZES.concat([512, 1024]).forEach(size => {
      console.log(`    🖼  icon-${size}x${size}.png`);
    });
    console.log(`  🎯 ${path.basename(OUTPUT_ICO)} (Windows ICO file)`);
    console.log('');
    console.log('📝 Next steps:');
    console.log('1. Update package.json build configuration to use resources/icon.ico');
    console.log('2. Test Windows build with: npm run build -- --win');
    console.log('3. Verify icon appears correctly in Windows Explorer and taskbar');

  } catch (error) {
    console.error('❌ Error generating icons:', error);
    process.exit(1);
  }
}

/**
 * Create ICO file from multiple PNG files
 * ICO format contains multiple images in one file
 */
async function createIcoFile(pngFiles, outputPath) {
  // Since Sharp doesn't support ICO output, we'll use a simple approach
  // that works well for Electron apps: use the largest PNG as ICO
  
  // For a proper ICO file with multiple sizes, we'd need a specialized library
  // For now, let's create a high-quality 256x256 version and rename it
  const largestPng = pngFiles.find(file => file.includes('256x256'));
  
  if (largestPng) {
    // Copy the 256x256 PNG as our ICO file
    // Most modern Windows systems handle PNG data in ICO files
    const data = fs.readFileSync(largestPng);
    fs.writeFileSync(outputPath, data);
    console.log(`  ✓ ICO file created (based on 256x256 PNG)`);
  } else {
    throw new Error('Could not find 256x256 PNG for ICO creation');
  }
  
  // Note: For production apps, consider using a library like 'to-ico' 
  // to create proper multi-size ICO files
  console.log('  ℹ️  For optimal results, consider using a specialized ICO creation tool');
}

// Create proper ICO file with to-ico
async function createProperIcoFile(pngFiles, outputPath) {
  try {
    // Use to-ico for proper multi-resolution ICO
    const toIco = require('to-ico');
    
    // Read all PNG files
    const pngBuffers = await Promise.all(
      pngFiles.map(file => fs.promises.readFile(file))
    );
    
    // Create ICO buffer
    const icoBuffer = await toIco(pngBuffers);
    
    // Write ICO file
    await fs.promises.writeFile(outputPath, icoBuffer);
    console.log('  ✓ Proper multi-size ICO file created');
    
  } catch (error) {
    // Fallback to simple method
    console.log('  ⚠️  to-ico failed, using fallback method');
    console.log('  Error:', error.message);
    await createIcoFile(pngFiles, outputPath);
  }
}

// Add installation instructions for better ICO support
function printEnhancementInstructions() {
  console.log('');
  console.log('🚀 For enhanced ICO file generation:');
  console.log('Run: npm install --save-dev to-ico');
  console.log('This will create proper multi-resolution ICO files.');
  console.log('');
}

// Run the script
if (require.main === module) {
  generateIcons()
    .then(() => {
      printEnhancementInstructions();
    })
    .catch(error => {
      console.error('Script failed:', error);
      process.exit(1);
    });
}

module.exports = { generateIcons };