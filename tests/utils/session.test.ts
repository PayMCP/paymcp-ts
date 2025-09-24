import { describe, it, expect, vi } from 'vitest';
import { extractSessionId } from '../../src/utils/session';

describe('extractSessionId', () => {
  it('should return undefined when extra is null', () => {
    expect(extractSessionId(null)).toBeUndefined();
  });

  it('should return undefined when extra is undefined', () => {
    expect(extractSessionId(undefined)).toBeUndefined();
  });

  it('should extract session ID from headers object', () => {
    const extra = {
      headers: {
        'Mcp-Session-Id': 'session123',
      },
    };
    expect(extractSessionId(extra)).toBe('session123');
  });

  it('should extract session ID from headers with different case', () => {
    const extra = {
      headers: {
        'MCP-SESSION-ID': 'session456',
      },
    };
    expect(extractSessionId(extra)).toBe('session456');
  });

  it('should extract session ID from request.headers', () => {
    const extra = {
      request: {
        headers: {
          'mcp-session-id': 'session789',
        },
      },
    };
    expect(extractSessionId(extra)).toBe('session789');
  });

  it('should extract session ID from _meta.headers', () => {
    const extra = {
      _meta: {
        headers: {
          'Mcp-Session-Id': 'metaSession',
        },
      },
    };
    expect(extractSessionId(extra)).toBe('metaSession');
  });

  it('should prioritize direct headers over request.headers', () => {
    const extra = {
      headers: {
        'Mcp-Session-Id': 'directSession',
      },
      request: {
        headers: {
          'Mcp-Session-Id': 'requestSession',
        },
      },
    };
    expect(extractSessionId(extra)).toBe('directSession');
  });

  it('should prioritize request.headers over _meta.headers', () => {
    const extra = {
      request: {
        headers: {
          'Mcp-Session-Id': 'requestSession',
        },
      },
      _meta: {
        headers: {
          'Mcp-Session-Id': 'metaSession',
        },
      },
    };
    expect(extractSessionId(extra)).toBe('requestSession');
  });

  it('should return undefined when headers exist but no session ID', () => {
    const extra = {
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token',
      },
    };
    expect(extractSessionId(extra)).toBeUndefined();
  });

  it('should warn when HTTP context has no session ID', () => {
    const logger = {
      warn: vi.fn(),
    };
    const extra = {
      headers: {
        'Content-Type': 'application/json',
      },
    };

    expect(extractSessionId(extra, logger)).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      'MCP session ID not found in HTTP context. ' +
        'This may cause issues with multi-client scenarios. ' +
        'Ensure your MCP server provides Mcp-Session-Id header.'
    );
  });

  it('should warn when request.headers exist but no session ID', () => {
    const logger = {
      warn: vi.fn(),
    };
    const extra = {
      request: {
        headers: {
          'Content-Type': 'application/json',
        },
      },
    };

    expect(extractSessionId(extra, logger)).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      'MCP session ID not found in HTTP context. ' +
        'This may cause issues with multi-client scenarios. ' +
        'Ensure your MCP server provides Mcp-Session-Id header.'
    );
  });

  it('should warn when _meta.headers exist but no session ID', () => {
    const logger = {
      warn: vi.fn(),
    };
    const extra = {
      _meta: {
        headers: {
          'Content-Type': 'application/json',
        },
      },
    };

    expect(extractSessionId(extra, logger)).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      'MCP session ID not found in HTTP context. ' +
        'This may cause issues with multi-client scenarios. ' +
        'Ensure your MCP server provides Mcp-Session-Id header.'
    );
  });

  it('should not warn when no HTTP context exists', () => {
    const logger = {
      warn: vi.fn(),
    };
    const extra = {
      someOtherProperty: 'value',
    };

    expect(extractSessionId(extra, logger)).toBeUndefined();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('should handle headers that are not objects', () => {
    const extra = {
      headers: 'not-an-object',
    };
    expect(extractSessionId(extra)).toBeUndefined();
  });

  it('should handle request.headers that are not objects', () => {
    const extra = {
      request: {
        headers: null,
      },
    };
    expect(extractSessionId(extra)).toBeUndefined();
  });

  it('should handle _meta.headers that are not objects', () => {
    const extra = {
      _meta: {
        headers: [],
      },
    };
    expect(extractSessionId(extra)).toBeUndefined();
  });

  it('should handle logger without warn method', () => {
    const logger = {
      info: vi.fn(),
    };
    const extra = {
      headers: {},
    };

    expect(() => extractSessionId(extra, logger)).not.toThrow();
    expect(extractSessionId(extra, logger)).toBeUndefined();
  });

  it('should handle mixed case in header keys', () => {
    const extra = {
      headers: {
        'mCp-SeSsIoN-iD': 'mixedCase123',
      },
    };
    expect(extractSessionId(extra)).toBe('mixedCase123');
  });

  it('should handle empty string session ID', () => {
    const extra = {
      headers: {
        'Mcp-Session-Id': '',
      },
    };
    expect(extractSessionId(extra)).toBe('');
  });

  it('should handle non-string header values correctly', () => {
    const extra = {
      headers: {
        'Mcp-Session-Id': 12345,
      },
    };
    expect(extractSessionId(extra)).toBe(12345);
  });
});
