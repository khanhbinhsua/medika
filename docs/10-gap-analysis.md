# 10 · Gap Analysis — Những gì còn thiếu

> **Lập 2026-11-24.** Đối chiếu ma trận tính năng `replica/features.csv` (recon app gốc
> Qub-X) với code thực tế trong `backend/src/modules`, `frontend/src/pages`, route & schema.
> Trạng thái suy ra từ **đọc code tĩnh** (sự hiện diện của module/route/page), **chưa chạy
> runtime/test** — các mục 🟡 cần xác nhận lại trên UI. Cột `clone` trong `features.csv`
> đang lỗi thời (ghi "no" cho tất cả) nên **không dùng** làm nguồn.

**Ký hiệu:** ✅ xong (có đủ tầng dữ liệu + API + UI) · 🟡 một phần (thiếu UI hoặc một nhánh
nghiệp vụ) · ❌ chưa làm (không có module/route/page).

## Tổng quan

| Mức ưu tiên | Tổng | ✅ Xong | 🟡 Một phần | ❌ Chưa làm |
|---|---|---|---|---|
| **must** | 32 | ~17 | ~11 | ~4 |
| **should** | 25 | ~3 | ~4 | ~18 |
| **could** | 15 | ~1 | ~2 | ~12 |
| skip | 6 | — | — | — (cố ý loại) |

→ **Phần lõi (must) đã đi được quá nửa**, nhưng còn ~15 mục must dở/thiếu. Phần should/could
(đa kênh, kho, khiếu nại, hoa hồng, HRM, phân tích nâng cao, mobile) **gần như chưa bắt đầu**.

---

## A. MUST — bắt buộc cho bản dùng được

### Đã xong (✅)
| # | Tính năng | Bằng chứng |
|---|---|---|
| 1 | Đăng nhập + RBAC theo vai trò & phân hệ | `auth` module, roles/permissions, MFA |
| 4 | Nhật ký truy cập (ai/lúc/làm gì/IP) | `audit` + `phi_access_logs` + AuditPage, hash-chain |
| 2 | Nền đa chi nhánh | `branch` module, BranchesPage, `user_branches` |
| — | Đổi trạng thái lịch (đã đến/bắt đầu/hoàn tất) | `appointment.service` state machine |
| — | Cảnh báo trùng giờ/phòng/nhân sự | conflict check trong `appointment.service` |
| — | Trang đặt lịch online công khai (S09) | `booking` module + PublicBookingPage |
| — | Bệnh án ngoại trú 15/BV-01 từ lịch hẹn | `encounters` module |
| — | Chẩn đoán ICD-10 chính + kèm | `encounters.dx_primary/secondary` + `icd10` catalog |
| — | Hoàn tất = ký điện tử + khóa + amend | `encounters` status/locked + `encounter_versions` |
| — | Kê đơn theo chẩn đoán | `prescriptions` + `encounter_id` |
| — | Ảnh trước/sau theo lần khám (S12) | `photo` module |
| — | POS: tạo đơn dịch vụ/gói + nhiều phương thức + thu một phần | `billing` module, `payments`, status partial |
| — | Mua gói + dùng buổi cùng đơn | `customer_packages` |
| — | Công nợ theo khách | `billing /orders/receivables` (S19) |
| — | Câu đồng ý xử lý dữ liệu cá nhân (PDPL) | `consent` types `privacy_notice`/`data_sharing` |

