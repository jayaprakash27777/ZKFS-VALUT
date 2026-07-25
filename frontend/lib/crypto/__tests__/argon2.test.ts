/**
 * lib/crypto/__tests__/argon2.test.ts
 *
 * Unit tests for the Argon2id + HKDF key derivation pipeline.
 *
 * Run with: npx jest lib/crypto/__tests__/argon2.test.ts
 *
 * NOTE: These tests require a browser-like environment with WebCrypto.
 * Jest is configured to use jsdom; for Node.js >= 19, crypto is available globally.
 */

import {
  generateArgon2Salt,
  deriveKEKBytes,
  deriveAuthHash,
  deriveRegistrationKeyMaterial,
  deriveLoginKeyMaterial,
  importKEKAsCryptoKey,
  ARGON2_PARAMS,
  ARGON2_SALT_BYTES,
} from '../argon2';

// Use reduced params for speed in tests
const TEST_PARAMS = {
  memorySize:  4096,  // 4 MiB (minimum for testing)
  iterations:  1,
  parallelism: 1,
};

// Monkey-patch argon2 params for test speed
jest.mock('../argon2', () => {
  const actual = jest.requireActual('../argon2') as typeof import('../argon2');
  return {
    ...actual,
    ARGON2_PARAMS: {
      ...actual.ARGON2_PARAMS,
      memorySize:  4096,
      iterations:  1,
      parallelism: 1,
    },
  };
});

describe('Argon2id Key Derivation', () => {

  describe('generateArgon2Salt', () => {
    it('should return exactly 16 bytes', () => {
      const salt = generateArgon2Salt();
      expect(salt).toBeInstanceOf(Uint8Array);
      expect(salt.length).toBe(ARGON2_SALT_BYTES);
    });

    it('should be unique on each call (random)', () => {
      const salt1 = generateArgon2Salt();
      const salt2 = generateArgon2Salt();
      expect(salt1).not.toEqual(salt2);
    });
  });

  describe('deriveKEKBytes', () => {
    it('should return 32 bytes', async () => {
      const salt    = generateArgon2Salt();
      const kekBytes = await deriveKEKBytes('test-password-123', salt);
      expect(kekBytes).toBeInstanceOf(Uint8Array);
      expect(kekBytes.length).toBe(32);
    });

    it('should be deterministic for the same inputs', async () => {
      const salt     = generateArgon2Salt();
      const kekBytes1 = await deriveKEKBytes('password', salt);
      const kekBytes2 = await deriveKEKBytes('password', salt);
      expect(kekBytes1).toEqual(kekBytes2);
    });

    it('should produce different output for different passwords', async () => {
      const salt      = generateArgon2Salt();
      const kekBytes1 = await deriveKEKBytes('password1', salt);
      const kekBytes2 = await deriveKEKBytes('password2', salt);
      expect(kekBytes1).not.toEqual(kekBytes2);
    });

    it('should produce different output for different salts', async () => {
      const salt1 = generateArgon2Salt();
      const salt2 = generateArgon2Salt();
      const kek1  = await deriveKEKBytes('same-password', salt1);
      const kek2  = await deriveKEKBytes('same-password', salt2);
      expect(kek1).not.toEqual(kek2);
    });

    it('should reject empty password', async () => {
      const salt = generateArgon2Salt();
      await expect(deriveKEKBytes('', salt)).rejects.toThrow('Password must not be empty');
    });

    it('should reject invalid salt length', async () => {
      const badSalt = new Uint8Array(8); // Too short
      await expect(deriveKEKBytes('password', badSalt)).rejects.toThrow('salt must be exactly');
    });
  });

  describe('deriveAuthHash', () => {
    it('should return a 64-char hex string (32 bytes)', async () => {
      const salt     = generateArgon2Salt();
      const kekBytes = await deriveKEKBytes('test-password', salt);
      const authHash = await deriveAuthHash(kekBytes);
      expect(typeof authHash).toBe('string');
      expect(authHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('should differ from the KEK hex representation', async () => {
      const salt     = generateArgon2Salt();
      const kekBytes = await deriveKEKBytes('test-password', salt);
      const kekHex   = Array.from(kekBytes).map(b => b.toString(16).padStart(2, '0')).join('');
      const authHash = await deriveAuthHash(kekBytes);
      expect(authHash).not.toBe(kekHex);
    });

    it('should be deterministic for same KEK bytes', async () => {
      const salt     = generateArgon2Salt();
      const kekBytes = await deriveKEKBytes('test-password', salt);
      const hash1    = await deriveAuthHash(kekBytes);
      const hash2    = await deriveAuthHash(kekBytes);
      expect(hash1).toBe(hash2);
    });
  });

  describe('deriveRegistrationKeyMaterial', () => {
    it('should return kek, saltB64, and authHashHex', async () => {
      const material = await deriveRegistrationKeyMaterial('my-secure-password');
      expect(material.kek).toBeDefined();
      expect(material.kek.type).toBe('secret');
      expect(material.saltB64).toMatch(/^[A-Za-z0-9+/=]{24}$/); // Base64 of 16 bytes
      expect(material.authHashHex).toMatch(/^[0-9a-f]{64}$/);
    });

    it('should produce different salts on each call', async () => {
      const m1 = await deriveRegistrationKeyMaterial('password');
      const m2 = await deriveRegistrationKeyMaterial('password');
      expect(m1.saltB64).not.toBe(m2.saltB64);     // New salt each time
      expect(m1.authHashHex).not.toBe(m2.authHashHex); // Different salt → different authHash
    });
  });

  describe('deriveLoginKeyMaterial', () => {
    it('should re-derive the same authHash given the same password and salt', async () => {
      // Register
      const regMaterial = await deriveRegistrationKeyMaterial('my-password');

      // Login — use same salt from registration
      const loginMaterial = await deriveLoginKeyMaterial('my-password', regMaterial.saltB64);

      // authHash must match (this is what server verifies)
      expect(loginMaterial.authHashHex).toBe(regMaterial.authHashHex);
    });

    it('should produce wrong authHash for wrong password', async () => {
      const regMaterial = await deriveRegistrationKeyMaterial('correct-password');
      const loginMaterial = await deriveLoginKeyMaterial('wrong-password', regMaterial.saltB64);
      expect(loginMaterial.authHashHex).not.toBe(regMaterial.authHashHex);
    });
  });

  describe('importKEKAsCryptoKey', () => {
    it('should return a non-extractable AES-GCM CryptoKey', async () => {
      const salt     = generateArgon2Salt();
      const kekBytes = await deriveKEKBytes('password', salt);
      const kek      = await importKEKAsCryptoKey(kekBytes);

      expect(kek).toBeInstanceOf(CryptoKey);
      expect(kek.type).toBe('secret');
      expect(kek.extractable).toBe(false);
      expect(kek.algorithm.name).toBe('AES-GCM');
      expect(kek.usages).toContain('wrapKey');
      expect(kek.usages).toContain('unwrapKey');
    });
  });
});
