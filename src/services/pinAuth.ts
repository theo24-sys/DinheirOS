import { BiometricAuth } from '@capacitor-community/biometric-auth';
import { Preferences } from '@capacitor/preferences';

const PIN_STORAGE_KEY = 'dinheiros_pin_hash';
const AUTH_TOKEN_KEY = 'dinheiros_auth_token';
const SESSION_EXPIRY_KEY = 'dinheiros_session_expiry';
const SESSION_DURATION = 30 * 60 * 1000; // 30 minutes

// Simple SHA256 hash for PIN (client-side only, backend validates too)
async function hashPin(pin: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(pin);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export interface AuthStatus {
  isAuthenticated: boolean;
  lastAuth: number | null;
}

export class PinAuthService {
  // Initialize PIN (first time setup)
  static async initializePin(pin: string): Promise<void> {
    if (pin.length < 4 || pin.length > 6) {
      throw new Error('PIN must be 4-6 digits');
    }
    if (!/^\d+$/.test(pin)) {
      throw new Error('PIN must contain only digits');
    }

    const hashedPin = await hashPin(pin);
    await Preferences.set({ key: PIN_STORAGE_KEY, value: hashedPin });
  }

  // Authenticate with PIN
  static async authenticateWithPin(pin: string): Promise<string> {
    const storedHash = await Preferences.get({ key: PIN_STORAGE_KEY });
    
    if (!storedHash.value) {
      throw new Error('PIN not initialized. Please set up your PIN first.');
    }

    const inputHash = await hashPin(pin);
    if (inputHash !== storedHash.value) {
      throw new Error('Invalid PIN');
    }

    return this.createSession();
  }

  // Authenticate with Biometric (fingerprint)
  static async authenticateWithBiometric(): Promise<string> {
    try {
      const result = await BiometricAuth.isAvailable();
      
      if (!result.isAvailable) {
        throw new Error('Biometric authentication not available on this device');
      }

      await BiometricAuth.authenticate({
        reason: 'Authenticate to access FinanceOS',
        negativeButtonText: 'Use PIN instead',
        negativeButtonTitle: 'Use PIN'
      });

      return this.createSession();
    } catch (error: any) {
      if (error.message?.includes('User cancelled')) {
        throw new Error('Biometric authentication cancelled');
      }
      throw error;
    }
  }

  // Create authentication session
  private static createSession(): string {
    const token = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const expiry = Date.now() + SESSION_DURATION;
    
    Preferences.set({ key: AUTH_TOKEN_KEY, value: token });
    Preferences.set({ key: SESSION_EXPIRY_KEY, value: expiry.toString() });
    
    return token;
  }

  // Get current auth status
  static async getAuthStatus(): Promise<AuthStatus> {
    const token = await Preferences.get({ key: AUTH_TOKEN_KEY });
    const expiry = await Preferences.get({ key: SESSION_EXPIRY_KEY });

    if (!token.value || !expiry.value) {
      return { isAuthenticated: false, lastAuth: null };
    }

    const expiryTime = parseInt(expiry.value);
    if (Date.now() > expiryTime) {
      // Session expired
      await this.logout();
      return { isAuthenticated: false, lastAuth: null };
    }

    return { isAuthenticated: true, lastAuth: expiryTime - SESSION_DURATION };
  }

  // Check if PIN is already set
  static async isPinSet(): Promise<boolean> {
    const stored = await Preferences.get({ key: PIN_STORAGE_KEY });
    return !!stored.value;
  }

  // Logout and clear session
  static async logout(): Promise<void> {
    await Preferences.remove({ key: AUTH_TOKEN_KEY });
    await Preferences.remove({ key: SESSION_EXPIRY_KEY });
  }

  // Change PIN (requires current PIN first)
  static async changePin(oldPin: string, newPin: string): Promise<void> {
    // Verify old PIN
    await this.authenticateWithPin(oldPin);
    
    // Set new PIN
    await this.initializePin(newPin);
  }
}
