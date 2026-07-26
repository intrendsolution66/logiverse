// src/modules/upload/upload.controller.ts
import type { Response } from "express";
import type { AuthRequest } from "../../middlewares/authenticate.js";
import path from "path";
import fs from "fs";

export async function uploadFile(req: AuthRequest & { file?: any }, res: Response): Promise<void> {
  try {
    if (!req.file) {
      res.status(400).json({ success: false, message: "No file uploaded" });
      return;
    }

    const baseUrl = process.env.BASE_URL ?? `http://localhost:${process.env.PORT ?? 4000}`;
    const fileUrl = `${baseUrl}/uploads/${req.file.filename}`;

    res.json({
      success: true,
      data: {
        url:      fileUrl,
        filename: req.file.filename,
        original: req.file.originalname,
        size:     req.file.size,
        mimetype: req.file.mimetype,
      },
    });
  } catch (err) {
    console.error("Upload error:", err);
    res.status(500).json({ success: false, message: "Upload failed" });
  }
}

export async function deleteFile(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { filename } = req.params;
    const safe     = path.basename(filename);
    const filePath = path.join(process.cwd(), "uploads", safe);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    res.json({ success: true, message: "File deleted" });
  } catch (err) {
    console.error("Delete error:", err);
    res.status(500).json({ success: false, message: "Delete failed" });
  }
}