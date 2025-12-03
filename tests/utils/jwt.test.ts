import { describe, it, expect, vi, beforeEach } from 'vitest';
import { decodeJwtPayloadUnverified } from '../../src/utils/jwt.js';

describe('decodeJwtPayloadUnverified', () => {
  let mockLogger: any;

  beforeEach(() => {
    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    };
  });

  function createJwt(payload: object, expiresIn?: number): string {
    const header = { alg: 'HS256', typ: 'JWT' };
    const finalPayload = expiresIn !== undefined
      ? { ...payload, exp: Math.floor(Date.now() / 1000) + expiresIn }
      : payload;

    const encodeBase64Url = (obj: object) => {
      const json = JSON.stringify(obj);
      const base64 = Buffer.from(json).toString('base64');
      return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    };

    const headerB64 = encodeBase64Url(header);
    const payloadB64 = encodeBase64Url(finalPayload);
    const signature = 'fake_signature';

    return `${headerB64}.${payloadB64}.${signature}`;
  }

  describe('valid tokens', () => {
    it('should decode a valid JWT with sub claim', () => {
      const token = createJwt({ sub: 'user123' }, 3600);
      const result = decodeJwtPayloadUnverified(token, mockLogger);

      expect(result).not.toBeNull();
      expect(result?.sub).toBe('user123');
    });

    it('should decode a valid JWT with email claim', () => {
      const token = createJwt({ sub: 'user123', email: 'test@example.com' }, 3600);
      const result = decodeJwtPayloadUnverified(token, mockLogger);

      expect(result).not.toBeNull();
      expect(result?.sub).toBe('user123');
      expect(result?.email).toBe('test@example.com');
    });

    it('should decode a valid JWT with additional claims', () => {
      const token = createJwt({
        sub: 'user123',
        email: 'test@example.com',
        name: 'Test User',
        roles: ['admin', 'user']
      }, 3600);
      const result = decodeJwtPayloadUnverified(token, mockLogger);

      expect(result).not.toBeNull();
      expect(result?.sub).toBe('user123');
      expect(result?.email).toBe('test@example.com');
      expect(result?.name).toBe('Test User');
      expect(result?.roles).toEqual(['admin', 'user']);
    });

    it('should decode a JWT without exp claim', () => {
      const token = createJwt({ sub: 'user123' });
      const result = decodeJwtPayloadUnverified(token, mockLogger);

      expect(result).not.toBeNull();
      expect(result?.sub).toBe('user123');
      expect(result?.exp).toBeUndefined();
    });
  });

  describe('expired tokens', () => {
    it('should return null for expired JWT', () => {
      const token = createJwt({ sub: 'user123' }, -3600); // expired 1 hour ago
      const result = decodeJwtPayloadUnverified(token, mockLogger);

      expect(result).toBeNull();
      expect(mockLogger.error).toHaveBeenCalledWith('Expired JWT', expect.any(Object));
    });

    it('should return null for JWT that just expired', () => {
      const token = createJwt({ sub: 'user123' }, -1); // expired 1 second ago
      const result = decodeJwtPayloadUnverified(token, mockLogger);

      expect(result).toBeNull();
    });
  });

  describe('invalid tokens', () => {
    it('should return null for token with less than 2 parts', () => {
      const result = decodeJwtPayloadUnverified('invalid_token', mockLogger);

      expect(result).toBeNull();
      expect(mockLogger.error).toHaveBeenCalledWith('Invalid JWT', expect.any(Error));
    });

    it('should return null for token with only header', () => {
      const result = decodeJwtPayloadUnverified('header_only', mockLogger);

      expect(result).toBeNull();
    });

    it('should return null for empty string', () => {
      const result = decodeJwtPayloadUnverified('', mockLogger);

      expect(result).toBeNull();
    });

    it('should return null for malformed base64 payload', () => {
      const result = decodeJwtPayloadUnverified('header.!!!invalid!!!.signature', mockLogger);

      expect(result).toBeNull();
      expect(mockLogger.error).toHaveBeenCalledWith('Invalid JWT', expect.any(Error));
    });

    it('should return null for invalid JSON in payload', () => {
      const invalidPayload = Buffer.from('not valid json').toString('base64');
      const result = decodeJwtPayloadUnverified(`header.${invalidPayload}.signature`, mockLogger);

      expect(result).toBeNull();
    });
  });

  describe('base64url handling', () => {
    it('should handle base64url with + and / characters', () => {
      const payload = { sub: 'user+test/special' };
      const token = createJwt(payload, 3600);
      const result = decodeJwtPayloadUnverified(token, mockLogger);

      expect(result).not.toBeNull();
      expect(result?.sub).toBe('user+test/special');
    });

    it('should handle unicode characters in payload', () => {
      const payload = { sub: 'user123', name: '测试用户' };
      const token = createJwt(payload, 3600);
      const result = decodeJwtPayloadUnverified(token, mockLogger);

      expect(result).not.toBeNull();
      expect(result?.name).toBe('测试用户');
    });
  });
});
