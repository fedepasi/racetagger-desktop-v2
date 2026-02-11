# RaceTagger Desktop v1.1.0 - Release Notes

**Release Date:** February 11, 2026
**Status:** 🎉 Stable Release
**Download:** [GitHub Releases](https://github.com/fedepasi/racetagger-desktop-v2/releases/tag/v1.1.0)

---

## 🚀 What's New in v1.1.0

RaceTagger v1.1.0 introduces **major performance improvements**, **new workflow features**, and **critical bug fixes** to make your race photography workflow even more efficient!

---

## ✨ Highlights

### 🎯 Drag & Drop Folder Selection
Say goodbye to tedious folder browsing! Simply **drag and drop** your image folders directly into RaceTagger for instant processing.

- Visual hints guide you through the process
- Works with folders containing RAW, JPEG, and mixed formats
- Dramatically speeds up workflow initialization

### 📊 Enhanced Results Page
Get instant insights with the new **Statistics Bar** showing:
- Total images analyzed
- Successfully matched participants
- Unmatched race numbers
- Category tags for easy filtering

Perfect for quick quality checks after batch processing!

### 🔐 Smart Token Management
Never waste tokens again with our new **Batch Token Reservation System**:
- Pre-authorizes tokens before processing starts
- Automatically refunds unused tokens if processing fails
- Dynamic TTL (30 minutes to 12 hours) based on batch size
- Prevents accidental token consumption on errors

**Example:** Process 1000 images → only 800 successful → 200 tokens automatically refunded! 💰

### 📁 Intelligent Folder Organization
Automatic post-analysis organization with:
- Custom folder paths per participant preset
- Prevention of duplicate moves for completed executions
- Organized by race number, team, or category
- Skipped/unknown images sorted to 'Others' folder

### 🔒 Critical Security Fix: Email Normalization
**Fixed a critical bug** that allowed duplicate accounts with the same email in different casing (e.g., `User@Example.com` vs `user@example.com`).

- ✅ All 187 existing user emails normalized
- ✅ Server-side validation prevents future duplicates
- ✅ Backward compatible (no action required from users)
- ✅ Login now works with any email casing

**Impact:** This fix protects all users from duplicate account issues and improves login reliability.

---

## 🎨 User Experience Improvements

### Better Participant Preset Management
- **PDF Drag-and-Drop**: Upload participant lists directly from PDF race results
- **Autocomplete**: Smart suggestions when editing results based on your presets
- **Driver ID Preservation**: IDs maintained across CSV, JSON, and PDF imports/exports
- **Custom Folder Paths**: Organize exports exactly how you want

### Persisted Settings
- Last analysis settings automatically saved between sessions
- No need to reconfigure sport category, preset, or export settings every time
- Faster workflow setup

### Feedback System
- New integrated feedback modal
- Automatic diagnostic data collection (with your permission)
- Token rewards for validated feedback
- Help us improve RaceTagger faster!

---

## 🔧 Technical Improvements

### Performance Optimizations
- **Batch Database Updates**: Prevents timeouts on large batches (1000+ images)
- **Singleton CleanupManager**: Eliminates memory leaks during long sessions
- **Cached Presets**: Faster filtering and loading
- **Optimized RAW Processing**: New calibration strategies for faster preview extraction

### Enhanced Processing
- Improved batch cancellation handling (clean shutdown, no orphaned processes)
- Better model management for ONNX/RF-DETR recognition
- Enhanced error handling and logging for debugging

### Platform Updates
- ✅ **Windows x64**: Fully optimized build
- ✅ **macOS ARM64**: Native Apple Silicon support
- ✅ **macOS Intel**: Universal binary support

---

## 🐛 Bug Fixes

- Fixed scene classification: Skipped images now correctly organized to 'Others' folder
- Removed unnecessary 'Person Shown' field from participant presets
- Removed confidence indicator from PDF import (cleaner data)
- Fixed UUID generation using native `crypto.randomUUID()`
- Improved modal scrolling (dynamic flexbox for participants modal)
- Enhanced metadata vs AI matching distinction in UI

---

## 🌟 Real-World Impact

RaceTagger is trusted by professional photographers worldwide to deliver results faster:

- **60,000+ race photos analyzed** since beta launch
- **Power users processing 10,000+ images** per month
- Used at **motorsport, cycling, and running events** globally
- From **club races to international championships**

Professional photographers report:
- ⚡ **10x faster** than manual tagging
- 🎯 **99% accuracy** with AI recognition
- ⏱️ **Hours to minutes** - complete race results delivered same day

---

## 📦 Installation & Upgrade

### First-Time Users
1. Download the installer for your platform:
   - **macOS**: `RaceTagger-1.1.0-arm64.dmg` (Apple Silicon) or `RaceTagger-1.1.0-x64.dmg` (Intel)
   - **Windows**: `RaceTagger-Setup-1.1.0.exe`
2. Install and launch RaceTagger
3. Create account or login
4. Start analyzing! 🚀

### Existing Users
1. **Automatic Update** (recommended):
   - RaceTagger will prompt you to update on next launch
   - Click "Update Now" and restart

2. **Manual Update**:
   - Download new version from [GitHub Releases](https://github.com/fedepasi/racetagger-desktop-v2/releases/tag/v1.1.0)
   - Install over existing version
   - All your presets, settings, and data are preserved

**⚠️ Important:** Your token balance, presets, and all data are cloud-synced. No data will be lost during the update.

---

## 🔄 Backward Compatibility

✅ **Fully backward compatible** with v1.0.x
✅ No breaking changes
✅ All existing presets, projects, and executions work seamlessly
✅ Edge Function updates are server-side (automatic for all users)

---

## 🙏 Thank You

Special thanks to our **professional photography community** who provided invaluable feedback during development.

Your real-world usage and insights have shaped RaceTagger into the powerful tool it is today. From processing single events to managing thousands of images per month, you've proven that RaceTagger delivers on its promise.

Thank you for trusting us with your workflow! 💙

---

## 🆘 Support

Need help? We're here for you:

- 📧 **Email**: info@racetagger.cloud
- 🌐 **Website**: https://www.racetagger.cloud
- 📚 **Documentation**: Check CLAUDE.md and DATABASE.md in the app folder
- 🐛 **Bug Reports**: [GitHub Issues](https://github.com/fedepasi/racetagger-desktop-v2/issues)

---

## 🔮 Coming Soon

We're already working on exciting features for **v1.2.0**:
- 🎭 **Face Recognition** (currently disabled, coming soon!)
- 🧠 **Enhanced AI Models** with better accuracy
- 📱 **Mobile App Companion** for on-site previews
- 🌐 **Multi-language Support**

Stay tuned! 🚀

---

## 📝 Full Changelog

See [CHANGELOG.md](./CHANGELOG.md) for complete technical details.

---

**Made with ❤️ by the RaceTagger Team**

*Empowering race photographers worldwide to deliver results faster than ever.*
