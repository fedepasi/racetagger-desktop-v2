// Fix the missing tokens by manually adding them and fixing the trigger
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const os = require('os');

const supabaseUrl = 'https://taompbzifylmdzgbbrpv.supabase.co';
const anonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRhb21wYnppZnlsbWR6Z2JicnB2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDU4NDQ3ODYsImV4cCI6MjA2MTQyMDc4Nn0.y1s6em-Fzy012g-RA-Mxcl5LKuxBeRYS9epb35b1yR8';

const supabase = createClient(supabaseUrl, anonKey);

async function fixMissingTokens() {
  console.log('=== FIXING MISSING TOKENS ===\n');
  
  // Load session
  const sessionFilePath = path.join(
    os.homedir(), 
    'Library/Application Support/racetagger-desktop/session.json'
  );
  
  const sessionData = JSON.parse(fs.readFileSync(sessionFilePath, 'utf8'));
  await supabase.auth.setSession(sessionData);
  
  const testUserId = '3b915e07-ac38-4041-9d1a-d8b6b17eb613';
  
  console.log('1. Getting current state...');
  const { data: currentBalance } = await supabase.rpc('get_user_total_tokens', {
    p_user_id: testUserId
  });
  console.log(`Current balance: ${currentBalance} tokens`);
  
  // Get all unprocessed approved requests
  const { data: unprocessedRequests } = await supabase
    .from('token_requests')
    .select('*')
    .eq('user_id', testUserId)
    .eq('status', 'approved')
    .is('completed_date', null);
  
  console.log(`Found ${unprocessedRequests.length} unprocessed approved requests:`);
  
  let totalMissingTokens = 0;
  for (const req of unprocessedRequests) {
    console.log(`  - ${req.tokens_requested} tokens (${req.id.substring(0, 8)}...)`);
    totalMissingTokens += req.tokens_requested;
  }
  
  console.log(`Total missing tokens: ${totalMissingTokens}\n`);
  
  console.log('2. Testing the correct RPC function signature...');
  
  // First test with a small amount to see the correct parameter order
  try {
    // Try the corrected signature: increment_user_tokens(token_amount, user_id)
    const { data, error } = await supabase.rpc('increment_user_tokens', {
      token_amount: 1, // Just 1 token as test
      user_id: testUserId
    });
    
    if (error) {
      console.error('❌ Corrected RPC call failed:', error);
    } else {
      console.log('✅ Corrected RPC call succeeded');
      
      // Check if balance increased
      const { data: testBalance } = await supabase.rpc('get_user_total_tokens', {
        p_user_id: testUserId
      });
      console.log(`Balance after test: ${testBalance} tokens (was ${currentBalance})`);
      
      if (testBalance > currentBalance) {
        console.log('✅ RPC function is working with correct parameters!');
        
        console.log('\n3. Adding all missing tokens...');
        
        // Add the remaining missing tokens (minus the 1 we just tested)
        const remainingTokens = totalMissingTokens - 1;
        
        if (remainingTokens > 0) {
          const { error: bulkError } = await supabase.rpc('increment_user_tokens', {
            token_amount: remainingTokens,
            user_id: testUserId
          });
          
          if (bulkError) {
            console.error('❌ Failed to add bulk tokens:', bulkError);
          } else {
            console.log(`✅ Added ${remainingTokens} tokens to user balance`);
            
            // Verify final balance
            const { data: finalBalance } = await supabase.rpc('get_user_total_tokens', {
              p_user_id: testUserId
            });
            console.log(`Final balance: ${finalBalance} tokens`);
            
            console.log('\n4. Updating completed_date for all processed requests...');
            
            // Update all unprocessed requests to mark them as completed
            const now = new Date().toISOString();
            for (const req of unprocessedRequests) {
              const { error: updateError } = await supabase
                .from('token_requests')
                .update({ completed_date: now })
                .eq('id', req.id);
                
              if (updateError) {
                console.error(`❌ Failed to update ${req.id}:`, updateError);
              } else {
                console.log(`✅ Updated ${req.id} (${req.tokens_requested} tokens)`);
              }
            }
            
            console.log('\n✅ ALL MISSING TOKENS HAVE BEEN FIXED!');
          }
        }
      } else {
        console.log('❌ Test token was not added - RPC function still not working');
      }
    }
  } catch (e) {
    console.error('❌ Exception during RPC test:', e.message);
  }
  
  console.log('\n=== SUMMARY ===');
  console.log(`Original balance: ${currentBalance} tokens`);
  console.log(`Missing tokens: ${totalMissingTokens} tokens`);
  console.log(`Expected final balance: ${currentBalance + totalMissingTokens} tokens`);
}

fixMissingTokens().catch(console.error);