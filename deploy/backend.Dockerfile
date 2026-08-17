# frontend/backend/Dockerfile
#
# 多阶段构建——第一阶段装完整依赖(含devDependencies)把 TS 编译成 JS，
# 第二阶段只留生产依赖+编译好的 dist，镜像体积小很多，也不会把源码
# TS 文件、devDependencies 这些不需要在生产环境跑的东西打进最终镜像。
FROM node:20-slim AS build
WORKDIR /app
# build阶段只是编译TS，不需要真的启动Chrome——跳过Puppeteer安装时自动
# 下载Chromium这一步，省时间省带宽(这份Chromium最终也不会被用到，
# 因为这一整个build阶段的产物只有 /app/dist 会被拷进下一阶段)。
# 新版Puppeteer(v23+)把这个环境变量名从PUPPETEER_SKIP_CHROMIUM_DOWNLOAD
# 改成了PUPPETEER_SKIP_DOWNLOAD——两个都设，兼容新旧版本。
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production
# 无头Chrome(Puppeteer生成PDF用)在这种精简Debian镜像里默认缺一大堆
# 运行时需要的共享库，不装的话Chrome直接启动失败。这份清单是Puppeteer
# 官方给Debian系统列的标准依赖，外加 fonts-noto-cjk 保证PDF里的中文
# 正常显示(不装的话中文字很可能变成方块)。
#
# libreoffice-impress + poppler-utils —— PPT讲义上传时转幻灯片图片用
# (pptConverter.ts：pptx→pdf 靠 soffice，pdf→逐页png 靠 pdftoppm)。用
# libreoffice-impress 这个子集而不是完整的 libreoffice 元包——只需要
# Impress模块的PDF导出能力，装完整套件(Writer/Calc/Draw等全家桶)体积
# 大很多、build也慢很多，用不到的部分不装。
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates fonts-liberation fonts-noto-cjk unzip \
    libasound2 libatk-bridge2.0-0 libatk1.0-0 libcairo2 libcups2 \
    libdbus-1-3 libexpat1 libfontconfig1 libgbm1 libglib2.0-0 libgtk-3-0 \
    libnspr4 libnss3 libpango-1.0-0 libx11-6 libx11-xcb1 libxcb1 \
    libxcomposite1 libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 \
    libxrandr2 libxrender1 libxss1 libxtst6 xdg-utils \
    libreoffice-impress poppler-utils \
    && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
# 这一阶段是真正要跑PDF生成的地方，不设PUPPETEER_SKIP_CHROMIUM_DOWNLOAD，
# npm install 会照常把Chromium下载下来。
RUN npm install --omit=dev
COPY --from=build /app/dist ./dist
# multer 上传的文件默认存在容器本地文件系统——不挂 volume 的话，容器一
# 重建（比如 docker compose up --build 更新代码）之前传的文件全部消失。
# 这个路径要跟你后端代码里 multer 实际配置的 destination 对上，如果不是
# /app/uploads，改成实际那个路径。
VOLUME ["/app/uploads"]
EXPOSE 4000
CMD ["node", "dist/app.js"]
