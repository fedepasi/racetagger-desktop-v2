/**
 * Debug specifico per file NEF
 * Stampa in dettaglio cosa succede nel parsing
 */

const fs = require('fs');
const path = require('path');

async function debugNefFile() {
    const testFile = '/Users/federicopasinetti/Desktop/racetagger_sample/racetaggerraw/Mix-raw-jpeg/PAS_9196.NEF';
    
    console.log('🔍 Debug NEF File:', path.basename(testFile));
    console.log('='.repeat(60));
    
    if (!fs.existsSync(testFile)) {
        console.log('❌ File not found');
        return;
    }
    
    const stats = fs.statSync(testFile);
    console.log(`📊 File size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
    
    // Leggi primi bytes per header analysis
    const buffer = fs.readFileSync(testFile);
    console.log('\n🔬 File Header Analysis:');
    console.log('First 16 bytes:', Array.from(buffer.slice(0, 16)).map(b => '0x' + b.toString(16).padStart(2, '0')).join(' '));
    
    // Check TIFF magic
    const magic = buffer.readUInt16LE(2);
    console.log('TIFF Magic:', '0x' + magic.toString(16), '(should be 0x2a)');
    
    // Check first IFD offset
    const firstIfd = buffer.readUInt32LE(4);
    console.log('First IFD offset:', firstIfd);
    
    // Check Make tag around offset 8-100
    console.log('\n🔍 Looking for NIKON make string...');
    const makePattern = 'NIKON';
    for (let i = 0; i < Math.min(1000, buffer.length - 5); i++) {
        if (buffer.slice(i, i + 5).toString() === makePattern) {
            console.log(`Found NIKON string at offset: ${i}`);
        }
    }
    
    // Try with native library with extensive logging
    try {
        console.log('\n🚀 Testing with native library...');
        const nativeLib = require('raw-preview-extractor');
        
        const result = await nativeLib.extractPreview(testFile, {
            targetSize: { min: 100 * 1024, max: 5 * 1024 * 1024 }, // Wider range
            preferQuality: 'preview',
            timeout: 15000,
            maxMemory: 1000, // 1GB
            includeMetadata: true,
            strictValidation: false
        });
        
        console.log('\n📋 Native Library Full Result:');
        console.log(JSON.stringify(result, null, 2));
        
    } catch (error) {
        console.log('\n💥 Native library error:');
        console.log(error.message);
        console.log(error.stack);
    }
    
    // Try with dcraw as comparison
    console.log('\n🔧 Testing with dcraw (for comparison)...');
    try {
        const { execSync } = require('child_process');
        const dcrawCmd = `/Users/federicopasinetti/Documents/WebProjects/Racetagger_V3/desktop/vendor/darwin/dcraw -e "${testFile}"`;
        console.log('Running:', dcrawCmd);
        
        const output = execSync(dcrawCmd, { encoding: 'utf8', timeout: 10000 });
        console.log('dcraw output:', output);
        
        // Check if dcraw created a thumb file
        const thumbFile = testFile.replace('.NEF', '.thumb.jpg');
        if (fs.existsSync(thumbFile)) {
            const thumbStats = fs.statSync(thumbFile);
            console.log(`dcraw created thumb: ${thumbFile} (${thumbStats.size} bytes)`);
            
            // Clean up
            fs.unlinkSync(thumbFile);
        } else {
            console.log('No thumb file created by dcraw');
        }
        
    } catch (dcrawError) {
        console.log('dcraw error:', dcrawError.message);
    }
    
    console.log('\n🏁 Debug completed');
}

debugNefFile().catch(console.error);