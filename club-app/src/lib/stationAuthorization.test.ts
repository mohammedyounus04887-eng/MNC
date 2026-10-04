import { describe, expect, it } from 'vitest';
import { stationSessionIsAuthorized } from './stationAuthorization';

const claims = { clubId: 'a', role: 'reception', station: true };
const grant = { ...claims, uid: 'station-a', enabled: true };
describe('station route authorization', () => {
  it('accepts a matching authenticated station and active grant', () => expect(stationSessionIsAuthorized('station-a', false, claims, grant, 'a', 'reception')).toBe(true));
  it.each([
    ['anonymous', true, claims, grant, 'a'],
    ['revoked', false, claims, { ...grant, enabled: false }, 'a'],
    ['wrong club', false, claims, grant, 'b'],
    ['wrong role', false, { ...claims, role: 'kitchen' }, grant, 'a'],
    ['missing grant', false, claims, undefined, 'a'],
    ['wrong grant subject', false, claims, { ...grant, uid: 'other' }, 'a'],
  ])('rejects %s', (_name, anonymous, token, record, clubId) => {
    expect(stationSessionIsAuthorized('station-a', anonymous, token, record, clubId, 'reception')).toBe(false);
  });
});
