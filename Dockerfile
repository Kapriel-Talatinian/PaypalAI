FROM python:3.11-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY pyproject.toml README.md LICENSE constraints.txt ./
COPY src ./src
RUN pip install --no-cache-dir --constraint constraints.txt .
COPY policies ./policies
COPY examples ./examples
COPY alembic ./alembic
COPY alembic.ini ./
RUN useradd --create-home --uid 10001 disputeflow && chown -R disputeflow:disputeflow /app
USER disputeflow
EXPOSE 8000
CMD ["disputeflow", "serve", "--host", "0.0.0.0"]
