# frontend/backend/Dockerfile
#
# 多阶段构建——第一阶段装完整依赖(含devDependencies)把 TS 编译成 JS，
# 第二阶段只留生产依赖+编译好的 dist，镜像体积小很多，也不会把源码
# TS 文件、devDependencies 这些不需要在生产环境跑的东西打进最终镜像。

FROM node:20-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm install --omit=dev
COPY --from=build /app/dist ./dist

# multer 上传的文件默认存在容器本地文件系统——不挂 volume 的话，容器一
# 重建（比如 docker compose up --build 更新代码）之前传的文件全部消失。
# 这个路径要跟你后端代码里 multer 实际配置的 destination 对上，如果不是
# /app/uploads，改成实际那个路径。
VOLUME ["/app/uploads"]

EXPOSE 4000
CMD ["node", "dist/app.js"]
