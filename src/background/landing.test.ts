import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LANDING_QUIET_MS, LANDING_WINDOW_MS, maskSensitiveUrl, PROBE_LANDING_WAIT_MS } from './helpers';
import {
  armLandingContext,
  bindLandingToRecord,
  closeLandingContext,
  disarmLandingContexts,
  discardLandingContext,
  handleLandingChange,
  handleLandingCommitted,
  type LandingDraft,
  type LandingNavDetails,
  noteLandingCompleted,
  reduceLanding,
  toClientLanding,
} from './landing';
import { updateClientLanding } from './log';

vi.mock('./log', () => ({ updateClientLanding: vi.fn(() => Promise.resolve()) }));

const BASE = 'https://www.oktagonbet.com/ibet-web-client/?t=home&a_aid=301st';

describe('maskSensitiveUrl', () => {
  it('returns a URL without secrets byte for byte', () => {
    const odd = 'https://Example.com/a%2Fb/?q=%7e&empty=&flag#/route?x=1';
    expect(maskSensitiveUrl(odd)).toEqual({ url: odd, redacted: false });
    expect(maskSensitiveUrl(`${BASE}#/registration`)).toEqual({ url: `${BASE}#/registration`, redacted: false });
  });

  it('masks OAuth implicit-flow fragment values', () => {
    expect(maskSensitiveUrl('https://app.example/cb#access_token=abc.def&state=xyz&token_type=bearer')).toEqual({
      url: 'https://app.example/cb#access_token=***&state=xyz&token_type=bearer',
      redacted: true,
    });
  });

  it('masks params inside a hash route and in the query', () => {
    expect(maskSensitiveUrl('https://app.example/?api-key=K1&page=2#/cb?code=C0DE&lang=en')?.url).toBe(
      'https://app.example/?api-key=***&page=2#/cb?code=***&lang=en',
    );
  });

  it('masks a JWT or opaque token as the whole fragment', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl';
    expect(maskSensitiveUrl(`https://app.example/#${jwt}`)?.url).toBe('https://app.example/#***');
    expect(maskSensitiveUrl('https://app.example/#a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7')?.url).toBe(
      'https://app.example/#***',
    );
    expect(maskSensitiveUrl('https://app.example/#Abcdefghijklmnopqrstuvwx-yz0123456789')?.url).toBe(
      'https://app.example/#***',
    );
  });

  it('keeps harmless names, routes and slugs', () => {
    const urls = [
      'https://app.example/?authority=x&session_length=30&keyboard=1',
      'https://docs.example/guide#chapter-12-introduction-to-the-whole-system',
      'https://app.example/#/registration/step-2',
    ];
    for (const url of urls) expect(maskSensitiveUrl(url)).toEqual({ url, redacted: false });
  });

  it('drops user:pass@', () => {
    expect(maskSensitiveUrl('https://user:pa55@app.example/x')).toEqual({
      url: 'https://app.example/x',
      redacted: true,
    });
  });

  it('fails closed on an unparsable URL', () => {
    expect(maskSensitiveUrl('not a url')).toBeNull();
  });
});

describe('reduceLanding', () => {
  const change = (url: string, via: 'fragment' | 'history', at: number) => ({ url, via, at });

  it('collects changes into the latest state', () => {
    let draft: LandingDraft | null = null;
    draft = reduceLanding(draft, change(`${BASE}#/`, 'fragment', 100), BASE);
    draft = reduceLanding(draft, change(`${BASE}#/registration`, 'fragment', 300), BASE);
    expect(draft).toEqual({ url: `${BASE}#/registration`, via: 'fragment', changes: 2, firstAt: 100, lastAt: 300 });
  });

  it('ignores a change to the address already shown', () => {
    expect(reduceLanding(null, change(BASE, 'history', 100), BASE)).toBeNull();
    const draft = reduceLanding(null, change(`${BASE}#a`, 'fragment', 100), BASE);
    expect(reduceLanding(draft, change(`${BASE}#a`, 'history', 200), BASE)).toBe(draft);
  });

  it('ignores a change to another origin', () => {
    expect(reduceLanding(null, change('http://www.oktagonbet.com/x', 'history', 100), BASE)).toBeNull();
  });

  it('marks a mix of hash and History API changes as history', () => {
    let draft = reduceLanding(null, change(`${BASE}#a`, 'fragment', 100), BASE);
    draft = reduceLanding(draft, change('https://www.oktagonbet.com/next', 'history', 200), BASE);
    draft = reduceLanding(draft, change('https://www.oktagonbet.com/next#b', 'fragment', 300), BASE);
    expect(draft?.via).toBe('history');
  });
});

