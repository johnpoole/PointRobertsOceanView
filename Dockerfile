FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# The shipfinder scrape needs a real browser, because nothing outside one gets
# past their Unauthorized. --with-deps pulls the system libraries Chromium wants;
# the image grows by a few hundred megabytes and there is no way round it.
RUN playwright install --with-deps chromium

# App: proxy, client source, static page, and the baked terrain asset.
COPY server ./server
COPY src ./src
COPY assets ./assets
COPY index.html styles.css favicon.svg ./

EXPOSE 8080

# The proxy serves the page and the merged feed. AISSTREAM_API_KEY comes from the
# environment; without it vessels report offline and weather/tide still work.
CMD ["python", "-m", "uvicorn", "server.proxy:app", "--host", "0.0.0.0", "--port", "8080"]
