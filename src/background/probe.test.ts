import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tabs = {
  create: vi.fn(async () => ({ id: 9 })),
  update: vi.fn(async () => ({})),
  remove: vi.fn(async () => {}),
};

vi.mock('wxt/browser', () => ({
  browser: { tabs, storage: { session: { get: async () => ({}), set: async () => {} } } },
}));
vi.mock('./log', () => ({ appendRedirectRecord: vi.fn(async () => {}), updateClientLanding: vi.fn(async () => {}) }));

const { probeTabs, startUrlProbe } = await import('./probe');
const { appendRedirectRecord } = await import('./log');

describe('startUrlProbe', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    probeTabs.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('registers the blank tab as a probe before navigating it', async () => {
    tabs.update.mockImplementationOnce(async () => {
      expect(probeTabs.has(9)).toBe(true);
      return {};
    });
    await expect(startUrlProbe('example.com', () => 0)).resolves.toEqual({ success: true });
    expect(tabs.create).toHaveBeenCalledWith({ url: 'about:blank', active: false });
    expect(tabs.update).toHaveBeenCalledWith(9, { url: 'https://example.com/' });
  });

  it('unregisters and closes the tab when navigation fails — no timeout record later', async () => {
    tabs.update.mockRejectedValueOnce(new Error('No tab with id: 9'));
    const finalize = vi.fn(() => 0);
    await expect(startUrlProbe('https://example.com/', finalize)).resolves.toEqual({
      success: false,
      error: 'No tab with id: 9',
    });
    expect(probeTabs.has(9)).toBe(false);
    expect(tabs.remove).toHaveBeenCalledWith(9);

    await vi.advanceTimersByTimeAsync(25_000);
    expect(finalize).not.toHaveBeenCalled();
    expect(appendRedirectRecord).not.toHaveBeenCalled();
  });
});
