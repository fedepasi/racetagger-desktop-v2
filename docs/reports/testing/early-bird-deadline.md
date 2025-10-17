# Early Bird Deadline Auto-Hide Testing Guide

## Overview
The pricing modal now automatically detects when the Early Bird period has ended (December 31, 2025) and updates the UI accordingly.

## Automatic Changes After Deadline

### Before Deadline (Until Dec 31, 2025)
```
Hero Title: "Special Launch Offer"
Hero Subtitle: "Up to 42% OFF for the first 81 founders"
Urgency Banner: ⏰ "Limited Until December 31, 2025" (VISIBLE)
```

### After Deadline (From Jan 1, 2026)
```
Hero Title: "Get More Analyses"
Hero Subtitle: "Flexible Token Packs - Choose what fits your needs"
Urgency Banner: (HIDDEN)
```

## How to Test

### Option 1: Wait Until January 1, 2026 😅
Just kidding! Use one of the methods below.

### Option 2: Modify Deadline in Code (Recommended)

1. **Open the file**: `renderer/js/enhanced-processing.js`

2. **Find line 108**:
   ```javascript
   const earlyBirdDeadline = new Date('2025-12-31T23:59:59Z');
   ```

3. **Change to a past date** (for testing):
   ```javascript
   const earlyBirdDeadline = new Date('2024-01-01T23:59:59Z');
   ```

4. **Save and restart app**:
   ```bash
   npm start
   ```

5. **Open pricing modal** → Should show "Get More Analyses" (no Early Bird)

6. **Restore original date** when done testing

### Option 3: Change System Clock (Not Recommended)

1. Change your system date to January 1, 2026
2. Open the app
3. Open pricing modal
4. **IMPORTANT**: Restore your system date after testing!

### Option 4: Use Browser DevTools Console

If running in dev mode with DevTools:

1. Open pricing modal
2. Open DevTools Console (F12 or Cmd+Option+I)
3. Type:
   ```javascript
   // Simulate deadline passed
   const heroTitle = document.querySelector('#token-info-modal .pricing-hero h3');
   const heroSubtitle = document.querySelector('#token-info-modal .hero-subtitle');
   const urgencyBanner = document.querySelector('#token-info-modal .urgency-banner');

   heroTitle.textContent = 'Get More Analyses';
   heroSubtitle.innerHTML = '<strong>Flexible Token Packs</strong> - Choose what fits your needs';
   urgencyBanner.style.display = 'none';
   ```

## Testing Checklist

### ✅ Before Deadline Testing

1. **Set date to before Dec 31, 2025**
   - [ ] Hero shows "Special Launch Offer"
   - [ ] Subtitle shows "Up to 42% OFF"
   - [ ] Urgency banner is VISIBLE
   - [ ] Urgency banner shows clock icon ⏰
   - [ ] Console shows no deadline-related logs

### ✅ After Deadline Testing

2. **Set date to after Dec 31, 2025**
   - [ ] Hero shows "Get More Analyses"
   - [ ] Subtitle shows "Flexible Token Packs"
   - [ ] Urgency banner is HIDDEN (`display: none`)
   - [ ] Console shows: `[Enhanced Processor] Early Bird period ended - urgency banner hidden`
   - [ ] Console shows: `[Enhanced Processor] Early Bird period ended - hero messaging updated to standard pricing`

### ✅ Multiple Opens

3. **Open modal multiple times**
   - [ ] Check runs every time modal opens
   - [ ] No JavaScript errors
   - [ ] Consistent behavior across opens

### ✅ Edge Cases

4. **Test exact deadline moment**
   - Set system time to: `2025-12-31T23:59:58Z`
   - [ ] Early Bird still visible
   - Wait 3 seconds, close/reopen modal
   - [ ] Early Bird now hidden

## Console Logs to Watch For

### When Early Bird is Active
```
[Enhanced Processor] Token info modal opened
```

### When Early Bird Has Ended
```
[Enhanced Processor] Token info modal opened
[Enhanced Processor] Early Bird period ended - urgency banner hidden
[Enhanced Processor] Early Bird period ended - hero messaging updated to standard pricing
```

## Troubleshooting

### Banner Still Shows After Deadline
1. Check system clock is correct
2. Verify timezone handling (deadline is in UTC)
3. Clear browser cache if running in dev
4. Check console for JavaScript errors

### Text Doesn't Update
1. Verify selectors match HTML structure
2. Check if modal HTML was modified
3. Look for CSS `!important` overrides

## Sync with Web App

The deadline date matches the web app configuration:
- **Web App**: `src/config/pricing.ts` → `EARLY_BIRD_CONFIG.deadline = '2025-12-31T23:59:59Z'`
- **Desktop App**: `renderer/js/enhanced-processing.js` → line 108

**IMPORTANT**: If you change the deadline in the web app, also update the desktop app!

## Production Behavior

In production:
- ✅ No rebuild needed when deadline passes
- ✅ Automatic transition on January 1, 2026
- ✅ All users see updated messaging automatically
- ✅ No server calls required (pure client-side check)

## Rollback

If issues arise after deadline:
```bash
git revert 28a5056
npm run compile
npm start
```

---

**Commit**: `28a5056` - feat: Add automatic Early Bird deadline check to pricing modal
**Deadline**: December 31, 2025 23:59:59 UTC
**Testing Date**: Before production deploy
