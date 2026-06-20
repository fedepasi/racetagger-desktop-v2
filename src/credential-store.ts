/**
 * Credential Store — "Keep me signed in"
 *
 * Persists the user's login credentials so the desktop login screen can be
 * pre-filled after an explicit logout or a session expiry (across app
 * restarts the Supabase session is already restored from session.json).
 *
 * Security: the payload is encrypted at rest with Electron's `safeStorage`,
 * which uses the OS credential vault (Windows DPAPI, macOS Keychain, Linux
 * libsecret) — the encryption key is bound to the current OS user account, so
 * the file is useless on another machine / under another account. We never
 * write credentials in plaintext: if `safeStorage` is unavailable (e.g. a
 * Linux box with no keyring) we simply don't persist them.
 */

import { app, safeStorage } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

export interface RememberedCredentials {
  email: string;
  password: string;
}

function credentialsFilePath(): string {
  return path.join(app.getPath('userData'), 'remember.enc');
}

/**
 * Save credentials encrypted with the OS vault. Returns false (and persists
 * nothing) if encryption isn't available — callers should treat that as
 * "remember-me unavailable", never as a reason to fall back to plaintext.
 */
export function saveRememberedCredentials(email: string, password: string): boolean {
  try {
    if (!email || !password) return false;
    if (!safeStorage.isEncryptionAvailable()) {
      console.warn('[CredentialStore] safeStorage unavailable — not persisting credentials');
      return false;
    }

    const payload = JSON.stringify({ email, password, savedAt: new Date().toISOString() });
    const encrypted = safeStorage.encryptString(payload); // Buffer

    const filePath = credentialsFilePath();
    const tempPath = filePath + '.tmp';
    fs.writeFileSync(tempPath, encrypted);
    fs.renameSync(tempPath, filePath);
    return true;
  } catch (error) {
    console.error('[CredentialStore] Error saving credentials:', error);
    return false;
  }
}

/**
 * Read + decrypt the remembered credentials. Returns null when absent,
 * unreadable, or decryption fails (e.g. the file was copied from another
 * machine / OS account).
 */
export function getRememberedCredentials(): RememberedCredentials | null {
  try {
    const filePath = credentialsFilePath();
    if (!fs.existsSync(filePath)) return null;
    if (!safeStorage.isEncryptionAvailable()) return null;

    const encrypted = fs.readFileSync(filePath); // Buffer
    const decrypted = safeStorage.decryptString(encrypted);
    const obj = JSON.parse(decrypted);

    if (obj && typeof obj.email === 'string' && typeof obj.password === 'string' && obj.email && obj.password) {
      return { email: obj.email, password: obj.password };
    }
    return null;
  } catch (error) {
    console.error('[CredentialStore] Error reading credentials:', error);
    return null;
  }
}

/** Forget the remembered credentials (user unchecked the box, or a logout that opts out). */
export function clearRememberedCredentials(): void {
  try {
    const filePath = credentialsFilePath();
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (error) {
    console.error('[CredentialStore] Error clearing credentials:', error);
  }
}
