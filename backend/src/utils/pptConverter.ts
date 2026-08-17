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

// 生产环境(Linux容器)装好 libreoffice/poppler-utils 之后，soffice/pdftoppm
// 会被注册进系统PATH，写裸命令名就够了，不需要完整路径。本机Windows
// 开发环境如果没有把这两个工具加进PATH，需要在本地 .env 文件里设
// SOFFICE_PATH / PDFTOPPM_PATH 指向实际安装位置（比如
// C:\Program Files\LibreOffice\program\soffice.exe）来覆盖这个默认值——
// 之前这里反过来把Windows本机路径当默认值、生产环境的Linux路径靠环境
// 变量覆盖，导致部署到服务器上如果忘了设环境变量，就会去找一个根本不
// 存在的Windows路径，这正是"找不到LibreOffice"这个报错的原因。
const SOFFICE_PATH = process.env.SOFFICE_PATH || "soffice";

// 同理，poppler 的 pdftoppm 生产环境装好之后也在PATH里，默认用裸命令名。
const PDFTOPPM_PATH = process.env.PDFTOPPM_PATH || "pdftoppm";

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
    // -env:UserInstallation 让这次调用用workDir底下一个独立的配置目录，
    // 不用LibreOffice默认的共享用户配置——headless模式下如果两次转换
    // 前后脚并发跑(比如两位老师同时上传PPT)，共用配置会导致后一个
    // soffice进程报"另一个实例正在运行"直接失败。workDir本来就是每次
    // 转换独有的随机目录，正好拿来隔离配置，不用额外生成。
    //
    // 超时从60秒调到180秒——自建服务器硬件配置未必强，页数多/嵌了不少
    // 图片视频的PPT，LibreOffice转PDF这一步经常超过60秒，之前那个限制
    // 导致"有些PPT能传、有些不能"，体积/复杂度大的那批全部卡在超时上，
    // 但execFile超时被杀掉的进程报错信息比较模糊，不容易一眼看出是超时
    // 还是别的原因，这次额外加一行console.error，方便以后要是还有问题
    // 能直接从日志看出具体是哪一步、等了多久超时的，不用再靠反复试来猜。
    try {
      await execFileAsync(
        SOFFICE_PATH,
        [`-env:UserInstallation=file://${path.join(workDir, "lo-profile")}`, "--headless", "--convert-to", "pdf", "--outdir", workDir, pptxPath],
        { timeout: 180_000 }
      );
    } catch (err) {
      const e = err as { code?: string; message?: string; killed?: boolean; signal?: string };
      console.error("[pptConverter] soffice 转 PDF 失败:", { code: e.code, killed: e.killed, signal: e.signal, message: e.message });
      if (e.code === "ENOENT")
        throw new Error(
          `找不到 LibreOffice（soffice），尝试的路径是：${SOFFICE_PATH}——请确认已安装 LibreOffice，或通过环境变量 SOFFICE_PATH 指定正确路径`
        );
      if (e.killed && e.signal === "SIGTERM")
        throw new Error("PPT 转 PDF 超过3分钟还没完成，已经放弃——这份PPT可能页数太多、嵌了太多高清图片/视频，建议精简一下内容或者拆成几份小的分开上传");
      throw new Error(`PPT 转 PDF 失败：${e.message ?? "未知错误"}`);
    }
    const pdfPath = path.join(workDir, "input.pdf");
    const pdfExists = await fs.access(pdfPath).then(() => true).catch(() => false);
    if (!pdfExists) throw new Error("PPT 转 PDF 没有产出文件——请确认上传的是有效的 .pptx 文件");

    // ② pdf → one png per page
    const pngPrefix = path.join(workDir, "slide");
    try {
      await execFileAsync(PDFTOPPM_PATH, ["-png", "-r", "120", pdfPath, pngPrefix], { timeout: 180_000 });
    } catch (err) {
      const e = err as { code?: string; message?: string; killed?: boolean; signal?: string };
      console.error("[pptConverter] pdftoppm 转图片失败:", { code: e.code, killed: e.killed, signal: e.signal, message: e.message });
      if (e.code === "ENOENT")
        throw new Error(
          `找不到 poppler（pdftoppm），尝试的路径是：${PDFTOPPM_PATH}——请确认已安装 poppler，或通过环境变量 PDFTOPPM_PATH 指定正确路径`
        );
      if (e.killed && e.signal === "SIGTERM")
        throw new Error("幻灯片转图片超过3分钟还没完成，已经放弃——这份PPT页数可能太多，建议拆成几份小的分开上传");
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