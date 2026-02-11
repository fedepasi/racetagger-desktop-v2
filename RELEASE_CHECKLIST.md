# RaceTagger v1.1.0 - Release Checklist

**Release Date:** February 11, 2026
**Version:** 1.1.0
**Status:** 🟡 Pre-Release

---

## 📋 Pre-Release Checklist

### 1. Code & Build
- [x] CHANGELOG.md updated with all features
- [x] package.json version updated to 1.1.0
- [x] All TypeScript compiled without errors (`npm run compile`)
- [ ] Run full test suite (`npm test`)
- [ ] Run performance benchmarks (`npm run benchmark`)
- [ ] Build macOS ARM64 (`npm run build:mac:arm64`)
- [ ] Build macOS Intel (`npm run build:mac:x64`)
- [ ] Build Windows x64 (`npm run build:win:x64`)
- [ ] Test installers on clean machines (macOS + Windows)

### 2. Database & Backend
- [x] Edge Function deployed (register-user-unified with email normalization)
- [x] Database cleanup completed (187 emails normalized)
- [x] No duplicate emails in production
- [ ] Backup database before release
- [ ] Verify RLS policies working correctly
- [ ] Test token reservation system in production

### 3. Documentation
- [x] RELEASE_NOTES_v1.1.0.md created
- [x] RELEASE_ANNOUNCEMENT.md created
- [x] CLAUDE.md updated (if needed)
- [ ] Update README.md with new version
- [ ] Update website documentation
- [ ] Create quick-start guide for new users

### 4. Testing (Critical!)
- [ ] Fresh install test (macOS ARM64)
- [ ] Fresh install test (macOS Intel)
- [ ] Fresh install test (Windows x64)
- [ ] Upgrade test from v1.0.11 to v1.1.0
- [ ] Test new features:
  - [ ] Drag & Drop folder selection
  - [ ] Token reservation system
  - [ ] Results page stats bar
  - [ ] Post-analysis folder organization
  - [ ] Feedback modal
  - [ ] Email normalization (login with different cases)
- [ ] Test backward compatibility:
  - [ ] Old presets still work
  - [ ] Old projects still open
  - [ ] Token balance correct
- [ ] Stress test:
  - [ ] 1000+ image batch
  - [ ] Cancellation mid-batch
  - [ ] Network interruption handling

### 5. Security
- [x] Email normalization fix deployed
- [ ] Code signing certificates valid
- [ ] macOS notarization completed
- [ ] Windows signature valid
- [ ] No hardcoded secrets in code
- [ ] Environment variables properly configured

---

## 🚀 Release Day Checklist

### Morning (Before Release)

#### GitHub Release
- [ ] Create new release tag `v1.1.0`
- [ ] Upload installers:
  - [ ] RaceTagger-1.1.0-arm64.dmg (macOS Apple Silicon)
  - [ ] RaceTagger-1.1.0-x64.dmg (macOS Intel)
  - [ ] RaceTagger-Setup-1.1.0.exe (Windows x64)
  - [ ] RaceTagger-1.1.0-portable.exe (Windows portable)
- [ ] Copy RELEASE_NOTES_v1.1.0.md as release description
- [ ] Mark as "Latest Release"
- [ ] Publish release

#### Website Updates
- [ ] Update download links
- [ ] Update version number on homepage
- [ ] Add v1.1.0 to release history page
- [ ] Update feature list with new capabilities
- [ ] Test download links work

#### Communication

**Email Campaign**
- [ ] Segment user list (active vs inactive)
- [ ] Personalize subject lines
- [ ] Test email rendering (desktop + mobile)
- [ ] Schedule send (or send immediately)
- [ ] Track open rates

**Social Media**
- [ ] Schedule Twitter/X post
- [ ] Schedule LinkedIn post
- [ ] Schedule Instagram post + Story
- [ ] Schedule Facebook post
- [ ] Prepare engagement responses

**Community**
- [ ] Post in Discord/Slack (if exists)
- [ ] Email to beta testers
- [ ] Update changelog on website

### Afternoon (Post-Release Monitoring)

#### First 4 Hours
- [ ] Monitor GitHub release downloads
- [ ] Check Supabase Edge Function logs for errors
- [ ] Monitor user registrations/logins
- [ ] Watch for support emails
- [ ] Respond to social media comments
- [ ] Track sentiment (positive/negative feedback)