### Còn một phần (🟡) — ưu tiên hoàn thiện
| # | Tính năng | Thiếu gì |
|---|---|---|
| 3 | **Tìm toàn cục không dấu** (tên/SĐT/mã KH/mã đơn) | Chỉ có search cho ICD-10 + (có thể) trong patient; **chưa có tìm liên-thực-thể toàn cục** trên topbar |
| 5 | Hồ sơ khách: banner dị ứng + khiếu nại + lưu ý | Dị ứng có (`patient_allergies`); **banner khiếu nại chưa có** (module complaints thiếu) |
| 6 | Hồ sơ khách 4 ô: chi tiêu/công nợ/buổi còn lại/lượt đến | Dữ liệu đủ (`spending`, receivables, `customer_packages`) — cần ráp 4 ô vào PatientDetailPage |
| 7 | Hồ sơ khách 11 tab | Có PatientDetailPage — cần xác nhận đủ 11 tab |
| 8 | Lịch hẹn ngày/tuần/tháng/danh sách | AppointmentsPage hiện **chưa có lưới tuần/tháng** — mới dạng ngày/danh sách |
| 9 | Lọc lịch theo nhân viên/phòng/nguồn/nhóm có đếm | Cần xác nhận bộ lọc + badge đếm trên UI |
| 12 | Bảng theo trạng thái + đếm phút chờ + viền cảnh báo | Có trạng thái; **đếm phút chờ + viền cảnh báo** chưa rõ |
| 18 | Sinh hiệu + danh sách chọn sẵn | `encounters.vitals` (jsonb) có; cần picklist chọn sẵn trên UI |
| 19 | Cảnh báo dị ứng ở **đầu lượt khám** | Dữ liệu dị ứng có — cần hiển thị cảnh báo khi mở encounter |
| 22 | Đơn thuốc có mã đơn + **PDF** | Đơn có; **xuất PDF** chưa thấy |
| 30 | Gói theo buổi/shot **tự trừ khi hoàn tất** | `customer_packages.used` có — cần logic tự trừ khi hoàn tất buổi |
| 31 | Sổ thanh toán: lọc + **in biên nhận** + **xuất Excel** | Sổ/lọc có; **in biên nhận & xuất Excel** chưa thấy |

### Chưa làm (❌) — phải bổ sung để đạt "must"
| # | Tính năng | Ghi chú |
|---|---|---|
| 14 | **Lịch sử thay đổi lịch hẹn** (S08) | Không có bảng/version cho appointment (encounters thì có) |
| 24 | **Ký trên màn hình** phiếu đồng ý (chữ ký tay) | `consent` có người chứng kiến, **chưa có capture chữ ký** |
| 32 | **Tự sinh lịch hỏi thăm sau điều trị** theo nhóm dịch vụ (F04) | Bảng `post_treatment_care` có nhưng **chưa thấy job/luồng tự sinh** |
| 10/13 | Panel "Lịch hẹn mới" điền sẵn từ nhiều nơi | Tạo lịch có; cần xác nhận luồng mở panel điền sẵn (có thể chỉ thiếu UI) |

---

## B. SHOULD — nên có (gần như chưa bắt đầu)

