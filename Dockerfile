FROM rclone/rclone:1.75.0
USER root
RUN apk add --no-cache age python3 fuse \
    && mkdir -p /cache /config /data \
    && chown rclone:rclone /cache
ADD https://github.com/getsops/sops/releases/download/v3.10.2/sops-v3.10.2.linux.amd64 /usr/local/bin/sops
RUN chmod 0755 /usr/local/bin/sops
COPY entrypoint-s3.sh /entrypoint-s3.sh
COPY auth-proxy /auth-proxy
RUN chmod 0755 /entrypoint-s3.sh /auth-proxy/authkeys.py /auth-proxy/proxy.py \
    && chown -R rclone:rclone /auth-proxy /entrypoint-s3.sh
ENTRYPOINT ["/entrypoint-s3.sh"]
CMD ["cache"]
