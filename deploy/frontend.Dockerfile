# frontend/frontend/Dockerfile
#
# Vite 是编译时把环境变量塞进打包出来的 JS 里，不是运行时读取的——
# 所以 VITE_API_URL 得用 ARG 在 build 阶段就传进去，跟后端那种"运行时
# 读环境变量"的做法不一样，这个坑很容易踩（改了 docker-compose.yml 里
# 的环境变量，以为重启容器就生效，结果前端代码里那个地址其实早就编译
# 死了，没重新 build 就不会变）。

FROM node:20-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