#### End of Day
- [ ] Review analytics:
  - Downloads count (target: 50+ in first week)
  - New registrations (target: 10+ professional photographers)
  - Active users (maintain engagement)
  - Total analyses count (track growth from 60K baseline)
  - Error reports (target: <1% error rate)
- [ ] Document any issues found
- [ ] Prepare hotfix if critical bugs found
- [ ] Thank early adopters publicly (without naming specific users)

---

## 📊 Success Metrics (Track for 7 Days)

### Download Metrics
- [ ] Total downloads (target: 50+ in first week)
- [ ] Platform breakdown (macOS vs Windows)
- [ ] Architecture breakdown (ARM64 vs x64)

### Engagement Metrics
- [ ] New user registrations (target: 10+ professional photographers)
- [ ] Daily active users (maintain high engagement rate)
- [ ] Total analyses growth (from 60K baseline)
- [ ] Token consumption rate
- [ ] Average batch size (track if increasing with new features)

### Quality Metrics
- [ ] Error rate (target: <1%)
- [ ] Support tickets (target: <5 in first week)
- [ ] Crash reports (target: 0)
- [ ] User satisfaction (survey if needed)

### Feature Adoption
- [ ] % users using drag & drop
- [ ] % users using token reservation
- [ ] % users with folder organization enabled
- [ ] Feedback modal submissions

---

## 🐛 Rollback Plan (If Critical Issues Found)

### Critical Issues Definition
- App crashes on launch
- Data loss or corruption
- Token consumption bugs (double charging)
- Authentication failures
- Edge Function failures (>10% error rate)

### Rollback Steps
1. **Immediate:**
   - [ ] Update GitHub release notes with warning
   - [ ] Post alert on social media
   - [ ] Revert Edge Function to previous version
   - [ ] Provide rollback instructions to users

2. **Within 24h:**
   - [ ] Release v1.1.1 hotfix
   - [ ] Email affected users
   - [ ] Compensate users for any token loss

3. **Communication:**
   - [ ] Transparent about issue
   - [ ] ETA for fix
   - [ ] Apology + compensation plan

---

## 🎯 Post-Release Tasks (Week 1)

### Day 1-2
- [ ] Monitor logs and metrics
- [ ] Respond to all support requests
- [ ] Engage with community feedback
- [ ] Document any bugs in GitHub Issues

### Day 3-4
- [ ] Publish tutorial video (drag & drop)
- [ ] Share user testimonials
- [ ] Update documentation based on feedback

### Day 5-7
- [ ] Publish week 1 stats
- [ ] Plan v1.1.1 (if hotfix needed) or v1.2.0 roadmap
- [ ] Survey active users for feedback
- [ ] Thank beta testers publicly

---

## 📱 Communication Templates Ready

- [x] Email announcement
- [x] Social media posts (Twitter, LinkedIn, Instagram, Facebook)
- [x] GitHub release notes
- [x] Website update copy
- [x] FAQ responses
- [ ] Video demo script
- [ ] User testimonials collected

---

## 🔄 Continuous Improvement

### Feedback Collection
- [ ] Add in-app feedback modal (already done!)
- [ ] Monitor GitHub Issues
- [ ] Track support emails
- [ ] Survey power users (1000+ analyses)

### Data Collection
- [ ] Track feature usage via telemetry (with consent)
- [ ] Analyze error logs
- [ ] Performance metrics (processing speed, etc.)

### Next Release Planning
- [ ] Prioritize features for v1.2.0
- [ ] Address common bugs/requests
- [ ] Continue Face Recognition development

---

## ✅ Final Sign-Off

**Before publishing release, confirm:**

- [ ] All builds tested and working
- [ ] All communication materials ready
- [ ] Rollback plan prepared
- [ ] Team available for support (first 24h)
- [ ] Monitoring tools active

**Signed off by:**
- [ ] Lead Developer: _______________
- [ ] QA Lead: _______________
- [ ] Product Manager: _______________

**Release approved:** ☐ YES  ☐ NO

**If NO, blockers:**
1. _______________________________________________
2. _______________________________________________
3. _______________________________________________

---

## 🎉 Post-Release Celebration

When metrics look good after 24h:
- [ ] Celebrate with team 🎉
- [ ] Thank contributors publicly
- [ ] Share success metrics
- [ ] Plan next milestone

---

**Good luck with the release! 🚀**

*Remember: A successful release is one that users love, not just one without bugs.*
