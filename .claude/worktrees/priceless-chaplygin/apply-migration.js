// Apply the migration to fix the trigger
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const os = require('os');

const supabaseUrl = 'https://taompbzifylmdzgbbrpv.supabase.co';
const anonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRhb21wYnppZnlsbWR6Z2JicnB2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDU4NDQ3ODYsImV4cCI6MjA2MTQyMDc4Nn0.y1s6em-Fzy012g-RA-Mxcl5LKuxBeRYS9epb35b1yR8';

const supabase = createClient(supabaseUrl, anonKey);

async function applyMigration() {
  console.log('=== APPLYING TRIGGER FIX MIGRATION ===\n');
  
  // Load session
  const sessionFilePath = path.join(
    os.homedir(), 
    'Library/Application Support/racetagger-desktop/session.json'
  );
  
  const sessionData = JSON.parse(fs.readFileSync(sessionFilePath, 'utf8'));
  await supabase.auth.setSession(sessionData);
  
  // Read the migration file
  const migrationPath = path.join(__dirname, 'supabase/migrations/20250903_200000_fix_auto_approve_trigger.sql');
  const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
  
  console.log('Migration SQL:');
  console.log(migrationSQL);
  console.log('\n' + '='.repeat(50) + '\n');
  
  try {
    // Execute the migration
    const { data, error } = await supabase.rpc('exec_sql', {
      sql: migrationSQL
    });
    
    if (error) {
      console.error('❌ Migration failed:', error);
    } else {
      console.log('✅ Migration applied successfully!');
      console.log('Data:', data);
    }
  } catch (e) {
    console.error('❌ Exception during migration:', e.message);
    
    // Try alternative approach - execute statements individually
    console.log('\nTrying alternative approach with individual statements...');
    
    const statements = migrationSQL
      .split(';')
      .map(s => s.trim())
      .filter(s => s && !s.startsWith('--') && !s.startsWith('COMMENT'));
    
    for (const statement of statements) {
      if (statement) {
        console.log(`Executing: ${statement.substring(0, 50)}...`);
        try {
          const { error: stmtError } = await supabase.rpc('exec_sql', {
            sql: statement + ';'
          });
          
          if (stmtError) {
            console.error(`❌ Statement failed:`, stmtError);
          } else {
            console.log(`✅ Statement succeeded`);
          }
        } catch (stmtE) {
          console.error(`❌ Statement exception:`, stmtE.message);
        }
      }
    }
  }
  
  console.log('\n=== TESTING THE FIXED TRIGGER ===\n');
  
  // Test the fixed trigger by creating a test request
  const testUserId = '3b915e07-ac38-4041-9d1a-d8b6b17eb613';
  
  console.log('Creating a test token request...');
  const { data: testRequest, error: createError } = await supabase
    .from('token_requests')
    .insert({
      user_id: testUserId,
      user_email: 'test@example.com',
      tokens_requested: 1, // Just 1 token for testing
      message: 'Test request for trigger validation',
      status: 'pending'
    })
    .select()
    .single();
  
  if (createError) {
    console.error('❌ Failed to create test request:', createError);
  } else {
    console.log(`✅ Created test request ${testRequest.id}`);
    
    // Get current balance before approval
    const { data: balanceBefore } = await supabase.rpc('get_user_total_tokens', {
      p_user_id: testUserId
    });
    console.log(`Balance before approval: ${balanceBefore} tokens`);
    
    // Approve the test request (this should trigger the fixed mechanism)
    console.log('Approving test request to trigger the mechanism...');
    const { error: approveError } = await supabase
      .from('token_requests')
      .update({ status: 'approved' })
      .eq('id', testRequest.id);
    
    if (approveError) {
      console.error('❌ Failed to approve test request:', approveError);
    } else {
      console.log('✅ Test request approved');
      
      // Wait for the trigger to process
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Check if the trigger worked
      const { data: balanceAfter } = await supabase.rpc('get_user_total_tokens', {
        p_user_id: testUserId
      });
      console.log(`Balance after approval: ${balanceAfter} tokens`);
      
      // Check if the request was marked as completed
      const { data: updatedRequest } = await supabase
        .from('token_requests')
        .select('*')
        .eq('id', testRequest.id)
        .single();
      
      console.log('Updated test request:');
      console.log(`  - Status: ${updatedRequest.status}`);
      console.log(`  - Completed date: ${updatedRequest.completed_date}`);
      
      if (balanceAfter > balanceBefore && updatedRequest.completed_date) {
        console.log('\n🎉 TRIGGER IS NOW WORKING CORRECTLY!');
      } else {
        console.log('\n❌ Trigger still not working properly');
      }
      
      // Clean up the test request
      console.log('Cleaning up test request...');
      await supabase
        .from('token_requests')
        .delete()
        .eq('id', testRequest.id);
    }
  }
}

applyMigration().catch(console.error);