FROM python:3.14-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt && useradd -u 10001 -m app
COPY app.py .
RUN mkdir -p /data/attachments && chown -R app:app /data
USER app
ENV ATTACHMENTS_DIR=/data/attachments
EXPOSE 8787
# Proxy headers are handled by the app (TRUSTED_PROXIES), not uvicorn.
CMD ["uvicorn","app:app","--host","0.0.0.0","--port","8787","--workers","1","--no-access-log","--no-proxy-headers"]
