// backend/src/utils/pptConverter.ts
//
// Converts an uploaded .pptx file into one PNG image per slide, so a "PPT
// 讲义" Activity can be played back as a plain image sequence — no PPT
// viewer embedded in the frontend, no re-implementing PowerPoint's layout
// engine in the browser. The conversion happens ONCE, at upload time, not
// on every view.
//
// Pipeline: pptx → pdf (LibreOffice headless) → one png per pdf page
// (poppler's pdftoppm). Both are external system binaries invoked via
// child_process, NOT npm packages — this is a genuine deployment
// dependency: the server this backend runs on needs `libreoffice` (or at
// least `soffice`) and `poppler-utils` (`pdftoppm`) installed. Without
// them, this throws a clear "not installed" error rather than failing
// silently or partially.
//
// Why PDF as the intermediate step instead of asking LibreOffice for PNGs
// directly: `soffice --convert-to png` on a multi-slide pptx only exports
// the FIRST slide — there's no reliable flag to get all of them as
// separate PNGs in one pass. Going through PDF first (where EVERY page
// naturally corresponds to one slide) and then rasterizing each PDF page
// is the standard, reliable way to get all slides out.

import { promises as fs } from "fs";
import path from "path";
import os from "os";
import { randomUUID } from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

// Windows 上 "soffice" 不在 PATH 里，必须用完整路径调用，否则 execFile 会抛 ENOENT。
// 允许用环境变量覆盖，方便以后换机器 / 部署到 Linux 服务器（Linux 上通常直接
// 装了 libreoffice 并注册在 PATH 里，写 "soffice" 就够了）时不用改代码。
const SOFFICE_PATH =
  process.env.SOFFICE_PATH || "C:\\Program Files\\LibreOffice\\program\\soffice.exe";

// 同理，Windows 上 poppler 的 pdftoppm 也不在 PATH 里，必须用完整路径。
const PDFTOPPM_PATH =
  process.env.PDFTOPPM_PATH || "I:\\poppler-26.02.0\\Library\\bin\\pdftoppm.exe";

export interface ConvertedSlide {
  buffer: Buffer;
  mimeType: "image/png";
}

/**
 * Takes raw .pptx bytes, returns one PNG buffer per slide, in order.
 * Throws with a clear message if the required system tools aren't
 * available or the conversion otherwise fails — never returns a partial
 * or silently-empty result.
 */
export async function convertPptxToSlideImages(pptxBuffer: Buffer): Promise<ConvertedSlide[]> {
  const workDir = path.join(os.tmpdir(), `ppt-convert-${randomUUID()}`);
  await fs.mkdir(workDir, { recursive: true });

  try {
    const pptxPath = path.join(workDir, "input.pptx");
    await fs.writeFile(pptxPath, pptxBuffer);

    // ① pptx → pdf
    try {
      await execFileAsync(SOFFICE_PATH, ["--headless", "--convert-to", "pdf", "--outdir", workDir, pptxPath], { timeout: 60_000 });
    } catch (err) {
      const e = err as { code?: string; message?: string };
      if (e.code === "ENOENT")
        throw new Error(
          `找不到 LibreOffice（soffice），尝试的路径是：${SOFFICE_PATH}——请确认已安装 LibreOffice，或通过环境变量 SOFFICE_PATH 指定正确路径`
        );
      throw new Error(`PPT 转 PDF 失败：${e.message ?? "未知错误"}`);
    }
    const pdfPath = path.join(workDir, "input.pdf");
    const pdfExists = await fs.access(pdfPath).then(() => true).catch(() => false);
    if (!pdfExists) throw new Error("PPT 转 PDF 没有产出文件——请确认上传的是有效的 .pptx 文件");

    // ② pdf → one png per page
    const pngPrefix = path.join(workDir, "slide");
    try {
      await execFileAsync(PDFTOPPM_PATH, ["-png", "-r", "120", pdfPath, pngPrefix], { timeout: 60_000 });
    } catch (err) {
      const e = err as { code?: string; message?: string };
      if (e.code === "ENOENT")
        throw new Error(
          `找不到 poppler（pdftoppm），尝试的路径是：${PDFTOPPM_PATH}——请确认已安装 poppler，或通过环境变量 PDFTOPPM_PATH 指定正确路径`
        );
      throw new Error(`幻灯片转图片失败：${e.message ?? "未知错误"}`);
    }

    const files = (await fs.readdir(workDir))
      .filter((f) => f.startsWith("slide") && f.endsWith(".png"))
      // pdftoppm names them slide-1.png, slide-2.png, ... slide-10.png — a
      // plain string sort would put slide-10 before slide-2, so sort by
      // the actual numeric suffix instead.
      .sort((a, b) => {
        const na = parseInt(a.match(/-(\d+)\.png$/)?.[1] ?? "0", 10);
        const nb = parseInt(b.match(/-(\d+)\.png$/)?.[1] ?? "0", 10);
        return na - nb;
      });

    if (files.length === 0) throw new Error("没有产出任何幻灯片图片——请确认这份 PPT 至少有1页内容");

    const slides: ConvertedSlide[] = [];
    for (const f of files) {
      const buffer = await fs.readFile(path.join(workDir, f));
      slides.push({ buffer, mimeType: "image/png" });
    }
    return slides;
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => { /* best-effort cleanup */ });
  }
}