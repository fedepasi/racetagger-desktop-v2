// Apply the consume_tokens_for_analysis function migration
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const os = require('os');

const supabaseUrl = 'https://taompbzifylmdzgbbrpv.supabase.co';
// Use service role key for admin operations
const serviceRoleKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRhb21wYnppZnlsbWR6Z2JicnB2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0NTg0NDc4NiwiZXhwIjoyMDYxNDIwNzg2fQ.OKGdyQtZLV6XTUPAjlm3kwttFkvMLHgXnPTcGo9lkRI';

const supabase = createClient(supabaseUrl, serviceRoleKey);

async function applyMigration() {
  console.log('=== APPLYING CONSUME TOKENS FUNCTION MIGRATION ===\n');
  
  // Using service role key - no session needed
  
  // Read the migration file
  const migrationPath = path.join(__dirname, 'supabase/migrations/20250904_120000_create_consume_tokens_function.sql');
  const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
  
  console.log('Applying consume_tokens_for_analysis function...');
  
  try {
    // Execute the migration using direct SQL execution
    const { data, error } = await supabase.rpc('exec_sql', {
      sql: migrationSQL
    });
    
    if (error) {
      console.error('❌ Migration failed:', error);
    } else {
      console.log('✅ Function created successfully!');
    }
  } catch (e) {
    console.error('❌ Exception during migration:', e.message);
  }
  
  console.log('\n=== TESTING THE FUNCTION ===\n');
  
  // Test the function
  const testEmail = 'federico.pasinetti@gmail.com'; // Use actual user email
  
  console.log('Testing consume_tokens_for_analysis function...');
  const { data: testResult, error: testError } = await supabase.rpc('consume_tokens_for_analysis', {
    p_user_email: testEmail,
    p_tokens_to_consume: 0 // Test with 0 to just check balance
  });
  
  if (testError) {
    console.error('❌ Function test failed:', testError);
  } else {
    console.log('✅ Function test result:', testResult);
  }
}

applyMigration().catch(console.error);