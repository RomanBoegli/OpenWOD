import { describe, expect, it } from 'vitest';
import { describeDevice, deviceLabel, isWebKit } from '../../apps/web/src/data/device';

const UA = {
  ipadSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15',
  ipadHomeScreen: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)',
  ipadMobileSite: 'Mozilla/5.0 (iPad; CPU OS 17_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.7 Mobile/15E148 Safari/604.1',
  ipadChrome: 'Mozilla/5.0 (iPad; CPU OS 17_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.7390.41 Mobile/15E148 Safari/604.1',
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
  iphoneHomeScreen: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  iphoneFirefox: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/143.0 Mobile/15E148 Safari/605.1.15',
  iphoneEdge: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 EdgiOS/141.0.3537.57 Mobile/15E148 Safari/605.1.15',
  macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15',
  macChrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  macFirefox: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:143.0) Gecko/20100101 Firefox/143.0',
  macEdge: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
  androidPhone: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
  androidTablet: 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  samsungPhone: 'Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36',
  windowsEdge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
  windowsOpera: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36 OPR/123.0.0.0',
  linuxFirefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0',
  chromebook: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
};

describe('device label (ENG-15)', () => {
  it('tells an iPad from the Mac it claims to be by its touch screen', () => {
    expect(describeDevice({ userAgent: UA.ipadSafari, maxTouchPoints: 5 })).toBe('iPad · Safari');
    expect(describeDevice({ userAgent: UA.macSafari, maxTouchPoints: 0 })).toBe('Mac · Safari');
    expect(describeDevice({ userAgent: UA.macSafari })).toBe('Mac · Safari');
    // A single touch point is a desktop with a touch-capable pointer, not a tablet.
    expect(describeDevice({ userAgent: UA.macChrome, maxTouchPoints: 1 })).toBe('Mac · Chrome');
    expect(describeDevice({ userAgent: UA.ipadMobileSite, maxTouchPoints: 5 })).toBe('iPad · Safari');
    expect(describeDevice({ userAgent: UA.ipadChrome, maxTouchPoints: 5 })).toBe('iPad · Chrome');
  });

  it('says home screen for the installed app on a phone or tablet, and app on a computer', () => {
    expect(describeDevice({ userAgent: UA.ipadHomeScreen, maxTouchPoints: 5, standalone: true })).toBe('iPad · home screen');
    expect(describeDevice({ userAgent: UA.iphoneHomeScreen, maxTouchPoints: 5, standalone: true })).toBe('iPhone · home screen');
    expect(describeDevice({ userAgent: UA.androidPhone, maxTouchPoints: 5, standalone: true })).toBe('Android phone · home screen');
    expect(describeDevice({ userAgent: UA.macChrome, standalone: true })).toBe('Mac · app');
    expect(describeDevice({ userAgent: UA.windowsEdge, standalone: true })).toBe('Windows PC · app');
  });

  it('names the browser, reading the specific token before the ones every browser carries', () => {
    expect(describeDevice({ userAgent: UA.iphoneSafari, maxTouchPoints: 5 })).toBe('iPhone · Safari');
    expect(describeDevice({ userAgent: UA.iphoneFirefox, maxTouchPoints: 5 })).toBe('iPhone · Firefox');
    expect(describeDevice({ userAgent: UA.iphoneEdge, maxTouchPoints: 5 })).toBe('iPhone · Edge');
    // An iOS web view without a browser token is still WebKit.
    expect(describeDevice({ userAgent: UA.iphoneHomeScreen, maxTouchPoints: 5 })).toBe('iPhone · Safari');
    expect(describeDevice({ userAgent: UA.macChrome })).toBe('Mac · Chrome');
    expect(describeDevice({ userAgent: UA.macFirefox })).toBe('Mac · Firefox');
    expect(describeDevice({ userAgent: UA.macEdge })).toBe('Mac · Edge');
    expect(describeDevice({ userAgent: UA.androidPhone, maxTouchPoints: 5 })).toBe('Android phone · Chrome');
    expect(describeDevice({ userAgent: UA.androidTablet, maxTouchPoints: 5 })).toBe('Android tablet · Chrome');
    expect(describeDevice({ userAgent: UA.samsungPhone, maxTouchPoints: 5 })).toBe('Android phone · Samsung Internet');
    expect(describeDevice({ userAgent: UA.windowsEdge })).toBe('Windows PC · Edge');
    expect(describeDevice({ userAgent: UA.windowsOpera })).toBe('Windows PC · Opera');
    expect(describeDevice({ userAgent: UA.linuxFirefox })).toBe('Linux PC · Firefox');
    expect(describeDevice({ userAgent: UA.chromebook })).toBe('Chromebook · Chrome');
    expect(describeDevice({ userAgent: '' })).toBe('Device · browser');
  });

  it('knows WebKit, which every browser on an iPhone or iPad is, from the engines that only carry its name (UI-32)', () => {
    for (const agent of [UA.ipadSafari, UA.ipadHomeScreen, UA.ipadMobileSite, UA.ipadChrome, UA.iphoneSafari, UA.iphoneHomeScreen, UA.iphoneFirefox, UA.iphoneEdge, UA.macSafari]) expect(isWebKit(agent), agent).toBe(true);
    for (const agent of [UA.macChrome, UA.macFirefox, UA.macEdge, UA.androidPhone, UA.androidTablet, UA.samsungPhone, UA.windowsEdge]) expect(isWebKit(agent), agent).toBe(false);
  });

  it('always answers with a short label the server accepts, even without a browser around', () => {
    // Node has no window: the label falls back instead of throwing on the way to a send.
    expect(deviceLabel()).toBe('Device · browser');
    for (const userAgent of Object.values(UA)) for (const standalone of [false, true]) {
      const label = describeDevice({ userAgent, maxTouchPoints: 5, standalone });
      expect(label).toMatch(/^[A-Za-z ]+ · [A-Za-z ]+$/);
      expect(label.length).toBeLessThanOrEqual(60);
    }
  });
});
