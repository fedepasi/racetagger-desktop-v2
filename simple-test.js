// Test semplice per verificare la creazione di standalone executions via Supabase
const { createClient } = require('@supabase/supabase-js');

// Configura il client Supabase (dovremmo usare le stesse credenziali dell'app)
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

console.log('🧪 Test standalone execution via Supabase diretto');
console.log('Supabase URL:', supabaseUrl ? 'Configurato' : 'NON configurato');

async function testStandaloneExecution() {
  if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Credenziali Supabase non trovate. Assicurati che .env sia configurato.');
    return;
  }
  
  const supabase = createClient(supabaseUrl, supabaseKey);
  
  try {
    // Test 1: Verifichiamo se possiamo connetterci
    console.log('\n🔬 Test 1: Connessione a Supabase');
    const { data: testData, error: testError } = await supabase
      .from('executions')
      .select('id')
      .limit(1);
    
    if (testError) {
      console.error('❌ Errore connessione:', testError);
      return;
    }
    console.log('✅ Connessione a Supabase riuscita');
    
    // Test 2: Creiamo un'execution standalone (senza project_id)
    console.log('\n🔬 Test 2: Creazione execution standalone');
    const standaloneExecution = {
      project_id: null, // NULL per standalone
      user_id: '3b915e07-ac38-4041-9d1a-d8b6b17eb613', // User ID dall'app log
      name: `Test_Standalone_${new Date().toISOString().replace(/[:.]/g, '-')}`,
      execution_at: new Date().toISOString(),
      status: 'running'
    };
    
    console.log('Dati execution:', standaloneExecution);
    
    const { data: executionData, error: executionError } = await supabase
      .from('executions')
      .insert([standaloneExecution])
      .select()
      .single();
    
    if (executionError) {
      console.error('❌ Errore creazione execution:', executionError);
      return;
    }
    
    console.log('✅ Execution standalone creata:', executionData);
    const executionId = executionData.id;
    
    // Test 3: Tracciamo le settings per questa execution
    console.log('\n🔬 Test 3: Tracciamento execution settings');
    const settings = {
      execution_id: executionId,
      user_id: '3b915e07-ac38-4041-9d1a-d8b6b17eb613',
      ai_model: 'gemini-3.5-flash',
      sport_category: 'motorsport',
      update_exif: true,
      save_preview_images: false,
      resize_enabled: false,
      parallel_processing_enabled: false,
      total_images_processed: 10,
      csv_data_used: false
    };
    
    console.log('Dati settings:', settings);
    
    const { data: settingsData, error: settingsError } = await supabase
      .from('execution_settings')
      .insert([settings])
      .select()
      .single();
    
    if (settingsError) {
      console.error('❌ Errore salvataggio settings:', settingsError);
      return;
    }
    
    console.log('✅ Settings salvate:', settingsData);
    
    // Test 4: Verifichiamo che i dati siano stati salvati
    console.log('\n🔬 Test 4: Verifica dati salvati');
    
    const { data: verificationData, error: verificationError } = await supabase
      .from('execution_settings')
      .select(`
        *,
        executions (
          id,
          project_id,
          name,
          status
        )
      `)
      .eq('execution_id', executionId)
      .single();
    
    if (verificationError) {
      console.error('❌ Errore verifica dati:', verificationError);
      return;
    }
    
    console.log('✅ Dati salvati e verificati:', JSON.stringify(verificationData, null, 2));
    
    console.log('\n🎉 Test completato con successo!');
    console.log('📊 Sistema standalone execution tracking funziona correttamente');
    
  } catch (error) {
    console.error('❌ Errore generale:', error);
  }
}

testStandaloneExecution();