describe('toClientLanding', () => {
  const draft: LandingDraft = { url: `${BASE}#/registration`, via: 'fragment', changes: 1, firstAt: 900, lastAt: 1200 };

  it('builds the persisted field with the delay from completion', () => {
    expect(toClientLanding(draft, BASE, 1000)).toEqual({
      url: `${BASE}#/registration`,
      via: 'fragment',
      delayMs: 200,
      changes: 1,
      redacted: false,
    });
  });

  it('clamps changes made before completion to 0 ms', () => {
    expect(toClientLanding(draft, BASE, 1500)?.delayMs).toBe(0);
    expect(toClientLanding(draft, BASE, undefined)?.delayMs).toBe(0);
  });

  it('returns null when the page ended back on the final URL', () => {
    expect(toClientLanding({ ...draft, url: BASE }, BASE, 1000)).toBeNull();
    expect(toClientLanding(null, BASE, 1000)).toBeNull();
  });

  it('carries the redaction flag', () => {
    const secret = { ...draft, url: 'https://app.example/cb#id_token=abc' };
    expect(toClientLanding(secret, 'https://app.example/cb', 1000)).toMatchObject({
      url: 'https://app.example/cb#id_token=***',
      redacted: true,
    });
  });
});

describe('landing capture lifecycle', () => {
  const TAB = 5;
  const DOC = 'doc-a';
  const patched = vi.mocked(updateClientLanding);

  const nav = (url: string, extra: Partial<LandingNavDetails> = {}): LandingNavDetails => ({
    tabId: TAB,
    frameId: 0,
    url,
    timeStamp: Date.now(),
    documentId: DOC,
    ...extra,
  });

  /** Arm, commit and complete the final document of chain `chainId` (or a zero-hop probe). */
  function loadFinalDocument(chainId: string | undefined, probe = false): void {
    armLandingContext(TAB, chainId, probe, BASE, Date.now());
    noteLandingCompleted(TAB, chainId, Date.now());
    handleLandingCommitted(nav(BASE));
  }

  beforeEach(() => {
    vi.useFakeTimers();
    patched.mockClear();
  });

  afterEach(() => {
    disarmLandingContexts();
    closeLandingContext(TAB); // also forgets the tab's buffered document
    vi.useRealTimers();
  });

  it('patches the stored record once the page settles after a hash change', () => {
    loadFinalDocument('c1');
    vi.advanceTimersByTime(250);
    expect(bindLandingToRecord(TAB, 'c1', 'c1', BASE)).toEqual({ landing: null, deferred: true });

    vi.advanceTimersByTime(750);
    handleLandingChange(nav(`${BASE}#/`), 'fragment');
    vi.advanceTimersByTime(300);
    handleLandingChange(nav(`${BASE}#/registration`), 'fragment');
    vi.advanceTimersByTime(LANDING_QUIET_MS - 1);
    expect(patched).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(patched).toHaveBeenCalledTimes(1);
    expect(patched).toHaveBeenCalledWith('c1', {
      url: `${BASE}#/registration`,
      via: 'fragment',
      delayMs: 1300,
      changes: 2,
      redacted: false,
    });
  });

  it('writes nothing when the address never changes', () => {
    loadFinalDocument('c1');
    bindLandingToRecord(TAB, 'c1', 'c1', BASE);
    vi.advanceTimersByTime(LANDING_WINDOW_MS + 1);
    expect(patched).not.toHaveBeenCalled();
  });

  it('ignores a change after the window closed', () => {
    loadFinalDocument('c1');
    bindLandingToRecord(TAB, 'c1', 'c1', BASE);
    vi.advanceTimersByTime(LANDING_WINDOW_MS + 1);
    handleLandingChange(nav(`${BASE}#late`), 'fragment');
    vi.advanceTimersByTime(LANDING_QUIET_MS);
    expect(patched).not.toHaveBeenCalled();
  });

  it('caps a page that keeps changing its address', () => {
    loadFinalDocument('c1');
    bindLandingToRecord(TAB, 'c1', 'c1', BASE);
    for (let i = 0; i < 30; i++) {
      vi.advanceTimersByTime(500);
      handleLandingChange(nav(`${BASE}#tick${i}`), 'fragment');
    }
    expect(patched).toHaveBeenCalledTimes(1);
    expect(patched.mock.calls[0][1].changes).toBe(19);
  });

  it('hands a window that settled before the record straight to the record', () => {
    loadFinalDocument('c1');
    handleLandingChange(nav(`${BASE}#/early`), 'fragment');
    vi.advanceTimersByTime(LANDING_QUIET_MS);
    expect(bindLandingToRecord(TAB, 'c1', 'c1', BASE)).toEqual({
      landing: expect.objectContaining({ url: `${BASE}#/early`, delayMs: 0 }),
      deferred: false,
    });
    expect(patched).not.toHaveBeenCalled();
  });

  it('ignores iframes, other documents, inactive documents and an unchanged URL', () => {
    loadFinalDocument('c1');
    bindLandingToRecord(TAB, 'c1', 'c1', BASE);
    handleLandingChange(nav(`${BASE}#frame`, { frameId: 4 }), 'fragment');
    handleLandingChange(nav(`${BASE}#other`, { documentId: 'doc-b' }), 'fragment');
    handleLandingChange(nav(`${BASE}#prerender`, { documentLifecycle: 'prerender' }), 'fragment');
    handleLandingChange(nav(BASE), 'history');
    vi.advanceTimersByTime(LANDING_WINDOW_MS + 1);
    expect(patched).not.toHaveBeenCalled();
  });

  it('does not capture on a page no chain or check led to', () => {
    armLandingContext(TAB, undefined, false, BASE, Date.now());
    handleLandingCommitted(nav(BASE));
    handleLandingChange(nav(`${BASE}#x`), 'fragment');
    vi.advanceTimersByTime(LANDING_QUIET_MS);
    expect(bindLandingToRecord(TAB, undefined, 'r', BASE)).toEqual({ landing: null, deferred: false });
  });

  it('discards the draft when the chain continues with a client redirect', () => {
    loadFinalDocument('c1');
    handleLandingChange(nav(`${BASE}#intermediate`), 'fragment');
    armLandingContext(TAB, 'c1', false, 'https://www.oktagonbet.com/final', Date.now()); // the same chain's next document
    vi.advanceTimersByTime(LANDING_QUIET_MS);
    handleLandingCommitted(nav('https://www.oktagonbet.com/final', { documentId: 'doc-b' }));
    expect(bindLandingToRecord(TAB, 'c1', 'c1', 'https://www.oktagonbet.com/final')).toEqual({
      landing: null,
      deferred: true,
    });
  });

  it('flushes a recorded draft when the tab navigates away before quiet', () => {
    loadFinalDocument('c1');
    bindLandingToRecord(TAB, 'c1', 'c1', BASE);
    handleLandingChange(nav(`${BASE}#/registration`), 'fragment');
    armLandingContext(TAB, undefined, false, 'https://elsewhere.example/', Date.now()); // user follows a link
    expect(patched).toHaveBeenCalledWith('c1', expect.objectContaining({ url: `${BASE}#/registration` }));
  });

  it('treats a second top-level commit as a new document (back/forward cache)', () => {
    loadFinalDocument('c1');
    bindLandingToRecord(TAB, 'c1', 'c1', BASE);
    handleLandingChange(nav(`${BASE}#a`), 'fragment');
    handleLandingCommitted(nav('https://elsewhere.example/', { documentId: 'doc-b' }));
    expect(patched).toHaveBeenCalledTimes(1);
    handleLandingChange(nav('https://elsewhere.example/#b', { documentId: 'doc-b' }), 'fragment');
    vi.advanceTimersByTime(LANDING_WINDOW_MS);
    expect(patched).toHaveBeenCalledTimes(1);
  });

  it('flushes on tab close', () => {
    loadFinalDocument('c1');
    bindLandingToRecord(TAB, 'c1', 'c1', BASE);
    handleLandingChange(nav(`${BASE}#a`), 'fragment');
    closeLandingContext(TAB);
    expect(patched).toHaveBeenCalledTimes(1);
  });

  it('Clear stops open windows without patching, but still closes a deferred probe tab', () => {
    const onDone = vi.fn();
    loadFinalDocument('c1', true);
    expect(bindLandingToRecord(TAB, 'c1', 'c1', BASE, onDone).deferred).toBe(true);
    handleLandingChange(nav(`${BASE}#a`), 'fragment');
    disarmLandingContexts();
    expect(onDone).toHaveBeenCalledTimes(1);
    handleLandingChange(nav(`${BASE}#b`), 'fragment');
    vi.advanceTimersByTime(LANDING_WINDOW_MS);
    expect(patched).not.toHaveBeenCalled();
  });

  it('a probe waits only PROBE_LANDING_WAIT_MS for a first change, then closes its tab', () => {
    const onDone = vi.fn();
    loadFinalDocument('c1', true);
    bindLandingToRecord(TAB, 'c1', 'c1', BASE, onDone);
    vi.advanceTimersByTime(PROBE_LANDING_WAIT_MS - 1);
    expect(onDone).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(patched).not.toHaveBeenCalled();
  });

  it('a probe with a change waits for quiet, patches, then closes', () => {
    const onDone = vi.fn();
    loadFinalDocument('c1', true);
    bindLandingToRecord(TAB, 'c1', 'c1', BASE, onDone);
    vi.advanceTimersByTime(1500);
    handleLandingChange(nav(`${BASE}#/registration`), 'fragment');
    vi.advanceTimersByTime(PROBE_LANDING_WAIT_MS); // past the first-change wait: now quiet + cap rule
    expect(patched).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('zero-hop probe: the settled landing goes into the record built later', () => {
    loadFinalDocument(undefined, true);
    vi.advanceTimersByTime(1000);
    handleLandingChange(nav(`${BASE}#/registration`), 'fragment');
    vi.advanceTimersByTime(4500); // the 5.5s zero-hop settle
    const bound = bindLandingToRecord(TAB, undefined, 'zero', BASE, vi.fn());
    expect(bound.deferred).toBe(false);
    expect(bound.landing?.url).toBe(`${BASE}#/registration`);
  });

  it('adopts a commit and changes delivered before the request (Firefox event order)', () => {
    const requestStart = Date.now() - 50;
    handleLandingCommitted(nav(BASE));
    handleLandingChange(nav(`${BASE}#/registration`), 'fragment');
    armLandingContext(TAB, 'c1', false, BASE, requestStart);
    noteLandingCompleted(TAB, 'c1', Date.now());
    expect(bindLandingToRecord(TAB, 'c1', 'c1', BASE).deferred).toBe(true);
    vi.advanceTimersByTime(LANDING_QUIET_MS);
    expect(patched).toHaveBeenCalledWith('c1', expect.objectContaining({ url: `${BASE}#/registration` }));
  });

  it('does not adopt a document committed before the request started', () => {
    handleLandingCommitted(nav(BASE));
    vi.advanceTimersByTime(100);
    armLandingContext(TAB, 'c1', false, BASE, Date.now()); // e.g. a reload of the same URL
    handleLandingChange(nav(`${BASE}#stale`), 'fragment');
    vi.advanceTimersByTime(LANDING_QUIET_MS);
    expect(bindLandingToRecord(TAB, 'c1', 'c1', BASE)).toEqual({ landing: null, deferred: false });
  });

  it('does not wait for a document that never committed nor completed', () => {
    armLandingContext(TAB, 'c1', true, BASE, Date.now());
    expect(bindLandingToRecord(TAB, 'c1', 'c1', BASE, vi.fn())).toEqual({ landing: null, deferred: false });
  });

  it('still closes the window of a committed page that never completed', () => {
    const onDone = vi.fn();
    armLandingContext(TAB, 'c1', true, BASE, Date.now());
    handleLandingCommitted(nav(BASE));
    expect(bindLandingToRecord(TAB, 'c1', 'c1', BASE, onDone).deferred).toBe(true);
    vi.advanceTimersByTime(PROBE_LANDING_WAIT_MS);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('a committed, never-completed page that already changed settles after quiet, not the cap', () => {
    const onDone = vi.fn();
    armLandingContext(TAB, 'c1', true, BASE, Date.now());
    handleLandingCommitted(nav(BASE));
    handleLandingChange(nav(`${BASE}#/loading`), 'fragment');
    bindLandingToRecord(TAB, 'c1', 'c1', BASE, onDone);
    vi.advanceTimersByTime(LANDING_QUIET_MS);
    expect(patched).toHaveBeenCalledWith('c1', expect.objectContaining({ url: `${BASE}#/loading` }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('drops the window of a chain that will not be recorded', () => {
    loadFinalDocument('c1');
    handleLandingChange(nav(`${BASE}#x`), 'fragment');
    discardLandingContext(TAB, 'c1');
    expect(bindLandingToRecord(TAB, 'c1', 'c1', BASE)).toEqual({ landing: null, deferred: false });
  });
});
