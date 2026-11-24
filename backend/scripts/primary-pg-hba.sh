#!/bin/sh
# Cho phép kết nối replication (image postgres không tự thêm dòng này ngay cả
# với POSTGRES_HOST_AUTH_METHOD=trust). Production: thay 'trust' bằng
# 'scram-sha-256' và giới hạn dải IP thay vì 'all'.
set -e
echo "host replication all all trust" >> "$PGDATA/pg_hba.conf"
echo "Đã thêm dòng replication vào pg_hba.conf"
