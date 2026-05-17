// Local Authentication Service
const AUTH_TOKEN_KEY = 'dinheiros_auth_token';
const SESSION_EXPIRY_KEY = 'dinheiros_session_expiry';
const SESSION_DURATION = 30 * 60 * 1000; // 30 minutes
const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://127.0.0.1:3000';
const DEFAULT_PIN = '42458184'; // Default PIN hint

export interface AuthStatus {
  isAuthenticated: boolean;
  token: string | null;
  expiresAt: number | null;
}

export interface BiometricAvailability {
  available: boolean;
  biometricType: 'fingerprint' | 'face' | 'iris' | null;
}

export class LocalAuthService {
  // Check biometric availability
  static async checkBiometric(): Promise<BiometricAvailability> {
    try {
      // Try to access BiometricAuth if available
      if (typeof window !== 'undefined' && (window as any).BiometricAuth) {
        const result = await (window as any).BiometricAuth.isAvailable();
        if (result.isAvailable) {
          return {
            available: true,
            biometricType: result.biometricType || 'fingerprint'
          };
        }
      }
      return { available: false, biometricType: null };
    } catch {
      return { available: false, biometricType: null };
    }
  }

  // Authenticate with fingerprint
  static async authenticateWithFingerprint(): Promise<string> {
    try {
      if ((window as any).BiometricAuth) {
        await (window as any).BiometricAuth.authenticate({
          reason: 'Authenticate to access your finances',
          negativeButtonText: 'Use PIN instead'
        });

        // If fingerprint succeeds, use default PIN for backend auth
        // (In real production, you'd have a separate biometric token flow)
        return this.authenticateWithPin(DEFAULT_PIN);
      } else {
        throw new Error('Biometric not available on this device');
      }
    } catch (error: any) {
      if (error.message?.includes('cancelled') || error.message?.includes('User cancelled')) {
        throw new Error('Fingerprint authentication cancelled');
      }
      throw error;
    }
  }

  // Authenticate with PIN (backend validates, frontend stores session)
  static async authenticateWithPin(pin: string): Promise<string> {
    try {
      const response = await fetch(`${SERVER_URL}/api/auth/pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Invalid PIN');
      }

      const { token } = await response.json();
      return this.createSession(token);
    } catch (error: any) {
      throw new Error(error.message || 'Authentication failed');
    }
  }

  // Create local session (token stored in memory, expiry in localStorage)
  private static createSession(token: string): string {
    const expiry = Date.now() + SESSION_DURATION;
    localStorage.setItem(AUTH_TOKEN_KEY, token);
    localStorage.setItem(SESSION_EXPIRY_KEY, expiry.toString());
    return token;
  }

  // Get current auth status
  static getAuthStatus(): AuthStatus {
    const token = localStorage.getItem(AUTH_TOKEN_KEY);
    const expiry = localStorage.getItem(SESSION_EXPIRY_KEY);

    if (!token || !expiry) {
      return { isAuthenticated: false, token: null, expiresAt: null };
    }

    const expiryTime = parseInt(expiry);
    if (Date.now() > expiryTime) {
      // Session expired
      this.logout();
      return { isAuthenticated: false, token: null, expiresAt: null };
    }

    return { isAuthenticated: true, token, expiresAt: expiryTime };
  }

  // Get token for API requests
  static getToken(): string | null {
    const auth = this.getAuthStatus();
    return auth.isAuthenticated ? auth.token : null;
  }

  // Setup PIN (first time)
  static async setupPin(pin: string): Promise<void> {
    try {
      const response = await fetch(`${SERVER_URL}/api/auth/setup-pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to setup PIN');
      }
    } catch (error: any) {
      throw new Error(error.message || 'Setup failed');
    }
  }

  // Logout
  static logout(): void {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(SESSION_EXPIRY_KEY);
  }

  // Check if PIN is already set
  static async isPinSet(): Promise<boolean> {
    try {
      const response = await fetch(`${SERVER_URL}/api/auth/status`);
      const data = await response.json();
      return data.isPinSet;
    } catch {
      return false;
    }
  }
}

// API Helper with automatic token injection
export async function apiCall(
  endpoint: string,
  options: RequestInit = {}
): Promise<any> {
  const token = LocalAuthService.getToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${SERVER_URL}${endpoint}`, {
    ...options,
    headers
  });

  if (response.status === 401) {
    LocalAuthService.logout();
    throw new Error('Session expired. Please log in again.');
  }

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || response.statusText);
  }

  return response.json();
}
