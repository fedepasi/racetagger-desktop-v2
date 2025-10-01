const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Usa le stesse credenziali dell'app
const SUPABASE_URL = 'https://taompbzifylmdzgbbrpv.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRhb21wYnppZnlsbWR6Z2JicnB2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDU4NDQ3ODYsImV4cCI6MjA2MTQyMDc4Nn0.y1s6em-Fzy012g-RA-Mxcl5LKuxBeRYS9epb35b1yR8';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function testUpload() {
  try {
    console.log('=== SUPABASE UPLOAD TEST ===');

    // Leggi il token salvato dall'app
    const tokenPath = path.join(require('os').homedir(), 'Library/Application Support/racetagger-desktop/session.json');

    if (!fs.existsSync(tokenPath)) {
      throw new Error('Session file not found. Please login through the app first.');
    }

    const session = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
    console.log('Session found:', !!session.access_token);

    // Imposta la sessione
    const { error: authError } = await supabase.auth.setSession(session);
    if (authError) {
      console.error('Auth error:', authError);
      throw authError;
    }

    // Verifica che siamo autenticati
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError) {
      console.error('User error:', userError);
      throw userError;
    }

    if (!user) {
      throw new Error('User not authenticated');
    }

    console.log('✅ Authenticated as:', user.email);
    console.log('✅ User ID:', user.id);

    // Leggi il file JSONL più recente
    const filePath = '/Users/federicopasinetti/Library/Application Support/racetagger-desktop/.analysis-logs/exec_e33e2bb2-ab24-4491-b667-449448ed9c51.jsonl';

    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const fileContent = fs.readFileSync(filePath);
    console.log('✅ File read successfully:', fileContent.length, 'bytes');

    // Crea il path di destinazione (stesso formato dell'app)
    const uploadPath = `${user.id}/2025-09-17/test_manual_upload.jsonl`;
    console.log('📁 Upload path:', uploadPath);

    // Prova l'upload
    console.log('🚀 Attempting upload...');

    const { data, error } = await supabase.storage
      .from('analysis-logs')
      .upload(uploadPath, fileContent, {
        cacheControl: '3600',
        upsert: true,
        contentType: 'application/x-ndjson'
      });

    if (error) {
      console.error('❌ Upload failed!');
      console.error('Error message:', error.message);
      console.error('Error details:', JSON.stringify(error, null, 2));

      // Prova anche senza upsert
      console.log('\n🔄 Trying without upsert...');
      const { data: data2, error: error2 } = await supabase.storage
        .from('analysis-logs')
        .upload(uploadPath + '_no_upsert', fileContent, {
          cacheControl: '3600',
          upsert: false,
          contentType: 'application/x-ndjson'
        });

      if (error2) {
        console.error('❌ Also failed without upsert:', error2.message);
      } else {
        console.log('✅ Success without upsert!');
      }

    } else {
      console.log('✅ Upload successful!');
      console.log('📄 Data:', data);

      // Ottieni URL pubblico
      const { data: { publicUrl } } = supabase.storage
        .from('analysis-logs')
        .getPublicUrl(uploadPath);
      console.log('🌐 Public URL:', publicUrl);

      // Verifica che il file sia accessibile
      try {
        const { data: downloadData, error: downloadError } = await supabase.storage
          .from('analysis-logs')
          .download(uploadPath);

        if (downloadError) {
          console.error('❌ Download test failed:', downloadError);
        } else {
          console.log('✅ Download test successful:', downloadData.size, 'bytes');
        }
      } catch (e) {
        console.error('❌ Download test exception:', e.message);
      }
    }

  } catch (error) {
    console.error('💥 Test failed with exception:', error.message);
    console.error('Stack:', error.stack);
  }
}

// Aggiungi anche test delle policy
async function testPolicies() {
  try {
    console.log('\n=== POLICY TEST ===');

    // Test delle policy attuali
    const { data, error } = await supabase
      .from('pg_policies')
      .select('policyname, permissive, cmd, qual, with_check')
      .eq('tablename', 'objects')
      .eq('schemaname', 'storage')
      .like('qual', '%analysis-logs%');

    if (error) {
      console.error('Policy query error:', error);
    } else {
      console.log('Current policies for analysis-logs:');
      data.forEach(policy => {
        console.log(`- ${policy.policyname} (${policy.cmd}): ${policy.permissive}`);
      });
    }
  } catch (e) {
    console.log('Could not query policies (expected):', e.message);
  }
}

// Esegui entrambi i test
(async () => {
  await testUpload();
  await testPolicies();
})();