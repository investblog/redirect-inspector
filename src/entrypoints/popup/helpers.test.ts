import { describe, expect, it, vi } from 'vitest';

vi.mock('wxt/browser', () => ({ browser: {} }));

const { hopEndpointLabels } = await import('./helpers');

describe('hopEndpointLabels', () => {
  const base = 'https://www.oktagonbet.com/ibet-web-client/?t=home';

  it('shows hosts for a cross-host hop', () => {
    expect(hopEndpointLabels('https://a.example/x', 'https://b.example/y')).toEqual({
      from: 'a.example',
      to: 'b.example',
    });
  });

  it('shows paths for a same-host hop', () => {
    expect(hopEndpointLabels('https://a.example/x', 'https://a.example/x/')).toEqual({ from: '/x', to: '/x/' });
  });

  it('shows the fragment delta when only the hash changes', () => {
    expect(hopEndpointLabels(base, `${base}#/registration`)).toEqual({ from: '#', to: '#/registration' });
    expect(hopEndpointLabels(`${base}#/a`, `${base}#/b`)).toEqual({ from: '#/a', to: '#/b' });
  });

  it('labels a removed fragment with "#" instead of falling back to the host', () => {
    expect(hopEndpointLabels(`${base}#/a`, base)).toEqual({ from: '#/a', to: '#' });
  });
});
