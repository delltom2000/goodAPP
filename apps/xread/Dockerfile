FROM python:3.12-slim-bookworm AS whisper
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential cmake curl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN curl --fail --location --retry 3 \
      https://codeload.github.com/ggml-org/whisper.cpp/tar.gz/refs/tags/v1.8.2 -o /tmp/whisper.tgz \
    && echo 'bcee25589bb8052d9e155369f6759a05729a2022d2a8085c1aa4345108523077  /tmp/whisper.tgz' | sha256sum -c - \
    && mkdir /src && tar -xzf /tmp/whisper.tgz --strip-components=1 -C /src \
    && cmake -S /src -B /build -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF \
       -DGGML_NATIVE=OFF -DGGML_OPENMP=OFF -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_SERVER=OFF \
    && cmake --build /build --target whisper-cli --parallel 2 \
    && /build/bin/whisper-cli --help

FROM python:3.12-slim-bookworm AS assets
COPY space/install_assets.py space/release.json /tmp/
COPY releases/Xread-Web-2.2-Windows-x64.zip /tmp/distribution.zip
RUN python /tmp/install_assets.py /tmp/distribution.zip /assets

FROM python:3.12-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PYTHONPATH=/app/Xread \
    HOME=/home/appuser PORT=7860 OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=2
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates ffmpeg fontconfig fonts-noto-cjk libgomp1 \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 1000 appuser && useradd --uid 1000 --gid 1000 --create-home appuser
WORKDIR /app
COPY space/requirements.txt /app/space/requirements.txt
RUN pip install --no-cache-dir --only-binary=:all: -r /app/space/requirements.txt && pip check
COPY space/fonts.conf /etc/fonts/conf.d/30-xread-chinese.conf
COPY --from=whisper /build/bin/whisper-cli /app/Xread/tools/whisper/whisper-cli.exe
RUN ln -s /usr/bin/ffmpeg /app/Xread/tools/ffmpeg.exe \
    && ln -s /usr/bin/ffprobe /app/Xread/tools/ffprobe.exe \
    && fc-match -f '%{family}' 'Microsoft YaHei' | grep -F 'Noto Sans CJK SC'
COPY Xread/*.py /app/Xread/
COPY Xread/web/ /app/Xread/web/
COPY Xread/licenses/ /app/Xread/licenses/
COPY --from=assets /assets/Xread/ /app/Xread/
COPY space/ /app/space/
RUN python /app/space/prepare_web.py /app/Xread/web
USER 1000:1000
RUN python /app/space/check_runtime.py
EXPOSE 7860
CMD ["python", "/app/space/hosted.py"]
