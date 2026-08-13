import type { Response } from "express";

export interface ApiResponse<T = unknown> {
  success: boolean;
  message: string;
  data?: T;
  error?: string;
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
    totalPages?: number;
  };
}

export function ok<T>(
  res: Response,
  data: T,
  message = "Success",
  status = 200
): Response {
  return res.status(status).json({ success: true, message, data } satisfies ApiResponse<T>);
}

export function created<T>(res: Response, data: T, message = "Created"): Response {
  return ok(res, data, message, 201);
}

export function paginated<T>(
  res: Response,
  data: T[],
  total: number,
  page: number,
  limit: number,
  message = "Success"
): Response {
  return res.status(200).json({
    success: true,
    message,
    data,
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
  } satisfies ApiResponse<T[]>);
}

export function notFound(res: Response, message = "Not found"): Response {
  return res.status(404).json({ success: false, message } satisfies ApiResponse);
}

export function badRequest(res: Response, message = "Bad request"): Response {
  return res.status(400).json({ success: false, message } satisfies ApiResponse);
}

export function unauthorized(res: Response, message = "Unauthorized"): Response {
  return res.status(401).json({ success: false, message } satisfies ApiResponse);
}

export function forbidden(res: Response, message = "Permission denied"): Response {
  return res.status(403).json({ success: false, message } satisfies ApiResponse);
}

export function conflict(res: Response, message = "Conflict"): Response {
  return res.status(409).json({ success: false, message } satisfies ApiResponse);
}

export function serverError(res: Response, err: unknown): Response {
  const message =
    process.env.NODE_ENV === "development" && err instanceof Error
      ? err.message
      : "Internal server error";
  console.error("[serverError]", err);
  return res.status(500).json({ success: false, message } satisfies ApiResponse);
}
