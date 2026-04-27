const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://taompbzifylmdzgbbrpv.supabase.co';
const anonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRhb21wYnppZnlsbWR6Z2JicnB2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDU4NDQ3ODYsImV4cCI6MjA2MTQyMDc4Nn0.y1s6em-Fzy012g-RA-Mxcl5LKuxBeRYS9epb35b1yR8';

const supabase = createClient(supabaseUrl, anonKey);

async function checkRLSPolicies() {
  console.log('=== CHECKING RLS POLICIES ===\n');
  
  // Try to query system tables to understand RLS policies
  const tables = ['token_requests', 'user_tokens'];
  
  for (const tableName of tables) {
    console.log(`\n--- ${tableName.toUpperCase()} ---`);
    
    // Try a direct query
    try {
      const { data, error, count } = await supabase
        .from(tableName)
        .select('*', { count: 'exact' })
        .limit(1);
      
      console.log(`Direct query result:`);
      console.log(`  - Count: ${count}`);
      console.log(`  - Error: ${error ? error.message : 'none'}`);
      console.log(`  - Data: ${data ? data.length : 'none'} rows`);
      
      if (error) {
        console.log(`  - Error code: ${error.code}`);
        console.log(`  - Error details: ${error.details || 'none'}`);
      }
    } catch (e) {
      console.log(`  Exception: ${e.message}`);
    }
    
    // Try with RPC functions that might bypass RLS
    if (tableName === 'user_tokens') {
      console.log(`\nTrying RPC functions:`);
      try {
        const { data, error } = await supabase.rpc('get_user_total_tokens', {
          p_user_id: '3b915e07-ac38-4041-9d1a-d8b6b17eb613'
        });
        console.log(`  RPC get_user_total_tokens: ${data} (error: ${error ? error.message : 'none'})`);
      } catch (e) {
        console.log(`  RPC Exception: ${e.message}`);
      }
    }
  }
  
  // Try to understand what authentication context we need
  console.log(`\n=== TESTING AUTHENTICATION REQUIREMENTS ===\n`);
  
  // Check if we can query with a fake user context
  try {
    console.log('Testing if RLS requires user authentication...');
    
    // Create a mock authenticated client (this won't work but might give us better error messages)
    const mockAuthClient = createClient(supabaseUrl, anonKey, {
      global: {
        headers: {
          'X-Client-Info': 'racetagger-desktop'
        }
      }
    });
    
    const { data, error } = await mockAuthClient
      .from('token_requests')
      .select('*')
      .eq('user_id', '3b915e07-ac38-4041-9d1a-d8b6b17eb613')
      .limit(1);
    
    console.log(`Mock auth query result: ${data?.length || 0} rows, error: ${error?.message || 'none'}`);
  } catch (e) {
    console.log(`Mock auth failed: ${e.message}`);
  }
  
  // Let's check what the actual database structure looks like
  console.log(`\n=== CHECKING TABLE STRUCTURE ===\n`);
  
  // Try to get schema information
  try {
    // This might not work with RLS, but worth trying
    const { data, error } = await supabase
      .from('information_schema.tables')
      .select('table_name, table_type')
      .eq('table_schema', 'public')
      .in('table_name', ['token_requests', 'user_tokens']);
    
    if (data) {
      console.log('Schema info:', data);
    } else {
      console.log('No schema info available (expected with RLS)');
    }
  } catch (e) {
    console.log('Schema query not available');
  }
  
  console.log(`\n=== CONCLUSION ===`);
  console.log(`Based on the results above:`);
  console.log(`1. If we get 0 rows but no errors, RLS is likely filtering all results`);
  console.log(`2. If we get permission errors, the table requires authentication`);
  console.log(`3. The development server can access data because it has proper auth context`);
  console.log(`4. We need to use the app's authentication to query these tables properly`);
}

checkRLSPolicies().catch(console.error);