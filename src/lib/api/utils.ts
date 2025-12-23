import { NextResponse } from "next/server";

export function logError(route: string, step: string, err: any) {
  console.error(`[${route}] ${step}:`, err);
}

export function jsonError(route: string, step: string, err: any, status = 500) {
  // compact JSON error response with server-side logging
  console.error(`[${route}] ${step}:`, err);
  return NextResponse.json({ error: err?.message ?? String(err) }, { status });
}

export function jsonErrorMessage(route: string, step: string, message: string, status = 500) {
  console.error(`[${route}] ${step}: ${message}`);
  return NextResponse.json({ error: message }, { status });
}
