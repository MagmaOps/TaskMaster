import { hashPassword, verifyPassword, validatePasswordStrength } from './passwordService';

describe('passwordService', () => {
  it('hashes and verifies a correct password', async () => {
    const hash = await hashPassword('hunter2pass');
    expect(hash).not.toBe('hunter2pass');
    expect(await verifyPassword('hunter2pass', hash)).toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const hash = await hashPassword('hunter2pass');
    expect(await verifyPassword('wrongpass1', hash)).toBe(false);
  });

  describe('validatePasswordStrength', () => {
    it('accepts a strong password', () => {
      expect(validatePasswordStrength('hunter2pass')).toBeNull();
    });
    it('rejects a short password', () => {
      expect(validatePasswordStrength('ab1')).toMatch(/at least 8/);
    });
    it('rejects a password without a number', () => {
      expect(validatePasswordStrength('onlyletters')).toMatch(/letter and one number/);
    });
    it('rejects a password without a letter', () => {
      expect(validatePasswordStrength('12345678')).toMatch(/letter and one number/);
    });
  });
});
