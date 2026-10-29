# Context: the validated prepare-web artifact, with nginx.conf copied beside
# release.json and site/. The source checkout is not the build context.
FROM nginx:stable-alpine@sha256:970364228b1e4f932abc22d321932816782cca8a20b85a77552a7cfe9acfb3b5
COPY nginx.conf /etc/nginx/nginx.conf
COPY site/ /usr/share/nginx/html/
COPY release.json /opt/open-design/release.json
USER nginx
EXPOSE 8080
ENTRYPOINT ["nginx", "-g", "daemon off;"]
