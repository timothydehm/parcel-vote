import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

export const VOTER_COOKIE = "voter_id";

export function getVoterId(req: NextRequest): string | null {
  return req.cookies.get(VOTER_COOKIE)?.value ?? null;
}

export function newVoterId(): string {
  return randomUUID();
}
