# Building RAW Preview Extractor from Source

This document provides detailed instructions for building RAW Preview Extractor from source code.

## Prerequisites

### All Platforms

- **Node.js**: Version 16.0.0 or higher
- **npm**: Version 7.0.0 or higher
- **Python**: Version 3.8 or higher (for node-gyp)
- **Git**: For cloning the repository

### Windows

- **Visual Studio 2019 or later** with:
  - MSVC v142 compiler toolset
  - Windows 10/11 SDK
  - CMake tools for Visual Studio
- **Windows Build Tools** (alternative to Visual Studio):
  ```bash
  npm install -g windows-build-tools
  ```

### macOS

- **Xcode**: Version 12.0 or later
- **Xcode Command Line Tools**:
  ```bash
  xcode-select --install
  ```

### Linux

- **GCC**: Version 8.0 or higher
- **Make**: GNU Make
- **Build essentials**:
  ```bash
  # Ubuntu/Debian
  sudo apt-get install build-essential

  # CentOS/RHEL/Fedora
  sudo yum groupinstall "Development Tools"
  # or for newer versions:
  sudo dnf groupinstall "Development Tools"
  ```

## Building from Source

### 1. Clone the Repository

```bash
git clone https://github.com/your-username/raw-preview-extractor.git
cd raw-preview-extractor
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Build the Project

#### Full Build (Recommended)
```bash
npm run build
```

This command will:
1. Compile TypeScript sources
2. Build the native C++ module
3. Generate type definitions

#### Individual Build Steps

**Build TypeScript only:**
```bash
npm run build:ts
```

**Build native module only:**
```bash
npm run build:native
```

**Clean build (removes previous build artifacts):**
```bash
npm run clean
npm run build
```

### 4. Run Tests

```bash
npm test
```

### 5. Create Prebuilds (Optional)

To create prebuilt binaries for distribution:

```bash
# Create prebuilds for current platform
npm run prebuild

# Create prebuilds for specific platforms
npm run prebuild:win    # Windows x64
npm run prebuild:mac    # macOS Universal (x64 + ARM64)
npm run prebuild:linux  # Linux x64

# Create all prebuilds (requires appropriate build environments)
npm run prebuild:all
```

## Development Workflow

### Debug Build

For debugging the native module:

```bash
npm run build:debug
```

This creates a debug build with symbols and debugging information.

### Continuous Development

For active development, you can use:

```bash
npm run watch
```

This will watch for TypeScript changes and rebuild automatically.

### Linting and Type Checking

```bash
# Run ESLint
npm run lint

# Run TypeScript type checker
npm run typecheck
```

## Platform-Specific Notes

### Windows Development

1. **Long Path Support**: Enable long path support in Windows 10/11:
   ```cmd
   # Run as Administrator
   New-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" -Name "LongPathsEnabled" -Value 1 -PropertyType DWORD -Force
   ```

2. **Unicode Support**: The build system automatically configures Unicode support for Windows builds.

3. **Visual Studio Configuration**: If you have multiple Visual Studio versions installed:
   ```bash
   npm config set msvs_version 2019
   ```

### macOS Development

1. **Universal Binaries**: The build system automatically creates Universal binaries (Intel + Apple Silicon).

2. **Xcode Version**: Ensure you're using a supported Xcode version:
   ```bash
   xcode-select --print-path
   sudo xcode-select --switch /Applications/Xcode.app/Contents/Developer
   ```

3. **Deployment Target**: The minimum macOS version is set to 10.15 (Catalina).

### Linux Development

1. **Compiler Version**: Ensure you have a modern GCC version:
   ```bash
   gcc --version  # Should be 8.0+
   ```

2. **Missing Libraries**: Install additional development packages if needed:
   ```bash
   # Ubuntu/Debian
   sudo apt-get install libc6-dev

   # CentOS/RHEL
   sudo yum install glibc-devel
   ```

## Troubleshooting

### Common Build Issues

#### node-gyp Build Failures

**Issue**: `node-gyp` fails to build the native module.

**Solution**:
```bash
# Clear npm cache
npm cache clean --force