| Tính năng | Trạng thái | Ghi chú |
|---|---|---|
| Ghi chú tư vấn viên & bác sĩ tách theo lần đến | 🟡 | `appointment_notes` có — cần tách vai trò/hiển thị |
| Email báo lịch mới + thư xác nhận cho khách | 🟡 | Có `notification`/`reminder`; cần nối email lúc đặt online |
| Báo cáo nhanh hôm qua/nay/mai | 🟡 | `report` module + ReportsPage có — cần xác nhận 3 mốc |
| Tự lưu mọi thay đổi (không nút Lưu) | 🟡 | Cần xác nhận cơ chế autosave trên form |
| **Hộp thư đa kênh** (inbox) + liên kết hồ sơ + phân công + mẫu trả lời + cảnh báo chờ lâu | ❌ | **Cả mảng omnichannel chưa có module** (chỉ có gửi `notification` 1 chiều) |
| **Tồn kho** theo chi nhánh + tự trừ vật tư theo định mức | ❌ | Chưa có module inventory |
| **Phiếu khiếu nại** (mã/loại/mức độ/timeline) | ❌ | Chưa có module complaints |
| **Hoàn tiền có bước duyệt + đảo hoàn** (S20) | ❌ | `billing` mới có huỷ đơn, chưa có luồng refund |
| **Hoa hồng nhân viên** theo thực thu (S21) | ❌ | Không có logic commission |
| Hoá đơn điện tử → **MISA meInvoice** | ❌ | Chưa có adapter tích hợp |
| **Ký số bác sĩ qua CA** | ❌ | Mới là kế hoạch adapter |
| **Liên thông đơn thuốc quốc gia** | ❌ | Mới kế hoạch adapter + giả lập |
| Kéo-thả đổi giờ/phòng | ❌ | Không có drag-drop |
| Nhóm lịch hẹn có màu | ❌ | — |
| Hàng chờ theo máy + thời gian ước tính (S07) | ❌ | — |
| In phiếu khám có STT + QR | ❌ | — |
| Đơn thuốc mẫu theo chẩn đoán | ❌ | — |
| Thẻ trả trước: tiền tặng/hạn dùng/mở khóa theo tiền đã trả | ❌ | `payments` có method `prepaid`, chưa có số dư ví trả trước |
| Danh sách hỏi thăm Cần làm/Chờ trả lời/Sắp tới | ❌ | Phụ thuộc mục A#32 |
| App iOS/Android cho nhân viên | ❌ | Giai đoạn đầu chỉ web responsive |

---

## C. COULD — tùy chọn (hầu hết chưa làm)

Hạng thành viên theo chi tiêu (🟡 có `spending_tiers`), đặt lịch đa ngôn ngữ VI/EN/KO,
xác nhận VNeID/sinh trắc, chuyển nhượng buổi/số dư, quy đổi ngoại tệ, lưu nháp giỏ + in báo
giá, bắt buộc thu tiền trước khi hoàn tất lịch, cửa sổ trả lời 24h, kết nối Messenger/IG/
WhatsApp/LINE/Kakao/WeChat/Telegram/TikTok, phiếu nhập/xuất/hủy/chuyển kho, sổ kho + cảnh báo
hạn dùng, phân tích 6 mảng + so chi nhánh/nhân viên, phân tích AI, chấm công khuôn mặt + vị
trí + lịch ca + nghỉ phép (HRM). → **Phần lớn ❌ chưa làm.**

## D. SKIP — cố ý loại (không làm)

Thương hiệu/copy/mockup/dữ liệu mẫu của Qub-X, khảo sát giá đối thủ tự động, tạo ảnh/video
quảng cáo AI, chứng nhận hợp chuẩn TT13 của Qub-X, tài khoản đối tác MISA/CA/kênh chat của
Qub-X, app khách hàng mobile của Qub-X. (Lý do: tài sản bên thứ ba / rủi ro pháp lý / phải
tự thẩm định — xem `features.csv`.)

---

## E. Đề xuất thứ tự làm tiếp (để chạm mốc "dùng được")

1. **Hoàn thiện các must 🟡 đang dở** (chi phí thấp, dữ liệu đã có): 4 ô hồ sơ khách, cảnh
   báo dị ứng đầu lượt khám, lịch tuần/tháng + bộ lọc đếm, PDF đơn thuốc, in biên nhận +
   xuất Excel sổ thu, tự trừ buổi khi hoàn tất.
2. **Bù must còn thiếu**: lịch sử thay đổi lịch hẹn, ký màn hình phiếu đồng ý, job tự sinh
   lịch hỏi thăm sau điều trị (F04), tìm toàn cục trên topbar.
3. **Chất lượng/nghiệm thu**: bổ sung test cho route/API (hiện chỉ 4 file test), chạy
   `test`/`build`/`lint` cả backend + frontend cho xanh, cập nhật cột `clone` trong
   `features.csv` theo thực tế.
4. **Mảng should lớn theo nhu cầu kinh doanh**: hộp thư đa kênh (Zalo OA trước), hoàn tiền
   có duyệt, tồn kho, khiếu nại — mỗi mảng là một module mới.
