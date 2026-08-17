// backend/src/modules/edu/wopi.routes.ts
//
// createWopiSession 要求LogiVerse登录(authenticate)——是用户在我们自己
// 前端点"查看PPT真实动画版"时调的。checkFileInfo/getFile 这两个是标准
// WOPI接口，Collabora服务器进程直接调用，不带LogiVerse的登录态，靠各
// 自的access_token校验(见wopi.controller.ts里的说明)，所以不挂
// authenticate中间件。

import { Router } from "express";
import { authenticate } from "../../middlewares/authenticate.js";
import { createWopiSession, checkFileInfo, getFile } from "./wopi.controller.js";

const router = Router();

router.post("/assets/:assetId/wopi-session", authenticate, createWopiSession);

// WOPI标准路径规范——CheckFileInfo是 GET /wopi/files/{id}，GetFile是
// GET /wopi/files/{id}/contents，这两个路径格式是协议规定的，不能随便
// 改，Collabora内部是按这个约定去拼URL的。
router.get("/wopi/files/:fileId",          checkFileInfo);
router.get("/wopi/files/:fileId/contents", getFile);

export default router;