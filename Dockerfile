# 원가노트 — 컨테이너 이미지
# 데이터(SQLite)는 /data 에 저장됩니다. 반드시 영구 볼륨을 연결하세요.
FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HOST=0.0.0.0 \
    PORT=8000 \
    DATA_DIR=/data

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY static ./static
COPY run.py manage.py ./

RUN useradd --system --uid 10001 --home-dir /app app \
    && mkdir -p /data \
    && chown app /data
USER app

VOLUME ["/data"]
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=4s --start-period=10s --retries=3 \
    CMD python -c "import os,urllib.request; urllib.request.urlopen('http://127.0.0.1:%s/healthz' % os.environ.get('PORT','8000'), timeout=3)"

# 요청 제한이 프로세스 메모리에 있으므로 워커는 1개로 둡니다(run.py 가 그렇게 실행합니다).
CMD ["python", "run.py"]
