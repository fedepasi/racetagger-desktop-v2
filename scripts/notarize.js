require('dotenv').config();

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== 'darwin') {
    return;
  }

  const appName = context.packager.appInfo.productFilename;

  console.log('Apple credentials check:');
  console.log('APPLE_ID:', process.env.APPLE_ID ? 'SET' : 'NOT SET');
  console.log('APPLE_ID_PASS:', process.env.APPLE_ID_PASS ? 'SET' : 'NOT SET');
  console.log('APPLE_TEAM_ID:', process.env.APPLE_TEAM_ID ? 'SET' : 'NOT SET');

  // Skip notarization if credentials are not provided
  if (!process.env.APPLE_ID || !process.env.APPLE_ID_PASS || !process.env.APPLE_TEAM_ID) {
    console.log('Skipping notarization - missing Apple credentials');
    return;
  }

  console.log('Starting notarization process...');

  // Dynamic import for ES module
  const { notarize } = await import('@electron/notarize');

  return await notarize({
    appBundleId: 'com.racetagger.desktop',
    appPath: `${appOutDir}/${appName}.app`,
    appleId: process.env.APPLE_ID,
    appleIdPassword: process.env.APPLE_ID_PASS,
    teamId: process.env.APPLE_TEAM_ID,
  });
};