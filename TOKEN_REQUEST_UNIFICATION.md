# Token Request Logic Unification

## Problem
The desktop app and management portal were using different status values for token requests, causing desktop requests to not appear in the management portal dashboard.

## Solution Implemented

### Status Value Unification
- **Old Desktop Status → New Unified Status**
  - `'pending_payment'` → `'pending'`
  - `'approved_free'` → `'approved'` 
  - `'completed'` → `'approved'` (no longer used)

### Changes Made

#### 1. Desktop Edge Function (`/desktop/supabase/functions/handle-token-request/index.ts`)
- Updated all status assignments to use unified values
- Removed intermediate 'completed' status update
- Now uses 'pending' for payment-required requests
- Now uses 'approved' for auto-approved Early Access requests

#### 2. Management Portal (`/racetagger-app/src/lib/supabase/token-requests.ts`)
- Extended TypeScript interface to include legacy status values for compatibility
- Updated query logic to handle both new and old status values during transition
- Enhanced `getTokenRequests()` to query both status sets when filtering
- Enhanced `getTokenRequestStats()` to count both status sets

#### 3. Database Migrations
- Created migration files for both desktop and web app
- Updates existing records to use unified status values
- Includes verification queries to confirm migration success

### Benefits
1. **Unified Management**: All token requests from desktop now appear in management portal
2. **Backward Compatibility**: System handles both old and new status values during transition
3. **Consistent Workflow**: Same approval/rejection process for all token requests
4. **Email Integration**: All requests trigger proper email notifications to admin

### Flow After Changes
1. User requests tokens in desktop app
2. Edge function creates request with status 'pending' or 'approved'
3. Request appears in management portal dashboard
4. Admin can approve/reject as needed
5. User receives tokens and notifications

### Testing
- Both apps compile successfully
- Build process completes without errors
- Logic handles Early Access (≤500 tokens) and payment-required (>500 tokens) flows