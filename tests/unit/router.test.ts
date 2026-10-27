import { describe, expect, it } from 'vitest';
import { parseRoute } from '../../apps/web/src/router';

describe('router', () => {
  it('opens the library for an empty hash and the not-found page for an unknown one', () => {
    for (const hash of ['', '#', '#/']) expect(parseRoute(hash)).toEqual({ name: 'library' });
    for (const hash of ['#/nowhere', '#/wod', '#/wod/fran/delete']) expect(parseRoute(hash)).toEqual({ name: 'notFound' });
    expect(parseRoute('#/wod/fran/play')).toEqual({ name: 'play', id: 'fran' });
  });
});
