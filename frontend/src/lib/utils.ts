import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { format, formatDistanceToNow, parseISO } from "date-fns";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(date: string | Date, fmt = "dd MMM yyyy"): string {
  const d = typeof date === "string" ? parseISO(date) : date;
  return format(d, fmt);
}

export function formatRelative(date: string | Date): string {
  const d = typeof date === "string" ? parseISO(date) : date;
  return formatDistanceToNow(d, { addSuffix: true });
}

export function formatCurrency(amount: number, currency = "MYR"): string {
  return new Intl.NumberFormat("en-MY", { style: "currency", currency }).format(amount);
}

export function truncate(str: string, len = 100): string {
  return str.length > len ? str.slice(0, len) + "…" : str;
}

export function getInitials(name?: string | null): string {
  if (!name) return "?";
  return name.split(" ").slice(0, 2).map(w => w[0]).join("").toUpperCase();
}

export function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

export const VISIBILITY_OPTIONS = [
  { value: "PUBLIC",       label: "Public",       icon: "🌍" },
  { value: "FRIENDS",      label: "Friends",      icon: "👥" },
  { value: "PRIVATE",      label: "Private",      icon: "🔒" },
] as const;

export const ORG_VISIBILITY_OPTIONS = [
  { value: "PUBLIC",        label: "All LifeVerse members", icon: "🌍" },
  { value: "MEMBERS_ONLY",  label: "Members only",          icon: "👥" },
  { value: "PRIVATE",       label: "Hidden",                icon: "🔒" },
] as const;

export type Visibility = "PUBLIC" | "FRIENDS" | "PRIVATE";
export type OrgVisibility = "PUBLIC" | "MEMBERS_ONLY" | "PRIVATE";
