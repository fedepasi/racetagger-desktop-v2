// This script tries to use a service role key if available
// or checks if we need authentication for these tables

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://taompbzifylmdzgbbrpv.supabase.co';
const anonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRhb21wYnppZnlsbWR6Z2JicnB2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDU4NDQ3ODYsImV4cCI6MjA2MTQyMDc4Nn0.y1s6em-Fzy012g-RA-Mxcl5LKuxBeRYS9epb35b1yR8';

const supabase = createClient(supabaseUrl, anonKey);

async function checkTableAccess() {
  console.log('=== CHECKING TABLE ACCESS ===\n');
  
  // Test different tables to see what we can access
  const tables = ['token_requests', 'user_tokens', 'subscribers', 'images'];
  
  for (const tableName of tables) {
    console.log(`Testing access to ${tableName}:`);
    try {
      const { data, error, count } = await supabase
        .from(tableName)
        .select('*', { count: 'exact', head: true });
      
      if (error) {
        console.log(`  ❌ Error: ${error.message}`);
        console.log(`  Code: ${error.code}`);
      } else {
        console.log(`  ✅ Success: ${count} rows accessible`);
      }
    } catch (e) {
      console.log(`  ❌ Exception: ${e.message}`);
    }
  }
  
  // Try to get table info
  console.log('\n=== CHECKING RLS POLICIES ===\n');
  
  // Check if RLS is enabled by trying a specific query
  try {
    const { data, error } = await supabase
      .from('token_requests')
      .select('count')
      .limit(1);
      
    console.log('Direct query result:', { data, error });
  } catch (e) {
    console.log('Direct query failed:', e.message);
  }
  
  // Try authenticated approach - check if we need to simulate authentication
  console.log('\n=== CHECKING IF AUTHENTICATION IS NEEDED ===\n');
  
  // Let's try to understand the RLS policies by examining the error messages
  const testUserId = '3b915e07-ac38-4041-9d1a-d8b6b17eb613';
  
  try {
    const { data, error } = await supabase
      .from('token_requests')
      .select('*')
      .eq('user_id', testUserId);
      
    console.log('User-specific query result:', { 
      recordCount: data?.length || 0, 
      error: error?.message || 'none' 
    });
    
    if (data && data.length > 0) {
      console.log('Found records:', data.slice(0, 2)); // Show first 2
    }
  } catch (e) {
    console.log('User query failed:', e.message);
  }
}

checkTableAccess().catch(console.error);