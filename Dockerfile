# Imágenes base fijadas por digest (las mismas que porrApp); Dependabot (ecosistema docker) las actualiza.

# Etapa 1: la web (React + Vite)
FROM node:22-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914 AS frontend-build
WORKDIR /app/frontend

# Dependencias primero: se reaprovecha la caché mientras no cambie el lockfile
COPY frontend/package*.json ./
RUN npm ci --no-audit --no-fund

COPY frontend/ ./
RUN npm run build
# El resultado queda en /app/frontend/dist

# Etapa 2: el backend (Spring Boot con el Maven Wrapper, la misma versión de Maven que en local y en la CI)
FROM eclipse-temurin:21-jdk-alpine@sha256:b78a1d385da875588e21207f07dddf9a1418849971ae857fb24c8f3a7d441a72 AS backend-build
WORKDIR /app

COPY backend/mvnw backend/pom.xml ./
COPY backend/.mvn ./.mvn
RUN sh ./mvnw dependency:go-offline -B

COPY backend/src ./src

# La web compilada va dentro del .jar como estáticos
RUN rm -rf ./src/main/resources/static
COPY --from=frontend-build /app/frontend/dist ./src/main/resources/static

RUN sh ./mvnw clean package -DskipTests -B

# Etapa 3: imagen de producción (JRE mínimo Alpine)
FROM eclipse-temurin:21-jre-alpine@sha256:82cf3d9ccbe1ed46252008d51b2f2329e6b9e8a2f4394c4bebefc3ea7f4b1372
WORKDIR /app

# Usuario sin privilegios
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Horas de silencio, resumen diario y fechas de las órdenes, en hora de España
ENV TZ=Europe/Madrid
RUN apk add --no-cache tzdata && \
    cp /usr/share/zoneinfo/$TZ /etc/localtime && \
    echo $TZ > /etc/timezone && \
    apk del tzdata

# El jar queda con dueño root: appuser solo puede leerlo
COPY --from=backend-build /app/target/*.jar app.jar

EXPOSE 8080

ENV SPRING_PROFILES_ACTIVE=prod
ENV LANG=C.UTF-8
ENV LC_ALL=C.UTF-8

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD wget -qO- http://localhost:${PORT:-8080}/actuator/health/liveness > /dev/null || exit 1

USER appuser:appgroup

# Plan gratuito de Render: 512 MB y 0,1 CPU. Pila de hilo pequeña y el heap acotado a la memoria del contenedor.
# Igual que porrApp y loopdeck: JIT completo (C2). El cuelgue de Render eran hilos virtuales bloqueados (#109), no el JIT;
# solo C1 hacía que cada petición gastara más CPU y la carga se encolaba.
ENTRYPOINT ["java", "-Dfile.encoding=UTF-8", "-Dsun.jnu.encoding=UTF-8", "-Xss256k", "-XX:MaxRAMPercentage=75.0", "-jar", "app.jar"]
