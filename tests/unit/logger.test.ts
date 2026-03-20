import { describe, it, expect, vi } from 'vitest';
import { logger } from '../../src/lib/logger';

describe('logger', () => {
  it('logs info messages', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logger.info('test message', { key: 'value' });
    expect(spy).toHaveBeenCalled();
    const output = JSON.parse(spy.mock.calls[0][0]);
    expect(output.level).toBe('info');
    expect(output.message).toBe('test message');
    expect(output.key).toBe('value');
    spy.mockRestore();
  });

  it('logs warn messages', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    logger.warn('warning message');
    expect(spy).toHaveBeenCalled();
    const output = JSON.parse(spy.mock.calls[0][0]);
    expect(output.level).toBe('warn');
    spy.mockRestore();
  });

  it('logs error messages', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    logger.error('error message', { detail: 'something broke' });
    expect(spy).toHaveBeenCalled();
    const output = JSON.parse(spy.mock.calls[0][0]);
    expect(output.level).toBe('error');
    expect(output.detail).toBe('something broke');
    spy.mockRestore();
  });

  it('includes timestamp in log output', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logger.info('timestamp test');
    const output = JSON.parse(spy.mock.calls[0][0]);
    expect(output.timestamp).toBeDefined();
    spy.mockRestore();
  });
});
