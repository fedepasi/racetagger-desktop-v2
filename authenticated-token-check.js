// This script uses the app's authentication service to properly query token data
// It simulates the same environment as the desktop app

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const os = require('os');

const supabaseUrl = 'https://taompbzifylmdzgbbrpv.supabase.co';
const anonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRhb21wYnppZnlsbWR6Z2JicnB2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDU4NDQ3ODYsImV4cCI6MjA2MTQyMDc4Nn0.y1s6em-Fzy012g-RA-Mxcl5LKuxBeRYS9epb35b1yR8';

const supabase = createClient(supabaseUrl, anonKey);

async function loadSessionAndQueryTokens() {
  console.log('=== AUTHENTICATED TOKEN ANALYSIS ===\n');
  
  // Try to load the saved session file (same as the desktop app)
  const sessionFilePath = path.join(
    os.homedir(), 
    'Library/Application Support/racetagger-desktop/session.json'
  );
  
  let session = null;
  try {
    if (fs.existsSync(sessionFilePath)) {
      const sessionData = JSON.parse(fs.readFileSync(sessionFilePath, 'utf8'));
      session = sessionData;
      console.log(`✅ Loaded session for user: ${sessionData.user?.email}`);
      console.log(`Session expires: ${new Date(sessionData.expires_at).toLocaleString()}`);
    } else {
      console.log('❌ No saved session file found');
      return;
    }
  } catch (error) {
    console.error('❌ Error loading session:', error.message);
    return;
  }
  
  // Set the session in Supabase client
  try {
    const { data, error } = await supabase.auth.setSession(session);
    if (error) {
      console.error('❌ Error setting session:', error.message);
      return;
    }
    console.log('✅ Session set successfully\n');
  } catch (error) {
    console.error('❌ Exception setting session:', error.message);
    return;
  }
  
  const testUserId = '3b915e07-ac38-4041-9d1a-d8b6b17eb613';
  
  console.log('=== QUERYING TOKEN REQUESTS WITH AUTH ===\n');
  
  // Now query with authentication
  try {
    const { data: allRequests, error: requestError } = await supabase
      .from('token_requests')
      .select('*')
      .order('request_date', { ascending: false });

    if (requestError) {
      console.error('❌ Error fetching token requests:', requestError);
      return;
    }

    console.log(`Found ${allRequests.length} total token requests`);
    
    // Group by status
    const statusCounts = {};
    const userRequests = [];
    
    for (const req of allRequests) {
      statusCounts[req.status] = (statusCounts[req.status] || 0) + 1;
      
      if (req.user_id === testUserId) {
        userRequests.push(req);
      }
    }
    
    console.log('Status breakdown:');
    for (const [status, count] of Object.entries(statusCounts)) {
      console.log(`  ${status}: ${count} requests`);
    }
    
    console.log(`\n=== ANALYZING USER ${testUserId} ===\n`);
    console.log(`User requests: ${userRequests.length}`);
    
    let pendingTotal = 0;
    let approvedTotal = 0;
    const approvedRequests = [];
    
    for (const req of userRequests) {
      console.log(`Request ${req.id.substring(0, 8)}...:`);
      console.log(`  - Status: ${req.status}`);
      console.log(`  - Tokens: ${req.tokens_requested}`);
      console.log(`  - Requested: ${new Date(req.request_date).toLocaleDateString()}`);
      console.log(`  - Completed: ${req.completed_date ? new Date(req.completed_date).toLocaleDateString() : 'NOT SET'}`);
      console.log('');
      
      if (req.status === 'pending') {
        pendingTotal += req.tokens_requested;
      } else if (req.status === 'approved') {
        approvedTotal += req.tokens_requested;
        approvedRequests.push(req);
      }
    }
    
    console.log(`Summary for user:`);
    console.log(`  - Pending tokens: ${pendingTotal}`);
    console.log(`  - Approved tokens: ${approvedTotal}`);
    
    // Check user's actual balance
    const { data: userTokens, error: tokenError } = await supabase
      .from('user_tokens')
      .select('*')
      .eq('user_id', testUserId)
      .single();
    
    console.log(`\n=== USER TOKEN BALANCE ===\n`);
    if (tokenError) {
      if (tokenError.code === 'PGRST116') {
        console.log('❌ No record in user_tokens table');
      } else {
        console.error('❌ Error fetching user tokens:', tokenError);
      }
    } else {
      console.log(`Current balance:`);
      console.log(`  - tokens_purchased: ${userTokens.tokens_purchased}`);
      console.log(`  - tokens_used: ${userTokens.tokens_used}`);
      console.log(`  - remaining: ${userTokens.tokens_purchased - userTokens.tokens_used}`);
      
      // Check for discrepancies
      if (approvedTotal > 0 && userTokens.tokens_purchased < approvedTotal) {
        console.log(`\n⚠️  DISCREPANCY FOUND:`);
        console.log(`  - Approved tokens: ${approvedTotal}`);
        console.log(`  - Purchased tokens: ${userTokens.tokens_purchased}`);
        console.log(`  - Missing tokens: ${approvedTotal - userTokens.tokens_purchased}`);
        
        console.log(`\n📝 Approved requests not reflected in balance:`);
        for (const req of approvedRequests) {
          console.log(`  - ${req.tokens_requested} tokens (${req.id}) - completed: ${req.completed_date || 'NOT SET'}`);
        }
      } else if (approvedTotal === 0) {
        console.log(`\n✅ No approved token requests found - this explains why the user's balance might seem low`);
      } else {
        console.log(`\n✅ All approved tokens are reflected in the user's balance`);
      }
    }
    
  } catch (error) {
    console.error('❌ Exception during token analysis:', error);
  }
}

loadSessionAndQueryTokens().catch(console.error);