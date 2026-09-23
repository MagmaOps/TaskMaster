import type { CookieOptions, NextFunction, Request, Response } from 'express';
import { config } from '../config';
import * as authService from '../services/auth/authService';
import type { AuthResult } from '../services/auth/authService';

/**
 * HTTP layer for authentication. Translates requests/responses and manages the
 * refresh-token cookie; all business logic lives in authService.
 */

const REFRESH_COOKIE = 'tm_refresh';

function refreshCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProduction,
    path: '/api/auth',
    maxAge: config.jwt.refreshTtlDays * 24 * 60 * 60 * 1000,
  };
}

function setAuthResponse(res: Response, result: AuthResult, status: number): void {
  res.cookie(REFRESH_COOKIE, result.refreshToken, refreshCookieOptions());
  res.status(status).json({
    success: true,
    data: {
      user: result.user,
      accessToken: result.accessToken,
      ...(result.isNewUser !== undefined ? { isNewUser: result.isNewUser } : {}),
    },
  });
}

export async function register(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { email, password, displayName, timezone } = req.body as {
      email: string;
      password: string;
      displayName?: string;
      timezone?: string;
    };
    const result = await authService.register({
      email,
      password,
      displayName,
      timezone,
      userAgent: req.headers['user-agent'],
    });
    setAuthResponse(res, result, 201);
  } catch (err) {
    next(err);
  }
}

export async function login(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { email, password } = req.body as { email: string; password: string };
    const result = await authService.login({
      email,
      password,
      userAgent: req.headers['user-agent'],
    });
    setAuthResponse(res, result, 200);
  } catch (err) {
    next(err);
  }
}

export async function google(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { idToken, timezone } = req.body as { idToken: string; timezone?: string };
    const result = await authService.loginWithGoogle({
      idToken,
      timezone,
      userAgent: req.headers['user-agent'],
    });
    setAuthResponse(res, result, 200);
  } catch (err) {
    next(err);
  }
}

export async function refresh(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const raw = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    const result = await authService.refresh({
      rawRefreshToken: raw ?? '',
      userAgent: req.headers['user-agent'],
    });
    // Rotate the cookie and return only the new access token.
    res.cookie(REFRESH_COOKIE, result.refreshToken, refreshCookieOptions());
    res.status(200).json({ success: true, data: { accessToken: result.accessToken } });
  } catch (err) {
    next(err);
  }
}

export async function logout(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const raw = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    await authService.logout(raw);
    res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

export async function me(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = await authService.getProfile(req.userId as string);
    res.status(200).json({ success: true, data: { user } });
  } catch (err) {
    next(err);
  }
}

/**
 * Partial settings update. Collects only the settings keys present on the
 * request body (each already validated by the route) and merges them into the
 * user's settings; unspecified keys are untouched. Passing only `{ timezone }`
 * behaves exactly as the previous timezone-only endpoint.
 */
export async function updateSettings(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = req.body as Record<string, unknown>;
    const patch: authService.SettingsPatch = {};
    if ('theme' in body) patch.theme = body.theme as authService.SettingsPatch['theme'];
    if ('focus_mode_enabled' in body) patch.focus_mode_enabled = body.focus_mode_enabled as boolean;
    if ('achievement_toasts_enabled' in body) {
      patch.achievement_toasts_enabled = body.achievement_toasts_enabled as boolean;
    }
    if ('project_priority_enabled' in body) {
      patch.project_priority_enabled = body.project_priority_enabled as boolean;
    }
    if ('weight_visibility_enabled' in body) {
      patch.weight_visibility_enabled = body.weight_visibility_enabled as boolean;
    }
    if ('timezone' in body) patch.timezone = body.timezone;
    if ('tier' in body) patch.tier = body.tier as 'free' | 'premium';

    const user = await authService.updateSettings(req.userId as string, patch);
    res.status(200).json({ success: true, data: { user } });
  } catch (err) {
    next(err);
  }
}