# Rebuild node-gyp
npm rebuild

# If still failing, try:
npm install -g node-gyp
node-gyp clean
node-gyp configure
node-gyp build
```

#### Python Not Found

**Issue**: `python` command not found during build.

**Solution**:
```bash
# Tell npm which python to use
npm config set python /path/to/python3

# Or set environment variable
export PYTHON=/path/to/python3
```

#### Visual Studio Not Found (Windows)

**Issue**: Can't find Visual Studio installation.

**Solution**:
```bash
# Set Visual Studio version
npm config set msvs_version 2019

# Or use build tools
npm install -g windows-build-tools
```

#### Missing Xcode Command Line Tools (macOS)

**Issue**: `xcode-select: error: tool 'xcodebuild' requires Xcode`.

**Solution**:
```bash
# Install command line tools
xcode-select --install

# Accept license
sudo xcodebuild -license accept
```

### Performance Issues

#### Slow Compilation

1. **Use more CPU cores**:
   ```bash
   # Set parallel jobs for make
   export JOBS=max
   npm run build:native
   ```

2. **Use ccache (Linux/macOS)**:
   ```bash
   # Install ccache
   sudo apt-get install ccache  # Ubuntu
   brew install ccache          # macOS

   # Configure
   export CC="ccache gcc"
   export CXX="ccache g++"
   ```

#### Memory Issues During Build

1. **Reduce parallel jobs**:
   ```bash
   export JOBS=2
   npm run build:native
   ```

2. **Increase swap space** (Linux):
   ```bash
   sudo fallocate -l 4G /swapfile
   sudo chmod 600 /swapfile
   sudo mkswap /swapfile
   sudo swapon /swapfile
   ```

### Testing Issues

#### Missing Test Files

The test suite includes tests that require actual RAW files, which are not included in the repository due to size constraints.

**Solution**: Place sample RAW files in the `test/samples/` directory:
```bash
mkdir -p test/samples
# Copy your RAW files here:
# test/samples/test.cr2
# test/samples/test.nef
# test/samples/test.arw
```

## Contributing to Development

### Code Style

- Follow TypeScript and ESLint configurations
- Use Prettier for code formatting
- Follow conventional commit messages

### Testing

1. **Add tests** for new features
2. **Ensure all tests pass** before submitting
3. **Test on multiple platforms** when possible

### Performance Testing

```bash
# Run performance benchmarks
npm run test:performance

# Run memory leak tests
npm run test:memory
```

### Documentation

Update relevant documentation when making changes:
- API.md for API changes
- README.md for user-facing changes  
- BUILDING.md for build-related changes

## CI/CD Pipeline

The project uses GitHub Actions for continuous integration:

- **Test workflow**: Runs tests on multiple platforms and Node.js versions
- **Prebuild workflow**: Creates prebuilt binaries for releases
- **Release workflow**: Automatically publishes releases with prebuilt binaries

### Local CI Testing

You can test CI workflows locally using [act](https://github.com/nektos/act):

```bash
# Install act
brew install act  # macOS
# or download from GitHub releases

# Run test workflow
act push

# Run specific job
act -j test
```

## Release Process

1. **Update version** in package.json
2. **Update CHANGELOG.md** with release notes  
3. **Create git tag**:
   ```bash
   git tag -a v1.0.0 -m "Release v1.0.0"
   git push origin v1.0.0
   ```
4. **GitHub Actions** will automatically:
   - Build prebuilt binaries
   - Create GitHub release
   - Publish to npm (if configured)

## Getting Help

If you encounter issues not covered in this guide:

1. **Check existing issues** on GitHub
2. **Search discussions** for similar problems  
3. **Create new issue** with:
   - Operating system and version
   - Node.js version
   - Complete error logs
   - Steps to reproduce

## Additional Resources

- [Node.js Native Addons Documentation](https://nodejs.org/api/addons.html)
- [node-gyp Documentation](https://github.com/nodejs/node-gyp)
- [N-API Documentation](https://nodejs.org/api/n-api.html)
- [Prebuildify Documentation](https://github.com/prebuild/prebuildify)