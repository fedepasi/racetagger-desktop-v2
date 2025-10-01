// Clean up the completed_date fields for manually processed requests
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const os = require('os');

const supabaseUrl = 'https://taompbzifylmdzgbbrpv.supabase.co';
const anonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRhb21wYnppZnlsbWR6Z2JicnB2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDU4NDQ3ODYsImV4cCI6MjA2MTQyMDc4Nn0.y1s6em-Fzy012g-RA-Mxcl5LKuxBeRYS9epb35b1yR8';

const supabase = createClient(supabaseUrl, anonKey);

async function cleanCompletedDates() {
  console.log('=== CLEANING UP COMPLETED DATES ===\n');
  
  // Load session
  const sessionFilePath = path.join(
    os.homedir(), 
    'Library/Application Support/racetagger-desktop/session.json'
  );
  
  const sessionData = JSON.parse(fs.readFileSync(sessionFilePath, 'utf8'));
  await supabase.auth.setSession(sessionData);
  
  const testUserId = '3b915e07-ac38-4041-9d1a-d8b6b17eb613';
  
  // Get all approved requests without completed_date
  const { data: uncompletedRequests } = await supabase
    .from('token_requests')
    .select('*')
    .eq('user_id', testUserId)
    .eq('status', 'approved')
    .is('completed_date', null);
  
  console.log(`Found ${uncompletedRequests.length} approved requests without completed_date`);
  
  if (uncompletedRequests.length === 0) {
    console.log('✅ All approved requests already have completed_date set');
    return;
  }
  
  console.log('\nUpdating completed_date for all processed requests...');
  
  const now = new Date().toISOString();
  let updatedCount = 0;
  
  for (const req of uncompletedRequests) {
    console.log(`Updating ${req.id.substring(0, 8)}... (${req.tokens_requested} tokens)`);
    
    const { error } = await supabase
      .from('token_requests')
      .update({ 
        completed_date: now,
        notes: 'Manually processed - tokens added to user balance'
      })
      .eq('id', req.id);
    
    if (error) {
      console.error(`❌ Failed to update ${req.id}:`, error.message);
    } else {
      console.log(`✅ Updated ${req.id}`);
      updatedCount++;
    }
  }
  
  console.log(`\n✅ Updated ${updatedCount}/${uncompletedRequests.length} requests`);
  
  // Final verification
  console.log('\n=== FINAL VERIFICATION ===\n');
  
  const { data: finalCheck } = await supabase
    .from('token_requests')
    .select('*')
    .eq('user_id', testUserId)
    .eq('status', 'approved')
    .is('completed_date', null);
  
  if (finalCheck.length === 0) {
    console.log('🎉 SUCCESS: All approved requests now have completed_date set!');
  } else {
    console.log(`❌ Still ${finalCheck.length} requests without completed_date`);
  }
  
  // Show final summary
  const { data: allApproved } = await supabase
    .from('token_requests')
    .select('*')
    .eq('user_id', testUserId)
    .eq('status', 'approved');
  
  const { data: currentBalance } = await supabase.rpc('get_user_total_tokens', {
    p_user_id: testUserId
  });
  
  let totalApprovedTokens = 0;
  for (const req of allApproved) {
    totalApprovedTokens += req.tokens_requested;
  }
  
  console.log('\nFinal Summary:');
  console.log(`  - Total approved requests: ${allApproved.length}`);
  console.log(`  - Total approved tokens: ${totalApprovedTokens}`);
  console.log(`  - User current balance: ${currentBalance} tokens`);
  console.log(`  - All requests processed: ${finalCheck.length === 0 ? '✅ YES' : '❌ NO'}`);
  
  const { data: pendingRequests } = await supabase
    .from('token_requests')
    .select('tokens_requested')
    .eq('user_id', testUserId)
    .eq('status', 'pending');
  
  const totalPending = pendingRequests.reduce((sum, req) => sum + req.tokens_requested, 0);
  
  console.log(`  - Pending tokens: ${totalPending}`);
  console.log(`  - Potential total if all pending approved: ${currentBalance + totalPending} tokens`);
}

cleanCompletedDates().catch(console.error);