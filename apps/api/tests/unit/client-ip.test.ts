import { describe, expect, it } from 'vitest';
import { clientIp } from '../../src/lib/client-ip';

const request = (ip: string, headers: Record<string, string | string[] | undefined> = {}) => ({
  ip,
  headers,
});

describe('clientIp (FR-004, límite por origen)', () => {
  it('usa X-Real-IP (lo pone el borde de Railway o el proxy de web)', () => {
    expect(clientIp(request('10.9.9.9', { 'x-real-ip': '203.0.113.7' }))).toBe('203.0.113.7');
  });

  it('acepta IPv6', () => {
    expect(clientIp(request('10.9.9.9', { 'x-real-ip': '2001:db8::1' }))).toBe('2001:db8::1');
  });

  it('sin X-Real-IP usa la IP de la conexión', () => {
    expect(clientIp(request('198.51.100.4'))).toBe('198.51.100.4');
  });

  it.each([
    ['vacía', ''],
    ['con varias IPs', '203.0.113.7, 10.0.0.1'],
    ['que no es una IP', 'no-es-una-ip'],
  ])('ignora una X-Real-IP %s', (_caso, value) => {
    expect(clientIp(request('198.51.100.4', { 'x-real-ip': value }))).toBe('198.51.100.4');
  });

  it('ignora una X-Real-IP repetida', () => {
    expect(clientIp(request('198.51.100.4', { 'x-real-ip': ['1.1.1.1', '2.2.2.2'] }))).toBe(
      '198.51.100.4',
    );
  });
});
