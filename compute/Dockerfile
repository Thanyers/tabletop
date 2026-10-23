FROM python:3.12.10-slim-bookworm@sha256:fd95fa221297a88e1cf49c55ec1828edd7c5a428187e67b5d1805692d11588db
RUN pip install --no-cache-dir numpy==2.3.4 pandas==2.3.3 scipy==1.16.3 openpyxl==3.1.5 python-dateutil==2.9.0.post0 pytz==2026.5 tzdata==2026.5 six==1.17.0 et-xmlfile==2.0.0 \
    && useradd --uid 10001 --create-home compute
USER 10001:10001
WORKDIR /tmp
ENV PYTHONDONTWRITEBYTECODE=1 OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1
CMD ["sleep", "infinity"]
