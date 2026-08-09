// backend/src/modules/edu/hanzi.controller.ts
//
// 中文字笔顺数据——只有一个接口，读某个字的笔顺json、原样吐回去。
//
// 数据来源是 hanzi-writer-data 这个npm包(9580个常用字，装在后端的
// node_modules里，不是前端打包进去的)。这样设计师在 CourseDesignerPage
// 里随便加什么常用字，都能立刻用——不需要额外的"提取脚本+重新部署"这
// 一步，字的数据本来就已经全部躺在后端服务器上了，这个接口只是按需
// 把某一个字的数据读出来发给前端。
//
// 之所以不直接把 node_modules/hanzi-writer-data 这个目录设成 Express
// 的静态资源目录、让前端直接用URL访问——是想保留在这一层做校验/未来
// 可能加缓存头这些控制的空间，而且"这是一个受authenticate保护的API"
// 比"这是一个谁都能访问的静态文件目录"更符合这个项目其它资源的访问
// 模式(素材库的图片也是走API而不是裸露的静态目录)。

import type { Request, Response } from "express";
import fs from "fs";
import path from "path";

// hanzi-writer-data 装在后端根目录的 node_modules 里(package.json的
// dependencies)，__dirname 是这个文件编译后所在的目录(dist/modules/edu/)，
// 往上跳回后端根目录，再进node_modules找这个包。
const HANZI_DATA_DIR = path.join(__dirname, "..", "..", "..", "node_modules", "hanzi-writer-data");

export async function getHanziStrokeData(req: Request, res: Response) {
  const rawChar = req.params.char ?? "";

  // 防御性校验——理论上 :char 这个路由参数只会是designer在
  // CourseDesignerPage里手动打进去、存进数据库、又原样发回来的一个汉字，
  // 但既然是拼进文件路径里的用户输入，还是按"不可信输入"处理：只允许
  // 1~2个字符(极少数生僻字是Unicode代理对、算2个UTF-16码元，正常汉字
  // 都是1个)，用 path.basename() 顺手挡掉任何 ../ 这类路径穿越企图。
  const char = path.basename(rawChar);
  if (!char || char.length > 2 || char !== rawChar) {
    res.status(400).json({ success: false, message: "无效的字符", data: null });
    return;
  }

  const filePath = path.join(HANZI_DATA_DIR, `${char}.json`);
  // 再次确认算出来的路径真的还在 HANZI_DATA_DIR 底下(双重保险，防止
  // 前面的校验有漏网之鱼)
  if (!filePath.startsWith(HANZI_DATA_DIR)) {
    res.status(400).json({ success: false, message: "无效的字符", data: null });
    return;
  }

  fs.readFile(filePath, "utf-8", (err, raw) => {
    if (err) {
      // 找不到这个字的数据——常见原因是这个字是特别生僻的字，
      // hanzi-writer-data(覆盖9580个最常用字)本身就没收录。
      res.status(404).json({ success: false, message: `找不到"${char}"这个字的笔顺数据`, data: null });
      return;
    }
    try {
      const strokeData = JSON.parse(raw);
      res.json({ success: true, message: "Success", data: strokeData });
    } catch {
      res.status(500).json({ success: false, message: "笔顺数据格式有问题", data: null });
    }
  });
}