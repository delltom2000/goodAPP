FROM python:3.11-slim
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PORT=7860 HOME=/home/user
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg libgomp1 ca-certificates && rm -rf /var/lib/apt/lists/*
RUN useradd -m -u 1000 user
WORKDIR /app
COPY requirements.txt /app/requirements.txt
RUN pip install -r requirements.txt && pip install torch==2.5.1 --index-url https://download.pytorch.org/whl/cpu
COPY --chown=user:user . /app
RUN python download_model.py && chown -R user:user /app
USER user
EXPOSE 7860
CMD ["python", "hosted.py"]
