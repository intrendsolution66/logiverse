import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { randomBytes, createHash } from "crypto";
import "dotenv/config";

const ACCESS_SECRET  = process.env.JWT_ACCESS_SECRET  ?? "dev-access-secret-32-chars-min!!";
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? "dev-refresh-secret-32-chars-min!";

export interface JwtPayload {
  sub: string;   // user_id
  username: string;
}

// ── Password ──────────────────────────────────────────────────────────────
export const hashPassword = (pw: string): Promise<string> =>
  bcrypt.hash(pw, 12);

export const verifyPassword = (pw: string, hash: string): Promise<boolean> =>
  bcrypt.compare(pw, hash);

// ── JWT ───────────────────────────────────────────────────────────────────
export function signAccessToken(payload: JwtPayload, expiresInMinutes = 15): string {
  return jwt.sign(payload, ACCESS_SECRET, { expiresIn: `${expiresInMinutes}m` });
}

export function signRefreshToken(payload: JwtPayload, expiresInDays = 30): string {
  return jwt.sign(payload, REFRESH_SECRET, { expiresIn: `${expiresInDays}d` });
}

export function verifyAccessToken(token: string): JwtPayload {
  return jwt.verify(token, ACCESS_SECRET) as JwtPayload;
}

export function verifyRefreshToken(token: string): JwtPayload {
  return jwt.verify(token, REFRESH_SECRET) as JwtPayload;
}

// ── Random tokens ─────────────────────────────────────────────────────────
export const generateRefreshToken = (): string => randomBytes(32).toString("hex");

export const hashToken = (token: string): string =>
  createHash("sha256").update(token).digest("hex");
