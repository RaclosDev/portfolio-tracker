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
FROM eclipse-temurin:25-jdk-alpine@sha256:c7c3d0bdf7f2bbc5a05a6712ed334d198360105634ea9adf76fca94f381b1e3f AS backend-build
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
FROM eclipse-temurin:25-jre-alpine@sha256:e1898fd6a11fc965a994d8ace186fd3585aeb636cf8f05f47a723fcfee0b0918
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

# Plan gratuito de Render: 512 MB y 0,1 CPU. Pila de hilo pequeña y heap al 60 % (~307 MB): al 75 % el heap,
# más metaspace, code cache e hilos, pasaba de 512 MB y Render mataba la instancia (503).
# Con 0,1 CPU, el JIT completo (C2) y un GC con muchos hilos se comen el procesador al arrancar: Spring tardaba
# 180-200 s en levantar (despliegues de 4-5 min) frente a 105-115 s con estos flags (#108). Solo C1, un hilo de
# compilación, GC en serie y 1 procesador.
ENTRYPOINT ["java", "-Dfile.encoding=UTF-8", "-Dsun.jnu.encoding=UTF-8", "-Xss256k", "-XX:MaxRAMPercentage=60.0", "-XX:TieredStopAtLevel=1", "-XX:CICompilerCount=1", "-XX:+UseSerialGC", "-XX:ActiveProcessorCount=1", "-jar", "app.jar"]
