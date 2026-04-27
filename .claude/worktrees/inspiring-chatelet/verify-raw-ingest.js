/**
 * Verifica rapida per confermare che RAW-ingest sia attivo
 */

const { rawPreviewExtractor } = require('./dist/src/utils/raw-preview-native.js');

async function verifyRawIngest() {
    console.log('🔍 Verifica RAW-ingest Integration');
    console.log('='.repeat(50));
    
    // Controlla capabilities
    const capabilities = rawPreviewExtractor.getCapabilities();
    console.log(`Native library available: ${capabilities.nativeAvailable ? '✅ YES' : '❌ NO'}`);
    
    if (!capabilities.nativeAvailable) {
        console.log('❌ RAW-ingest NON è disponibile');
        return;
    }
    
    // Test su un file specifico
    const testFile = '/Users/federicopasinetti/Desktop/racetagger_sample/racetaggerraw/Mix-raw-jpeg/PAS_9196.NEF';
    
    try {
        console.log(`\n📁 Testing: ${testFile}`);
        
        const result = await rawPreviewExtractor.extractPreview(testFile, {
            useNativeLibrary: true,
            timeout: 10000
        });
        
        if (result.success && result.method === 'native') {
            console.log('✅ RAW-ingest è ATTIVO e funzionante!');
            console.log(`   Metodo: ${result.method}`);
            console.log(`   Formato: ${result.format}`);
            console.log(`   Dimensioni: ${result.width}x${result.height}`);
            console.log(`   Data size: ${(result.data.length / 1024).toFixed(1)}KB`);
            console.log(`   Tempo: ${result.extractionTimeMs}ms`);
        } else if (result.method === 'dcraw-fallback') {
            console.log('⚠️ RAW-ingest non funziona, usando dcraw fallback');
        } else {
            console.log('❌ Estrazione fallita completamente');
        }
        
    } catch (error) {
        console.log(`❌ Errore: ${error.message}`);
    }
}

verifyRawIngest().catch(console.error);