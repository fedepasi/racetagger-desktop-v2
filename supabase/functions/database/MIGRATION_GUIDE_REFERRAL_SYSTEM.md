# Migration Guide: Referral System Fix

## Overview
This document explains the fixes applied to the referral system migration that was failing due to schema mismatches.

## Issues Found in Original Migration

### 1. Missing `user_id` Column in `subscribers` Table
**Problem**: The original migration assumed a `user_id` column existed in the `subscribers` table, but the actual schema only had email-based identification.

**Impact**: 
- RLS policies referencing `subscribers.user_id` would fail
- Functions trying to join subscribers and auth.users via user_id would fail
- Token transfer logic couldn't work properly

### 2. Incorrect Token Table Reference
**Problem**: Function `get_user_total_tokens` referenced `token_count` column in a non-existent table structure.

**Impact**: 
- Token balance calculations would fail
- Users couldn't see their total available tokens

### 3. Missing Bridge Logic
**Problem**: No mechanism to link subscribers to auth.users when access codes are activated.

**Impact**: 
- Subscribers would remain unlinked even after account activation
- Bonus tokens couldn't be transferred to active accounts

## Changes Made in Fixed Migration

### 1. Added `user_id` Column to Subscribers Table
```sql
-- Add user_id column to subscribers table to link with auth.users
ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);
```

**Purpose**: 
- Enable direct linking between subscribers and authenticated users
- Support RLS policies that need user identification
- Allow proper token management

### 2. Corrected RLS Policies
**Original (Broken)**:
```sql
SELECT user_id FROM subscribers WHERE id = referrer_id
```

**Fixed**:
```sql
SELECT s.user_id FROM subscribers s WHERE s.id = referrer_id AND s.user_id IS NOT NULL
```

**Changes**:
- Added explicit NULL checks for user_id
- Added table aliases for clarity
- Handles cases where subscribers aren't yet linked to auth.users

### 3. Updated Token Balance Function
**Original (Broken)**:
```sql
SELECT COALESCE(SUM(token_count), 0) INTO v_balance
FROM user_tokens 
WHERE user_id = p_user_id;
```

**Fixed**:
```sql
SELECT COALESCE((tokens_purchased - tokens_used), 0) INTO v_balance
FROM user_tokens 
WHERE user_id = p_user_id;
```

**Changes**:
- Uses correct column names from actual schema
- Calculates balance as (purchased - used) instead of summing non-existent column

### 4. Added Subscriber Linking Function
**New Function**: `link_subscriber_to_user()`

**Purpose**:
- Links subscribers to auth.users when access codes are activated
- Transfers bonus tokens from subscriber record to user token balance
- Maintains data integrity during the linking process

## Migration Strategy

### Phase 1: Safe Schema Updates
1. **Add new columns** with IF NOT EXISTS to avoid conflicts
2. **Create new tables** with proper constraints
3. **Add indexes** for performance optimization

### Phase 2: Data Migration
1. **Generate referral codes** for existing subscribers
2. **Set default values** for new columns
3. **Maintain existing data integrity**

### Phase 3: Function Deployment
1. **Deploy corrected functions** that handle NULL user_id cases
2. **Update RLS policies** to work with new schema
3. **Test linking mechanism** with access code activation

### Phase 4: Integration
1. **Update access code activation flow** to call linking function
2. **Ensure token transfers** work properly
3. **Verify referral tracking** functions correctly

## Key Safety Features

### 1. Graceful Degradation
- Functions handle cases where `user_id` is NULL
- RLS policies work for both linked and unlinked subscribers
- No data loss if linking fails

### 2. Data Integrity
- Foreign key constraints ensure referential integrity
- Unique constraints prevent duplicate referrals
- Check constraints validate status values

### 3. Rollback Safety
- All changes use IF NOT EXISTS or IF EXISTS patterns
- No destructive operations on existing data
- Transaction-wrapped for atomicity

## Testing Checklist

### Before Running Migration
- [ ] Backup database
- [ ] Verify admin_users table exists
- [ ] Check that image_feedback table has basic structure
- [ ] Confirm token_transactions table exists with correct schema

### After Running Migration
- [ ] Verify all new tables created successfully
- [ ] Check that new columns added to existing tables
- [ ] Test RLS policies with sample users
- [ ] Verify functions can be called without errors
- [ ] Test referral code generation for existing subscribers

### Integration Testing
- [ ] Test access code activation with subscriber linking
- [ ] Verify token transfer from bonus_tokens to user_tokens
- [ ] Test referral signup flow end-to-end
- [ ] Verify feedback reward system works
- [ ] Check admin action logging

## Common Issues and Solutions

### Issue: Foreign Key Constraint Failures
**Cause**: Trying to reference non-existent admin or user records
**Solution**: Ensure admin_users and auth.users have required records before creating references

### Issue: RLS Policy Denying Access
**Cause**: Policies too restrictive or user not properly linked
**Solution**: Use the linking function when activating access codes

### Issue: Token Balance Incorrect
**Cause**: Bonus tokens not transferred during linking
**Solution**: Run linking function for existing activated users

## Next Steps

1. **Run the fixed migration** in a test environment first
2. **Update application code** to use the linking function during access code activation
3. **Monitor token balances** after migration to ensure accuracy
4. **Update frontend** to display referral codes and tracking information
5. **Implement admin interface** for managing approvals and rewards

## File Locations

- **Fixed Migration**: `/supabase/functions/database/2025-01-16_add_referral_feedback_rewards_system_FIXED.sql`
- **Original Migration**: `/supabase/functions/database/2025-01-16_add_referral_feedback_rewards_system.sql`
- **This Guide**: `/supabase/functions/database/MIGRATION_GUIDE_REFERRAL_SYSTEM.md`

## Support

If issues persist after running the fixed migration:
1. Check database logs for constraint violations
2. Verify all prerequisite tables exist with correct schemas
3. Test functions individually before running full integration
4. Consider running verification queries at the end of the migration script