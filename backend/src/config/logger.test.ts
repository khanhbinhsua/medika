import { describe, it, expect } from 'vitest';
import { requestSerializer } from './logger.js';

describe('requestSerializer', () => {
  it('cắt bỏ query string khỏi url đã log', () => {
    const req = {
      method: 'GET',
      url: '/api/patients?q=Nguyen+Van+A&page=1',
      headers: { host: 'x' },
      socket: { remoteAddress: '127.0.0.1', remotePort: 1234 },
    };

    const serialized = requestSerializer(req as never);

    expect(serialized.url).toBe('/api/patients');
    expect(serialized.url).not.toContain('Nguyen');
  });

  it('giữ nguyên url không có query string', () => {
    const req = {
      method: 'GET',
      url: '/api/health',
      headers: { host: 'x' },
      socket: { remoteAddress: '127.0.0.1', remotePort: 1234 },
    };

    expect(requestSerializer(req as never).url).toBe('/api/health');
  });
});
