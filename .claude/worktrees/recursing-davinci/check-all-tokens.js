const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://taompbzifylmdzgbbrpv.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRhb21wYnppZnlsbWR6Z2JicnB2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDU4NDQ3ODYsImV4cCI6MjA2MTQyMDc4Nn0.y1s6em-Fzy012g-RA-Mxcl5LKuxBeRYS9epb35b1yR8';

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkAllTokens() {
  console.log('=== CHECKING ALL TOKEN REQUESTS ===\n');
  
  // Get all token requests
  const { data: allRequests, error: requestError } = await supabase
    .from('token_requests')
    .select('*')
    .order('request_date', { ascending: false });

  if (requestError) {
    console.error('Error fetching token requests:', requestError);
    return;
  }

  console.log(`Found ${allRequests.length} total token requests:\n`);
  
  // Group by status
  const byStatus = {};
  for (const req of allRequests) {
    if (!byStatus[req.status]) {
      byStatus[req.status] = [];
    }
    byStatus[req.status].push(req);
  }
  
  console.log('Breakdown by status:');
  for (const status of Object.keys(byStatus)) {
    console.log(`  ${status}: ${byStatus[status].length} requests`);
  }
  
  // Focus on our test user
  const testUserId = '3b915e07-ac38-4041-9d1a-d8b6b17eb613';
  const userRequests = allRequests.filter(req => req.user_id === testUserId);
  
  console.log(`\n=== USER ${testUserId} REQUESTS ===`);
  console.log(`Found ${userRequests.length} requests for this user:\n`);
  
  let totalPending = 0;
  let totalApproved = 0;
  
  for (const req of userRequests) {
    console.log(`Request ${req.id}:`);
    console.log(`  - Tokens: ${req.tokens_requested}`);
    console.log(`  - Status: ${req.status}`);
    console.log(`  - Requested: ${new Date(req.request_date).toLocaleDateString()}`);
    console.log(`  - Completed: ${req.completed_date ? new Date(req.completed_date).toLocaleDateString() : 'NOT SET'}`);
    console.log(`  - Email: ${req.user_email}`);
    console.log('');
    
    if (req.status === 'pending') {
      totalPending += req.tokens_requested;
    } else if (req.status === 'approved') {
      totalApproved += req.tokens_requested;
    }
  }
  
  console.log(`Total pending: ${totalPending} tokens`);
  console.log(`Total approved: ${totalApproved} tokens`);
  
  // Check user's actual token balance
  const { data: userToken, error: tokenError } = await supabase
    .from('user_tokens')
    .select('*')
    .eq('user_id', testUserId)
    .single();

  console.log(`\n=== USER TOKEN BALANCE ===`);
  if (tokenError && tokenError.code !== 'PGRST116') {
    console.error('Error fetching user tokens:', tokenError);
  } else if (userToken) {
    console.log(`Current balance:`);
    console.log(`  - tokens_purchased: ${userToken.tokens_purchased}`);
    console.log(`  - tokens_used: ${userToken.tokens_used}`);
    console.log(`  - remaining: ${userToken.tokens_purchased - userToken.tokens_used}`);
  } else {
    console.log('No record found in user_tokens table');
  }
}

checkAllTokens().catch(console.error);