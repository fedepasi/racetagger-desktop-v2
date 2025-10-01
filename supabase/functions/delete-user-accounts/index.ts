import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.42.0';
import { corsHeaders } from '../shared/cors.ts';

interface DeleteResult {
  email: string;
  success: boolean;
  message: string;
  deletedFromTables?: string[];
}

// Helper function to safely delete from a table
async function safeDelete(
  supabaseAdmin: any, 
  tableName: string, 
  whereClause: any
): Promise<{ success: boolean; deletedCount: number; error?: string }> {
  try {
    const { data, error, count } = await supabaseAdmin
      .from(tableName)
      .delete({ count: 'exact' })
      .match(whereClause);
    
    if (error) {
      console.error(`Error deleting from ${tableName}:`, error);
      return { success: false, deletedCount: 0, error: error.message };
    }
    
    return { success: true, deletedCount: count || 0 };
  } catch (err) {
    console.error(`Exception deleting from ${tableName}:`, err);
    return { success: false, deletedCount: 0, error: String(err) };
  }
}

serve(async (req: Request) => {
  console.log('[DELETE-USER-ACCOUNTS] Function execution started.');

  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Accept only POST requests
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 405,
    });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      throw new Error('Missing Supabase URL or Service Role Key environment variables.');
    }
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey);

    // 1. Admin authentication (same as process-access-grants)
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing Authorization header' }), { 
        status: 401, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !user) {
      return new Response(JSON.stringify({ 
        error: 'Authentication failed', 
        details: userError?.message 
      }), { 
        status: 401, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    // Check if user is admin
    const { data: adminUser, error: adminCheckError } = await supabaseAdmin
      .from('admin_users')
      .select('user_id')
      .eq('user_id', user.id)
      .maybeSingle();
    
    if (adminCheckError) throw adminCheckError;
    if (!adminUser) {
      return new Response(JSON.stringify({ 
        error: 'Access denied: User is not an administrator.' 
      }), { 
        status: 403, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    const adminUserId = user.id;

    // 2. Extract and validate request body
    let requestBody;
    try {
      requestBody = await req.json();
    } catch (parseError) {
      return new Response(JSON.stringify({ 
        error: 'Invalid request body.', 
        details: parseError.message 
      }), { 
        status: 400, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    const { emailsToDelete } = requestBody;

    if (!Array.isArray(emailsToDelete) || emailsToDelete.length === 0) {
      return new Response(JSON.stringify({ 
        error: 'Missing or invalid "emailsToDelete" array in request body.' 
      }), { 
        status: 400, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    // Validate emails
    const validEmails = emailsToDelete.filter(email => 
      typeof email === 'string' && email.includes('@')
    );
    
    if (validEmails.length === 0) {
      return new Response(JSON.stringify({ 
        error: 'No valid emails provided in "emailsToDelete".' 
      }), { 
        status: 400, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    console.log(`[DELETE-USER-ACCOUNTS] Admin ${adminUserId} requesting deletion of emails:`, validEmails);

    // 3. Process each email for deletion
    const results: DeleteResult[] = [];

    for (const email of validEmails) {
      try {
        const deletedFromTables: string[] = [];
        let hasErrors = false;
        let errorMessages: string[] = [];

        console.log(`[DELETE-USER-ACCOUNTS] Processing deletion for email: ${email}`);

        // Step 1: Find and get user_id from access_codes if user has activated
        const { data: activatedCode } = await supabaseAdmin
          .from('access_codes')
          .select('user_id_activated')
          .eq('subscriber_email', email)
          .eq('is_used', true)
          .maybeSingle();

        const userId = activatedCode?.user_id_activated;

        // Step 2: Delete from token_transactions if user has activated
        if (userId) {
          const tokenTransactionResult = await safeDelete(
            supabaseAdmin, 
            'token_transactions', 
            { user_id: userId }
          );
          if (tokenTransactionResult.success && tokenTransactionResult.deletedCount > 0) {
            deletedFromTables.push(`token_transactions (${tokenTransactionResult.deletedCount} records)`);
          } else if (!tokenTransactionResult.success) {
            errorMessages.push(`Failed to delete from token_transactions: ${tokenTransactionResult.error}`);
            hasErrors = true;
          }
        }

        // Step 3: Delete from user_tokens if user has activated
        if (userId) {
          const userTokensResult = await safeDelete(
            supabaseAdmin, 
            'user_tokens', 
            { user_id: userId }
          );
          if (userTokensResult.success && userTokensResult.deletedCount > 0) {
            deletedFromTables.push(`user_tokens (${userTokensResult.deletedCount} record)`);
          } else if (!userTokensResult.success) {
            errorMessages.push(`Failed to delete from user_tokens: ${userTokensResult.error}`);
            hasErrors = true;
          }
        }

        // Step 4: Delete from access_codes
        const accessCodesResult = await safeDelete(
          supabaseAdmin, 
          'access_codes', 
          { subscriber_email: email }
        );
        if (accessCodesResult.success && accessCodesResult.deletedCount > 0) {
          deletedFromTables.push(`access_codes (${accessCodesResult.deletedCount} records)`);
        } else if (!accessCodesResult.success) {
          errorMessages.push(`Failed to delete from access_codes: ${accessCodesResult.error}`);
          hasErrors = true;
        }

        // Step 5: Delete from subscribers table
        const subscribersResult = await safeDelete(
          supabaseAdmin, 
          'subscribers', 
          { email: email }
        );
        if (subscribersResult.success && subscribersResult.deletedCount > 0) {
          deletedFromTables.push(`subscribers (${subscribersResult.deletedCount} record)`);
        } else if (!subscribersResult.success && !subscribersResult.error?.includes('No rows')) {
          errorMessages.push(`Failed to delete from subscribers: ${subscribersResult.error}`);
          hasErrors = true;
        }

        // Step 6: Delete from waiting_list table
        const waitingListResult = await safeDelete(
          supabaseAdmin, 
          'waiting_list', 
          { email: email }
        );
        if (waitingListResult.success && waitingListResult.deletedCount > 0) {
          deletedFromTables.push(`waiting_list (${waitingListResult.deletedCount} record)`);
        } else if (!waitingListResult.success && !waitingListResult.error?.includes('No rows')) {
          errorMessages.push(`Failed to delete from waiting_list: ${waitingListResult.error}`);
          hasErrors = true;
        }

        // Step 7: If user has activated, delete from analysis_results and images
        if (userId) {
          // Delete analysis results first (references images)
          const analysisResult = await safeDelete(
            supabaseAdmin, 
            'analysis_results', 
            { image_id: supabaseAdmin.from('images').select('id').eq('user_id', userId) }
          );
          
          // More targeted approach: get image IDs first, then delete analysis results
          const { data: userImages } = await supabaseAdmin
            .from('images')
            .select('id')
            .eq('user_id', userId);

          if (userImages && userImages.length > 0) {
            const imageIds = userImages.map(img => img.id);
            
            // Delete analysis results for these images
            const { error: analysisDeleteError, count: analysisCount } = await supabaseAdmin
              .from('analysis_results')
              .delete({ count: 'exact' })
              .in('image_id', imageIds);

            if (!analysisDeleteError && analysisCount && analysisCount > 0) {
              deletedFromTables.push(`analysis_results (${analysisCount} records)`);
            }

            // Delete images
            const imagesResult = await safeDelete(
              supabaseAdmin, 
              'images', 
              { user_id: userId }
            );
            if (imagesResult.success && imagesResult.deletedCount > 0) {
              deletedFromTables.push(`images (${imagesResult.deletedCount} records)`);
            }
          }
        }

        // Determine success status
        const overallSuccess = !hasErrors && deletedFromTables.length > 0;
        
        if (overallSuccess) {
          results.push({
            email,
            success: true,
            message: `Successfully deleted user account and associated data.`,
            deletedFromTables
          });
          console.log(`[DELETE-USER-ACCOUNTS] Successfully deleted account for ${email}`);
        } else {
          const message = deletedFromTables.length > 0 
            ? `Partial deletion completed with some errors: ${errorMessages.join('; ')}`
            : `No data found for this email or deletion failed: ${errorMessages.join('; ')}`;
          
          results.push({
            email,
            success: false,
            message,
            deletedFromTables: deletedFromTables.length > 0 ? deletedFromTables : undefined
          });
          console.log(`[DELETE-USER-ACCOUNTS] Failed/partial deletion for ${email}: ${message}`);
        }

      } catch (processError) {
        console.error(`[DELETE-USER-ACCOUNTS] Error processing deletion for ${email}:`, processError);
        results.push({
          email,
          success: false,
          message: `Unexpected error during deletion: ${processError.message}`
        });
      }
    }

    // 4. Return results
    console.log(`[DELETE-USER-ACCOUNTS] Deletion process completed. Results:`, results);
    
    return new Response(JSON.stringify({ results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error('[DELETE-USER-ACCOUNTS] Error in delete function:', error);
    return new Response(JSON.stringify({ 
      error: error.message || 'An unexpected error occurred.' 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});