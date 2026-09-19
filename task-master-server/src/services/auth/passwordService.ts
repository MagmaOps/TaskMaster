import bcrypt from 'bcrypt';
import { config } from '../../config';

/** Password hashing and verification using bcrypt. */

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, config.bcryptRounds);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * Validates password strength: >= 8 chars, at least one letter and one number.
 * Returns null if valid, or a human-readable requirement string if not.
 */
export function validatePasswordStrength(password: string): string | null {
  if (password.length < 8) {
    return 'Password must be at least 8 characters long.';
  }
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return 'Password must contain at least one letter and one number.';
  }
  return null;
}
