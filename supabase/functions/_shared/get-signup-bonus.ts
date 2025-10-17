/**
 * Get signup bonus tokens from system_config table
 *
 * This function retrieves the dynamic signup bonus value from the database,
 * allowing administrators to change the bonus amount without redeploying code.
 *
 * @param supabaseClient - Supabase client instance (admin or regular)
 * @returns Number of tokens to grant on signup (default: 500)
 */
export async function getSignupBonusTokens(supabaseClient: any): Promise<number> {
  const DEFAULT_SIGNUP_BONUS = 500;

  try {
    const { data, error } = await supabaseClient
      .from('system_config')
      .select('value')
      .eq('key', 'signup_bonus_tokens')
      .single();

    if (error) {
      console.warn('[getSignupBonusTokens] Database error, using default:', error.message);
      return DEFAULT_SIGNUP_BONUS;
    }

    if (!data?.value) {
      console.warn('[getSignupBonusTokens] No value found, using default');
      return DEFAULT_SIGNUP_BONUS;
    }

    const parsedValue = parseInt(data.value as string);

    if (isNaN(parsedValue) || parsedValue < 0) {
      console.warn('[getSignupBonusTokens] Invalid value, using default:', data.value);
      return DEFAULT_SIGNUP_BONUS;
    }

    console.log(`[getSignupBonusTokens] Using configured value: ${parsedValue}`);
    return parsedValue;

  } catch (error) {
    console.error('[getSignupBonusTokens] Unexpected error, using default:', error);
    return DEFAULT_SIGNUP_BONUS;
  }
}
