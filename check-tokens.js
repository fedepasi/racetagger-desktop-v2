const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://taompbzifylmdzgbbrpv.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRhb21wYnppZnlsbWR6Z2JicnB2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDU4NDQ3ODYsImV4cCI6MjA2MTQyMDc4Nn0.y1s6em-Fzy012g-RA-Mxcl5LKuxBeRYS9epb35b1yR8';

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkTokens() {
  console.log('=== CHECKING TOKEN REQUESTS ===\n');
  
  // Get all approved token requests
  const { data: approvedRequests, error: requestError } = await supabase
    .from('token_requests')
    .select('*')
    .eq('status', 'approved')
    .order('request_date', { ascending: false });

  if (requestError) {
    console.error('Error fetching token requests:', requestError);
    return;
  }

  console.log(`Found ${approvedRequests.length} approved token requests:\n`);
  
  // Group by user
  const userTokens = {};
  for (const req of approvedRequests) {
    if (!userTokens[req.user_id]) {
      userTokens[req.user_id] = {
        email: req.user_email,
        requests: [],
        totalApproved: 0
      };
    }
    userTokens[req.user_id].requests.push({
      id: req.id,
      tokens: req.tokens_requested,
      date: req.request_date,
      completed: req.completed_date
    });
    userTokens[req.user_id].totalApproved += req.tokens_requested;
  }

  // Check each user's balance
  for (const userId of Object.keys(userTokens)) {
    console.log(`\nUser: ${userTokens[userId].email} (${userId})`);
    console.log(`  Approved requests: ${userTokens[userId].requests.length}`);
    console.log(`  Total approved tokens: ${userTokens[userId].totalApproved}`);
    
    // Get user's current token balance
    const { data: userToken, error: tokenError } = await supabase
      .from('user_tokens')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (tokenError && tokenError.code !== 'PGRST116') { // PGRST116 = no rows returned
      console.error(`  Error fetching user tokens:`, tokenError);
    } else if (userToken) {
      console.log(`  Current balance in user_tokens:`);
      console.log(`    - tokens_purchased: ${userToken.tokens_purchased}`);
      console.log(`    - tokens_used: ${userToken.tokens_used}`);
      console.log(`    - remaining: ${userToken.tokens_purchased - userToken.tokens_used}`);
      
      // Check for discrepancy
      if (userToken.tokens_purchased < userTokens[userId].totalApproved) {
        console.log(`  ⚠️  DISCREPANCY: User has ${userTokens[userId].totalApproved} approved tokens but only ${userToken.tokens_purchased} in balance!`);
      }
    } else {
      console.log(`  ⚠️  NO RECORD in user_tokens table!`);
    }
    
    // Show individual requests
    console.log(`  Individual approved requests:`);
    for (const req of userTokens[userId].requests) {
      console.log(`    - ${req.tokens} tokens (requested: ${new Date(req.date).toLocaleDateString()}, completed: ${req.completed ? new Date(req.completed).toLocaleDateString() : 'NOT SET'})`);
    }
  }
  
  console.log('\n=== CHECKING PENDING REQUESTS ===\n');
  
  // Also check pending requests
  const { data: pendingRequests, error: pendingError } = await supabase
    .from('token_requests')
    .select('user_id, user_email, tokens_requested')
    .eq('status', 'pending');
    
  if (!pendingError && pendingRequests.length > 0) {
    const pendingByUser = {};
    for (const req of pendingRequests) {
      if (!pendingByUser[req.user_id]) {
        pendingByUser[req.user_id] = {
          email: req.user_email,
          total: 0,
          count: 0
        };
      }
      pendingByUser[req.user_id].total += req.tokens_requested;
      pendingByUser[req.user_id].count++;
    }
    
    for (const userId of Object.keys(pendingByUser)) {
      console.log(`User ${pendingByUser[userId].email}: ${pendingByUser[userId].count} pending requests totaling ${pendingByUser[userId].total} tokens`);
    }
  }
}

checkTokens().catch(console.error);