# RaceTagger Documentation

Welcome to the comprehensive documentation for RaceTagger Desktop App.

## Quick Links

- [Main README](../README.md) - Project overview and getting started
- [CLAUDE.md](../CLAUDE.md) - AI assistant instructions
- [BUILD_GUIDE.md](../BUILD_GUIDE.md) - Build and deployment guide
- [CHANGELOG.md](../CHANGELOG.md) - Version history

---

## Documentation Structure

### 🛠️ Development

Setup guides and development resources:

- [Native Modules Setup](./development/native-modules.md) - Electron native module rebuilding
- [Windows Setup Guide](./development/windows-setup.md) - Windows-specific configuration
- [Session Persistence](./development/session-persistence.md) - User session management
- [Supabase Setup](./development/supabase-setup.md) - Backend configuration
- [Login & Token Management](./development/login-token.md) - Authentication system

### 🏗️ Architecture

System architecture and technical designs:

- [Token System](./architecture/token-system.md) - Complete token management documentation
- [Smart Matching](./architecture/smart-matching.md) - Intelligent race number matching
- [Execution Tracking](./architecture/execution-tracking.md) - Processing session management

### ✨ Features

Feature documentation and guides:

- [Folder Organization](./features/folder-organization.md) - Automated photo organization
- [Bounding Boxes](./features/bounding-boxes.md) - Detection visualization
- [Sponsor Field](./features/sponsor-field.md) - Sponsor metadata management
- [Features Overview](./features/features-overview.md) - Complete feature list

### 🚀 Deployment

Deployment and distribution guides:

- [Notarization Guide](./deployment/notarization.md) - macOS app notarization
- [Edge Functions](./deployment/edge-functions.md) - Supabase function deployment
- [Installers](./deployment/installers.md) - Distribution package creation

### 📊 Reports

Test results, performance reports, and version histories:

- [Performance Tests](./reports/performance-tests.md) - Benchmarking results
- [Development Report](./reports/development-report.md) - Current status report

### 📁 Archive

Historical documentation (no longer actively maintained):

- [Archive](./archive/) - Obsolete docs preserved for reference

---

## Finding What You Need

### I want to...

**Set up the development environment**
→ Start with [Native Modules Setup](./development/native-modules.md)

**Understand how tokens work**
→ Read [Token System Architecture](./architecture/token-system.md)

**Deploy the application**
→ Follow [BUILD_GUIDE.md](../BUILD_GUIDE.md) and [Notarization Guide](./deployment/notarization.md)

**Learn about new features**
→ Check [Features Overview](./features/features-overview.md)

**Troubleshoot issues**
→ Check the relevant architecture or development docs

**See performance metrics**
→ Review [Performance Tests](./reports/performance-tests.md)

---

## Contributing to Documentation

When adding or updating documentation:

1. **Place files in the appropriate directory**:
   - Development setup → `development/`
   - System architecture → `architecture/`
   - Feature guides → `features/`
   - Deployment guides → `deployment/`
   - Test reports → `reports/`

2. **Use clear, descriptive filenames**:
   - Good: `token-system.md`, `smart-matching.md`
   - Avoid: `doc1.md`, `temp.md`, `notes.md`

3. **Include front matter** (when relevant):
   ```markdown
   # Document Title
   Brief description of what this document covers.

   **Last Updated**: YYYY-MM-DD
   **Status**: Active/Deprecated/In Progress
   ```

4. **Link to related documents**:
   - Use relative links: `[Other Doc](./other-doc.md)`
   - Link to source code: `[main.ts](../src/main.ts)`

5. **Update this README** if adding new sections

---

## Documentation Standards

- **Markdown format** (.md files)
- **Code blocks** with syntax highlighting
- **Screenshots** in `docs/images/` (if needed)
- **Examples** for complex concepts
- **Tables** for structured data
- **Diagrams** using Mermaid or ASCII art

---

**Last Updated**: 2025-11-27
