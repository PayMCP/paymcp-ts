/**
 * @fileoverview Tests for sessionContext module
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { getCurrentSession, runWithSession, setCurrentSession } from '../../src/core/sessionContext.js';

describe('sessionContext', () => {
  beforeEach(() => {
    // Ensure clean state between tests
    // AsyncLocalStorage automatically clears between test runs
  });

  describe('getCurrentSession', () => {
    it('should return undefined when no session is set', () => {
      const sessionId = getCurrentSession();
      expect(sessionId).toBeUndefined();
    });

    it('should return session ID when running within session context', () => {
      const testSessionId = 'test-session-123';

      runWithSession(testSessionId, () => {
        const sessionId = getCurrentSession();
        expect(sessionId).toBe(testSessionId);
      });
    });

    it('should maintain independent sessions in nested contexts', () => {
      const outerSessionId = 'outer-session';
      const innerSessionId = 'inner-session';

      runWithSession(outerSessionId, () => {
        expect(getCurrentSession()).toBe(outerSessionId);

        runWithSession(innerSessionId, () => {
          expect(getCurrentSession()).toBe(innerSessionId);
        });

        // After inner context ends, outer context is restored
        expect(getCurrentSession()).toBe(outerSessionId);
      });
    });
  });

  describe('runWithSession', () => {
    it('should execute function with session ID set', () => {
      const testSessionId = 'test-session-456';
      let capturedSessionId: string | undefined;

      runWithSession(testSessionId, () => {
        capturedSessionId = getCurrentSession();
      });

      expect(capturedSessionId).toBe(testSessionId);
    });

    it('should execute function without session ID when undefined', () => {
      let capturedSessionId: string | undefined;

      runWithSession(undefined, () => {
        capturedSessionId = getCurrentSession();
      });

      expect(capturedSessionId).toBeUndefined();
    });

    it('should return value from synchronous function', () => {
      const result = runWithSession('session-789', () => {
        return 'sync-result';
      });

      expect(result).toBe('sync-result');
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

    it('should handle function that throws error', () => {
      expect(() => {
        runWithSession('error-session', () => {
          throw new Error('Test error');
        });
      }).toThrow('Test error');
    });

    it('should handle async function that rejects', async () => {
      const promise = runWithSession('reject-session', async () => {
        await new Promise(resolve => setTimeout(resolve, 5));
        throw new Error('Async error');
      });

      await expect(promise).rejects.toThrow('Async error');
    });

    it('should clear session context after function completes', () => {
      runWithSession('temp-session', () => {
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

    it('should handle complex return types', () => {
      const complexObject = {
        id: 1,
        name: 'test',
        nested: { value: 42 }
      };

      const result = runWithSession('complex-session', () => complexObject);

      expect(result).toEqual(complexObject);
      expect(result).toBe(complexObject); // Same reference
    });

    it('should handle undefined callback result', () => {
      const result = runWithSession('undefined-result', () => {
        return undefined;
      });

      expect(result).toBeUndefined();
    });

    it('should handle null callback result', () => {
      const result = runWithSession('null-result', () => {
        return null;
      });

      expect(result).toBeNull();
    });
  });

  describe('setCurrentSession', () => {
    it('should be an alias for runWithSession', () => {
      expect(setCurrentSession).toBe(runWithSession);
    });

    it('should work identically to runWithSession', () => {
      const testSessionId = 'alias-test';
      let capturedSessionId: string | undefined;

      setCurrentSession(testSessionId, () => {
        capturedSessionId = getCurrentSession();
      });

      expect(capturedSessionId).toBe(testSessionId);
    });

    it('should support async functions like runWithSession', async () => {
      const result = await setCurrentSession('alias-async', async () => {
        await new Promise(resolve => setTimeout(resolve, 5));
        return 'alias-async-result';
      });

      expect(result).toBe('alias-async-result');
    });
  });

  describe('edge cases', () => {
    it('should handle empty string as session ID', () => {
      // Empty string is falsy, so should not set session
      let capturedSessionId: string | undefined;

      runWithSession('', () => {
        capturedSessionId = getCurrentSession();
      });

      expect(capturedSessionId).toBeUndefined();
    });

    it('should handle whitespace-only session ID', () => {
      const whitespaceId = '   ';

      runWithSession(whitespaceId, () => {
        expect(getCurrentSession()).toBe(whitespaceId);
      });
    });

    it('should handle very long session ID', () => {
      const longId = 'a'.repeat(1000);

      runWithSession(longId, () => {
        expect(getCurrentSession()).toBe(longId);
      });
    });

    it('should handle special characters in session ID', () => {
      const specialId = 'session-!@#$%^&*()_+-={}[]|\\:";\'<>?,./';

      runWithSession(specialId, () => {
        expect(getCurrentSession()).toBe(specialId);
      });
    });

    it('should handle rapid session switches', () => {
      const results: (string | undefined)[] = [];

      for (let i = 0; i < 100; i++) {
        runWithSession(`session-${i}`, () => {
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
    it('should support tool handler pattern with session', () => {
      const toolHandler = (params: any, extra?: { sessionId?: string }) => {
        let sessionId: string | undefined;

        runWithSession(extra?.sessionId, () => {
          sessionId = getCurrentSession();
          // Tool logic here
        });

        return sessionId;
      };

      // Simulate MCP tool call with session
      const result1 = toolHandler({}, { sessionId: 'user-session-1' });
      expect(result1).toBe('user-session-1');

      // Simulate MCP tool call without session
      const result2 = toolHandler({}, {});
      expect(result2).toBeUndefined();
    });

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

      // Simulate request without session header
      const result2 = await handleRequest(undefined, { data: 'test2' });
      expect(result2.sessionId).toBeUndefined();
      expect(result2.processed).toBe(true);
    });
  });
});
