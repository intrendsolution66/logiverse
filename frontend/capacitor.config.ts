// frontend/capacitor.config.ts
//
// Capacitor 把 dist/（Vite build 出来的静态网页）原封不动包进原生外壳里，
// appId/appName 决定的是 App Store / Play Store 上架时的识别信息，不是
// 网页代码本身要改的东西。
//
// webDir 指向 Vite 的 build 输出目录（vite.config.ts 里没有另外设 outDir，
// 用的是默认值 "dist"）。
//
// 之后要在 Mac 上跑 `npx cap add ios`、在装了 Android Studio 的机器上跑
// `npx cap add android`，才会真的产生 ios/、android/ 这两个原生专案
// 目录——这一步本地Linux沙盒环境做不到（iOS一定要Xcode，只能在Mac上
// 跑），这份 config 文件是先准备好，等这两个平台目录加进来之后，
// Capacitor 会自动读这份设置。

import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.intrend.logiverse",
  appName: "LogiVerse",
  webDir: "dist",

  // 开发时如果想直接连本机的 vite dev server（不用每次改完都重新build+
  // sync），把下面这段取消注释，改成你电脑局域网IP。正式打包发布前
  // 一定要把这段注释回去或删掉，不然App会一直尝试连你的开发机，
  // 上架版本连不上就整个白屏。
  // server: {
  //   url: "http://192.168.1.100:5173",
  //   cleartext: true,
  // },

  ios: {
    // 小朋友用手指戳画面比鼠标粗，Capacitor默认的橡皮筋式滚动跟点击
    // 反馈在WebView里有时候会让互动式游戏画面感觉「黏黏的」，这个
    // 设置关掉过度滚动，游戏区块的点击手感会更直接。
    contentInset: "automatic",
  },
  android: {
    // 同上，Android WebView 也关掉过度滚动效果
    allowMixedContent: false,
  },
};

export default config;
