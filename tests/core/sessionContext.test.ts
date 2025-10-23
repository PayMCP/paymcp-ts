/**
 * @fileoverview Tests for session context module
 *
 * These tests verify that AsyncLocalStorage correctly propagates session IDs
 * across async boundaries, which is critical for multi-user session isolation
 * in the DYNAMIC_TOOLS flow.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { getCurrentSession, runWithSession } from '../../src/core/sessionContext.js';

describe('Session Context', () => {
  beforeEach(() => {
    // AsyncLocalStorage automatically clears between test runs
  });

  describe('getCurrentSession', () => {
    it('should return undefined when no session is set', () => {
      const sessionId = getCurrentSession();
      expect(sessionId).toBeUndefined();
    });

    it('should return session ID when running within session context', async () => {
      const testSessionId = 'test-session-123';

      await runWithSession(testSessionId, async () => {
        const sessionId = getCurrentSession();
        expect(sessionId).toBe(testSessionId);
      });
    });

    it('should maintain independent sessions in nested contexts', async () => {
      const outerSessionId = 'outer-session';
      const innerSessionId = 'inner-session';

      await runWithSession(outerSessionId, async () => {
        expect(getCurrentSession()).toBe(outerSessionId);

        await runWithSession(innerSessionId, async () => {
          expect(getCurrentSession()).toBe(innerSessionId);
        });

        // After inner context ends, outer context is restored
        expect(getCurrentSession()).toBe(outerSessionId);
      });
    });
  });

  describe('runWithSession', () => {
    it('should execute function with session ID set', async () => {
      const testSessionId = 'test-session-456';
      let capturedSessionId: string | undefined;

      await runWithSession(testSessionId, async () => {
        capturedSessionId = getCurrentSession();
      });

      expect(capturedSessionId).toBe(testSessionId);
    });

    it('should return promise from asynchronous function', async () => {
      const promise = runWithSession('session-async', async () => {
        // Simulate async operation
        await new Promise(resolve => setTimeout(resolve, 10));
        return 'async-result';
      });

      expect(promise).toBeInstanceOf(Promise);
      const result = await promise;
      expect(result).toBe('async-result');
    });

    it('should maintain session context through async operations', async () => {
      const testSessionId = 'async-session-123';

      await runWithSession(testSessionId, async () => {
        // First async operation
        await new Promise(resolve => setTimeout(resolve, 5));
        expect(getCurrentSession()).toBe(testSessionId);

        // Second async operation
        await new Promise(resolve => setTimeout(resolve, 5));
        expect(getCurrentSession()).toBe(testSessionId);
      });
    });

    it('should handle function that throws error', async () => {
      await expect(async () => {
        await runWithSession('error-session', async () => {
          throw new Error('Test error');
        });
      }).rejects.toThrow('Test error');
    });

    it('should handle async function that rejects', async () => {
      const promise = runWithSession('reject-session', async () => {
        await new Promise(resolve => setTimeout(resolve, 5));
        throw new Error('Async error');
      });

      await expect(promise).rejects.toThrow('Async error');
    });

    it('should clear session context after function completes', async () => {
      await runWithSession('temp-session', async () => {
        expect(getCurrentSession()).toBe('temp-session');
      });

      // Session should be cleared after runWithSession completes
      expect(getCurrentSession()).toBeUndefined();
    });

    it('should handle multiple concurrent sessions independently', async () => {
      const session1Results: (string | undefined)[] = [];
      const session2Results: (string | undefined)[] = [];

      const promise1 = runWithSession('session-1', async () => {
        session1Results.push(getCurrentSession());
        await new Promise(resolve => setTimeout(resolve, 10));
        session1Results.push(getCurrentSession());
        return 'result-1';
      });

      const promise2 = runWithSession('session-2', async () => {
        session2Results.push(getCurrentSession());
        await new Promise(resolve => setTimeout(resolve, 15));
        session2Results.push(getCurrentSession());
        return 'result-2';
      });

      const [result1, result2] = await Promise.all([promise1, promise2]);

      expect(result1).toBe('result-1');
      expect(result2).toBe('result-2');

      // Verify session isolation
      expect(session1Results).toEqual(['session-1', 'session-1']);
      expect(session2Results).toEqual(['session-2', 'session-2']);
    });

    it('should handle complex return types', async () => {
      const complexObject = {
        id: 1,
        name: 'test',
        nested: { value: 42 }
      };

      const result = await runWithSession('complex-session', async () => complexObject);

      expect(result).toEqual(complexObject);
      expect(result).toBe(complexObject); // Same reference
    });

    it('should handle undefined callback result', async () => {
      const result = await runWithSession('undefined-result', async () => {
        return undefined;
      });

      expect(result).toBeUndefined();
    });

    it('should handle null callback result', async () => {
      const result = await runWithSession('null-result', async () => {
        return null;
      });

      expect(result).toBeNull();
    });
  });

  describe('edge cases', () => {
    it('should handle whitespace-only session ID', async () => {
      const whitespaceId = '   ';

      await runWithSession(whitespaceId, async () => {
        expect(getCurrentSession()).toBe(whitespaceId);
      });
    });

    it('should handle very long session ID', async () => {
      const longId = 'a'.repeat(1000);

      await runWithSession(longId, async () => {
        expect(getCurrentSession()).toBe(longId);
      });
    });

    it('should handle special characters in session ID', async () => {
      const specialId = 'session-!@#$%^&*()_+-={}[]|\\:";\'<>?,./';

      await runWithSession(specialId, async () => {
        expect(getCurrentSession()).toBe(specialId);
      });
    });

    it('should handle rapid session switches', async () => {
      const results: (string | undefined)[] = [];

      for (let i = 0; i < 100; i++) {
        await runWithSession(`session-${i}`, async () => {
          results.push(getCurrentSession());
        });
      }

      // Each iteration should have had its own session
      for (let i = 0; i < 100; i++) {
        expect(results[i]).toBe(`session-${i}`);
      }
    });
  });

  describe('integration scenarios', () => {
    it('should support HTTP request pattern with session header', async () => {
      const handleRequest = async (sessionId: string | undefined, body: any) => {
        return await runWithSession(sessionId, async () => {
          // Simulate request processing
          await new Promise(resolve => setTimeout(resolve, 5));

          return {
            sessionId: getCurrentSession(),
            processed: true,
            body
          };
        });
      };

      // Simulate request with session header
      const result1 = await handleRequest('http-session-123', { data: 'test' });
      expect(result1.sessionId).toBe('http-session-123');
      expect(result1.processed).toBe(true);

      // Simulate request without session header (should use undefined)
      const result2 = await handleRequest(undefined, { data: 'test2' });
      expect(result2.sessionId).toBeUndefined();
      expect(result2.processed).toBe(true);
    });
  });
});
