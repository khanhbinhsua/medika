-- Tài khoản replication cho hot standby streaming từ primary.
-- Production: mật khẩu mạnh từ secrets, pg_hba giới hạn subnet + scram-sha-256.
CREATE ROLE replicator WITH REPLICATION LOGIN PASSWORD 'repl_test_pw';

-- Bảng mẫu để kiểm chứng dữ liệu replicate sang replica.
CREATE TABLE repl_check (
  id    serial PRIMARY KEY,
  note  text NOT NULL,
  at    timestamptz NOT NULL DEFAULT now()
);
INSERT INTO repl_check (note) VALUES ('seed từ primary lúc khởi tạo');
