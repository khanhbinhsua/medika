# Recon map: Qub-X (web + iOS + Android)

Phạm vi: **vòng lõi phòng khám ngoài bệnh viện** — tin nhắn → lịch hẹn → tiếp đón → bệnh án ngoại trú + đơn thuốc → thu tiền/gói → chăm sóc sau điều trị. Kho, báo cáo, HRM, AI là vòng ngoài.
Cho ai: chưa chốt (giả định: phòng khám thẩm mỹ/da liễu/đa khoa có giấy phép cần EMR trước hạn 31/12/2026 theo TT 13/2025/TT-BYT). Cần bạn xác nhận.
Ngày: 2026-11-24
Nhà phát triển gốc: Coauths (COAUTHS VIETNAM CO., LTD., TP.HCM).

> **Phương pháp:** chỉ đọc trang công khai trên qub-x.com, tốc độ người đọc, không tài khoản, không đọc JS bundle, không ghi network call. Không lưu ảnh chụp (`replica/screens/` để trống — các "ảnh mockup" trên site là ảnh marketing với dữ liệu mẫu, không phải màn hình thật).
> **Điều khoản:** `qub-x.com/vi/terms` mục 9–10 cấm người dùng "đảo ngược, sao chép, khai thác" phần mềm và khẳng định quyền SHTT với "giao diện, quy trình, API, mô hình dữ liệu, tính năng". Bạn không có tài khoản Qub-X nên điều khoản này không ràng buộc qua hợp đồng; dù vậy **chỉ làm việc từ nguồn công khai, viết lại toàn bộ, không dùng tên/logo/copy/dữ liệu mẫu ("Phòng khám Lumi", "Nguyễn Thu Trang"…) của họ.** Mô hình dữ liệu dưới đây là suy luận của ta, không phải của họ.

## Sources

| # | source | URL | notes |
| --- | --- | --- | --- |
| 1 | marketing site (trang chủ) | https://www.qub-x.com/vi | 6 hệ thống, hành trình 6 bước, số liệu khách tham chiếu (3 chi nhánh, ~500 NV, 3.500+ lịch/tháng) |
| 2 | tính năng EMR | https://www.qub-x.com/vi/features/emr | 15/BV1, ICD-10, ký số, khóa hồ sơ, đơn thuốc, nhật ký truy cập |
| 3 | tính năng CRM / hồ sơ khách | https://www.qub-x.com/vi/features/customer-records | 10 phân hệ con, các tab hồ sơ, tự lưu, khiếu nại |
| 4 | lịch hẹn | https://www.qub-x.com/vi/features/scheduling | lịch/bảng trạng thái, hàng chờ máy, đặt online, lịch sử thay đổi |
| 5 | đơn hàng & thanh toán | https://www.qub-x.com/vi/features/payments | gói/shot, thẻ trả trước, công nợ, hoàn tiền có duyệt, MISA meInvoice, hoa hồng |
| 6 | omni-channel | https://www.qub-x.com/vi/omni-channel | 9 kênh, phân công, mẫu trả lời "/", cửa sổ 24h |
| 7 | kho | https://www.qub-x.com/vi/features/inventory | tồn theo chi nhánh, định mức theo dịch vụ, chuyển kho 2 bên xác nhận, sổ kho |
| 8 | phân tích | https://www.qub-x.com/vi/features/analytics | báo cáo nhanh, 6 mảng, so sánh chi nhánh/nhân viên, AI |
| 9 | HRM | https://www.qub-x.com/vi/features/hrm | chấm công khuôn mặt + GPS, bảng công, lịch ca, phép |
| 10 | AI Competitors Analyser | https://www.qub-x.com/vi/features/ai-marketing | giá đối thủ, nhu cầu từ hội thoại, tạo nội dung |
| 11 | bảng giá | https://www.qub-x.com/vi/pricing | Growth / Accelerate / Customizing; EMR + liên thông đơn thuốc chỉ từ Accelerate |
| 12 | FAQ (65 câu, chỉ đọc tiêu đề) | https://www.qub-x.com/vi/faq | có câu "sơ đồ răng nha khoa", "liên thông BHYT" — chưa đọc trả lời |
| 13 | điều khoản | https://www.qub-x.com/vi/terms | xem ghi chú phương pháp |
| 14 | YouTube kênh chính thức | https://www.youtube.com/@CoauthsQubX | **chưa xem** — nguồn tốt nhất cho luồng thật, nên xem tiếp |
| 15 | Coauths | https://www.coauths.com/vi/products | sản phẩm cùng hãng (AIP, Cosmos) — chưa đọc |

Chưa có: help center/tài liệu người dùng công khai, API docs công khai, listing App Store/Google Play (chưa tìm).

## Core loop

Khách nhắn (Zalo/Messenger…) → tư vấn viên chốt lịch ngay trong cuộc chat → lễ tân tiếp đón trên bảng trạng thái → bác sĩ ghi bệnh án 15/BV1 + kê đơn ngay trên lịch hẹn, ký và khóa → thu ngân bán gói/trừ buổi/thu tiền trên cùng một đơn → hệ thống tự lên lịch hỏi thăm. **Một hồ sơ khách xuyên suốt, nhập một lần.** Thứ họ thu tiền thêm (gói Accelerate): EMR + liên thông đơn thuốc quốc gia.

## Screens

Độ tin cậy: tất cả suy luận từ mô tả + mockup marketing. "states seen" = trạng thái được nhắc trên site.

| ID | screen | route / how to reach | purpose | key components | states seen |
| --- | --- | --- | --- | --- | --- |
| S01 | Đăng nhập + chọn chi nhánh | khởi động app | vào hệ thống theo chi nhánh | form, branch switcher | (không thấy) |
| S02 | App shell | mọi trang | điều hướng | topbar: chọn chi nhánh ▾, tìm toàn cục "khách, lịch hẹn, hóa đơn", nút tạo đơn; sidebar 6 hệ thống; ngôn ngữ VI/EN/KO | desktop, mobile |
| S03 | Hộp thư đa kênh | sidebar → Kênh chat | trả lời mọi kênh một chỗ | list hội thoại (avatar, kênh, giờ, preview), tab Chưa đọc / Của tôi, lọc kênh/trạng thái/nhãn, khung chat, ô soạn có "/" mẫu trả lời, ghi chú nội bộ, panel hồ sơ bên phải | khách mới chưa liên kết, chờ lâu (cảnh báo), chưa phân công, cửa sổ 24h đã đóng |
| S04 | Panel "Lịch hẹn mới" | drawer mở từ S03, S11, S17, kho | tạo lịch không rời ngữ cảnh | form điền sẵn tên/SĐT, chọn dịch vụ, giờ, phòng, nhân viên, chi nhánh; lịch sử khám bên cạnh | cảnh báo trùng phòng |
| S05 | Lịch hẹn – lịch | sidebar → Lịch hẹn | xem theo ngày/tuần/tháng/danh sách | calendar grid kéo thả, KPI đầu trang (hôm nay, đã đến, đang trễ, đã thu), bộ lọc NV/phòng/nguồn/nhóm có đếm | lọc rỗng, kéo thả |
| S06 | Lịch hẹn – bảng trạng thái | toggle trên S05 | điều phối tiếp đón | cột trạng thái, thẻ đếm phút chờ, viền cam/đỏ/nhấp nháy, menu thẻ (đã đến/bắt đầu/hoàn tất), cờ khiếu nại | chờ quá ngưỡng |
| S07 | Hàng chờ máy/phòng | tab trong lịch | xếp khách vào máy | card máy (đang dùng/trống, số khách chờ, ước tính phút), ghi chú ngày | máy trống, đang dùng |
| S08 | Chi tiết lịch hẹn | click thẻ lịch | buổi hẹn đầy đủ | gói còn buổi, ghi chú BS & tư vấn, đơn + đã thu, lịch sử thay đổi, in phiếu khám STT + QR, nút mở bệnh án | bắt buộc thu tiền trước hoàn tất |
| S09 | Trang đặt lịch online (công khai) | link riêng của phòng khám | khách tự đặt | chọn chi nhánh, dịch vụ, ngày, khung giờ còn chỗ; VI/EN/KO | hết chỗ, ngày nghỉ lễ, đã gửi (chờ xác nhận) |
| S10 | Danh sách / tìm khách | sidebar → Khách hàng | tra cứu | tìm không dấu theo tên/SĐT/mã | không có kết quả |
| S11 | Hồ sơ khách – tổng quan | S10, S03, S05 | "một hồ sơ đủ để tư vấn" | banner dị ứng/khiếu nại mở/lưu ý lần tới, 4 ô (chi tiêu, công nợ, buổi còn lại, lượt đến), các tab: Tổng quan, Ảnh, Liệu trình & gói, Thẻ trả trước, Thanh toán & công nợ, Hạng thành viên, Lịch hẹn, Chăm sóc & khiếu nại, Biểu mẫu, Ghi chú, Bệnh án & đơn thuốc | tự lưu, có dị ứng |
| S12 | Ảnh trước / sau | tab S11 | so sánh theo lần khám | ô Trước/Sau kéo thả, phóng to | rỗng |
| S13 | Gói & thẻ trả trước | tab S11 | số buổi/số dư | thẻ buổi (đã dùng/còn), thẻ trả trước (tiền tặng, hạn), chuyển nhượng | phần chưa trả bị khóa, sắp hết hạn |
| S14 | Bệnh án ngoại trú 15/BV1 | từ S08 | ghi bệnh án lượt khám | lý do khám, hỏi bệnh, sinh hiệu, chẩn đoán ICD-10 (bệnh chính + kèm), danh sách chọn sẵn, cảnh báo dị ứng đầu lượt | nháp, đã xác nhận (khóa) |
| S15 | Kê đơn thuốc điện tử | trong S14 | đơn theo chẩn đoán | đơn mẫu theo ICD, dòng thuốc (liều/buổi, số ngày, lời dặn), mã đơn, PDF | đã xác nhận có mã đơn |
| S16 | Phiếu đồng ý / biểu mẫu | tab Biểu mẫu | ký trên màn hình | mẫu, khung ký, người chứng kiến, thời điểm | đã ký |
| S17 | Tạo đơn (POS) | topbar, S08, S11 | bán dịch vụ/gói/SP | thẻ buổi của khách (+ để trừ), danh mục, giỏ, "Dùng hôm nay", nhiều cách thu, ngoại tệ, lưu nháp, in báo giá | thu một phần, nháp |
| S18 | Sổ thanh toán | sidebar → Thanh toán | tra mọi giao dịch | tìm theo tên/SĐT/mã khách/mã đơn, lọc Chưa thu/Thu một phần/Đã thanh toán/Đã hủy, in biên nhận, xuất Excel | — |
| S19 | Công nợ | sidebar | gộp nợ theo khách | ô quá hạn / đến hạn 7 ngày / thu nợ 30 ngày | quá hạn |
| S20 | Hoàn tiền | từ trang đơn | gửi → duyệt → hoàn tất | phiếu, thu hồi buổi/số dư, đảo hoàn | chờ duyệt, đã đảo |
| S21 | Hoa hồng | sidebar / "Hoa hồng của tôi" | tổng theo NV | bảng theo tháng, xuất Excel | — |
| S22 | Chăm sóc sau điều trị | sidebar | danh sách hỏi thăm | tab Cần làm / Chờ trả lời / Sắp tới, mẫu tin Zalo, kết quả (Ổn/Có vấn đề/Chưa liên lạc) | gọi chưa được → dời hôm sau |
| S23 | Khiếu nại | sidebar, S11, S03 | phiếu khiếu nại | mã KN-xxxxxx, loại, mức độ, dịch vụ, BS, người phụ trách, timeline, nhắc lần hẹn tới | đang xử lý, lần 2 (gắn cờ) |
| S24 | Tồn kho | sidebar → Kho | tồn theo chi nhánh | bảng tồn vs ngưỡng, nhãn THẤP, hạn dùng gần nhất, banner cảnh báo | sắp hết, hết hạn 30 ngày, lô chưa xác nhận |
| S25 | Chi tiết sản phẩm | S24 | đủ dùng ~N ngày | tồn từng chi nhánh, giá vốn, giá trị tồn, nút nhập/xuất/chuyển | — |
| S26 | Phiếu kho | S24/S25 | nhập / xuất dùng / chuyển / hủy / kiểm kê | dòng hàng, NCC, đơn giá, HSD, trạng thái Nháp → Đang chuyển → Hoàn tất | chờ bên nhận |
| S27 | Sổ kho | S24 | lịch sử biến động | dòng: chứng từ, thay đổi, tồn sau, người làm; lọc loại | — |
| S28 | Báo cáo nhanh | sidebar → Phân tích | hôm qua/hôm nay/ngày mai | 8 chỉ số so cùng ngày tuần trước, biểu đồ theo giờ | — |
| S29 | Phân tích theo kỳ | S28 | 6 mảng + so chi nhánh + nhân viên | chọn kỳ/chi nhánh, so kỳ trước, heatmap NV, chọn ≤6 NV | — |
| S30 | Phân tích AI | S28 | tóm tắt + việc cần làm | 7 phần (Ổn/Cần chú ý/Nghiêm trọng), việc xếp theo tiền, Hỏi AI | — |
| S31 | Chấm công (mobile) | app NV | vào/ra ca | ảnh khuôn mặt, kiểm bán kính chi nhánh | ngoài bán kính |
| S32 | Bảng công / lịch ca / phép | HRM | quản lý | bảng công, đơn nghỉ, quỹ phép | chốt kỳ (khóa) |
| S33 | AI Competitors Analyser | module riêng | giá thị trường + nội dung | khoảng giá theo dịch vụ, brief, ảnh/video/caption chờ duyệt | chờ duyệt, đã duyệt (khóa) |
| S34 | Bảng quản trị | sidebar → Cài đặt | cấu hình | chi nhánh/tầng/phòng/máy, dịch vụ + định mức vật tư, nhóm lịch hẹn (màu), giờ mở cửa/ngày lễ/sức chứa khung giờ, mẫu trả lời, vai trò & quyền, kênh, tích hợp (MISA, chữ ký số) | — |
| S35 | Nhật ký truy cập | quản trị | ai/lúc nào/làm gì/IP | bảng log | — |
| S36 | App khách hàng | iOS/Android | (chỉ nhắc trên bảng giá) | ? | ? — guess |

## Flows

```
F01 Khách nhắn hỏi → có lịch hẹn
    S03 → (Liên kết khách / tạo hồ sơ) → S04 → xác nhận gửi lại qua kênh đang chat
    happy path clicks: ~5 (họ quảng cáo "2 bước, 1 panel")
    edge: khách mới chưa có hồ sơ, trùng phòng, cửa sổ 24h đóng (WhatsApp cần tin mẫu), đổi người phụ trách giữa chừng

F02 Lượt khám có bệnh án (core EMR)
    S06 (đã đến) → S08 → S14 ghi 15/BV1 + ICD-10 → S15 kê đơn → S16 khách ký → Hoàn tất = ký số BS + khóa
    happy path clicks: ~8–10
    edge: dị ứng trùng thuốc kê, cần sửa sau khi khóa (amend), chưa có chữ ký số, đơn gửi liên thông lỗi

F03 Bán gói 10 buổi + làm buổi đầu + trả một phần
    S08 → S17 thêm gói → "Dùng hôm nay" → chọn cách thu (một phần) → xác nhận → nợ còn lại vào S19
    happy path clicks: ~5
    edge: ngoại tệ, thẻ trả trước chưa trả đủ (khóa phần thẻ), bắt buộc thu trước hoàn tất

F04 Hoàn tất dịch vụ → tự trừ kho + tự lên lịch hỏi thăm
    S06 "Hoàn tất" → (hệ thống) trừ định mức kho chi nhánh + sinh mốc hỏi thăm (hôm sau, 1 tuần, tái khám) → S22
    edge: dịch vụ chưa khai định mức, khách dị ứng → luôn hỏi thăm hôm sau, gọi không được → dời

F05 Khiếu nại từ chat
    S03 "Ghi khiếu nại" (lấy tin nhắn làm nội dung) → S23 → nhắc trên thẻ lịch lần tới (S06) → "Đã thực hiện"
    edge: khiếu nại lần 2 gắn cờ

F06 Khách tự đặt online
    S09 chọn chi nhánh/dịch vụ/giờ → lịch "chưa xác nhận", nguồn Trực tuyến → lễ tân gọi xác nhận (S05)
    edge: hết chỗ khung giờ, ngày lễ, email xác nhận

F07 Hoàn tiền có duyệt
    trang đơn → S20 gửi → duyệt → hoàn tất (thu hồi buổi/số dư) → [đã có hóa đơn] lập HĐ điều chỉnh
    edge: đảo hoàn tiền có phiếu riêng

F08 Chuyển kho giữa chi nhánh
    S26 tạo phiếu chuyển → bên nhận "Xác nhận nhận" → tồn 2 bên cập nhật
    edge: lô chưa xác nhận (banner cảnh báo)

F09 Chủ phòng khám xem số
    S28 → S29 chọn kỳ/chi nhánh → S30 việc cần làm
F10 Nhân viên chấm công
    S31 ảnh + vị trí → S32 bảng công
```

Số để vượt: F01 ≤ 5 click, F02 ≤ 10 click, F03 ≤ 5 click.

## Components

| component | variants | states | used on |
| --- | --- | --- | --- |
| AppShell | desktop sidebar, mobile bottom nav | — | tất cả |
| BranchSwitcher | topbar dropdown | 1 / nhiều chi nhánh | S02 |
| GlobalSearch | khách / lịch / hóa đơn, không dấu | rỗng, có kết quả | S02, S10, S18 |
| Drawer/Panel | Lịch hẹn mới, Tạo đơn | mở từ nhiều nơi | S04, S17 |
| AlertBanner | dị ứng, khiếu nại mở, lưu ý | đỏ/cam | S11, S14, S06 |
| StatTile | 4 ô hồ sơ, KPI lịch, 8 chỉ số | so kỳ trước ↑↓ | S05, S11, S28 |
| Tabs | hồ sơ khách (11 tab) | — | S11 |
| Calendar | ngày, tuần, tháng | kéo thả, trùng | S05 |
| KanbanBoard | cột trạng thái | thẻ đếm phút, viền cảnh báo, nhấp nháy | S06 |
| AppointmentCard | màu theo nhóm | chờ, trễ, khiếu nại | S05, S06 |
| FilterChips | có đếm số | — | S03, S05, S18, S24 |
| ConversationList / ChatThread / Composer | "/" mẫu, ghi chú nội bộ | chưa đọc, chờ lâu, cửa sổ đóng | S03 |
| ChannelBadge | 9 kênh | — | S03 |
| SessionCard (thẻ buổi) | gói buổi / shot / trả trước | còn, hết, khóa, sắp hết hạn | S11, S13, S17 |
| Cart / PaymentSplit | nhiều phương thức, ngoại tệ | thu một phần | S17 |
| Timeline | khiếu nại, lịch sử thay đổi, sổ kho | — | S08, S23, S27 |
| ICD10Picker | bệnh chính, bệnh kèm | tìm, chọn | S14, S15 |
| PrescriptionLine | thuốc, liều, ngày, lời dặn | từ đơn mẫu | S15 |
| SignaturePad | khách ký | đã ký + người chứng kiến | S16 |
| SignedLock | ký số BS | nháp / đã khóa | S14, S15 |
| BeforeAfterDropzone | Trước / Sau | rỗng, phóng to | S12 |
| DataTable | lọc, xuất Excel | rỗng | S18, S19, S21, S24, S27, S35 |
| StatusBadge | THẤP, Quá hạn, Đang xử lý… | — | nhiều |
| ApprovalStepper | gửi → duyệt → hoàn tất | đảo | S20, S26 |
| Heatmap table | NV × tháng | ô cao tô màu | S29 |
| AutoSave indicator | — | đang lưu, đã lưu, lỗi | S11 (không có nút Lưu) |
| Toast | — | — | tất cả |

## Inferred data model

```
Organization   id, name, plan (growth|accelerate|customizing), storage_quota
               evidence: pricing — confidence: high
Branch         id, org_id, name, address, geo_radius_m, opening_hours (json), holidays, slot_capacity
               evidence: S09, S31, pricing "không giới hạn chi nhánh" — high
Room / Bed / Machine   id, branch_id, floor, name, type, est_minutes
               evidence: S07 "HIFU 1/2", "tầng, phòng và máy" — high
Staff (User)   id, name, roles[], branch_ids[], locale (vi|en|ko)
Role/Permission  per module + per branch
               evidence: EMR "phân quyền theo vai trò, từng phân hệ", HRM 5 vai trò dựng sẵn — high
Customer       id, code, full_name, phone, dob, gender, source, tier, allergies[], history, current_meds,
               next_visit_note, consent_data_processing_at
               evidence: S11 banner, CRM FAQ — high
Conversation   id, channel (zalo|messenger|instagram|whatsapp|line|kakao|wechat|telegram|tiktok),
               external_thread_id, customer_id?, assignee_id, status, labels[], last_inbound_at, reply_window_ends_at
Message        id, conversation_id, direction, body, attachments, is_internal_note, sent_by
               evidence: S03 — high
QuickReply     id, branch_id?, group, title, body, use_count — high
AppointmentGroup  id, name, color, order, active — high (FAQ lịch hẹn)
Appointment    id, branch_id, customer_id, group_id, source (prebooked|phone|online|walkin), start_at, end_at,
               room_id, machine_id?, staff_ids[], status (unconfirmed|confirmed|arrived|in_progress|done|cancelled|no_show),
               arrived_at, queue_no
AppointmentService  appointment_id, service_id, done_at  (dòng dịch vụ đánh dấu xong → trừ kho)
AppointmentEvent    appointment_id, type, from, to, by, at   (lịch sử thay đổi) — high
Service        id, name, category, price, followup_rule_id
ServiceBOM     service_id, product_id, qty  (định mức vật tư; gói có thể ghi đè) — high
Package        id, name, unit (session|shot), qty, price, validity_days
CustomerPackage  id, customer_id, package_id, order_id, total, used, unlocked_qty, expires_at, transferred_from_id
PrepaidCard    id, customer_id, balance, bonus_balance, paid_amount, unlocked_amount, expires_at — high
Order          id, code (DH-xxxxxx), branch_id, customer_id, appointment_id?, status (draft|unpaid|partial|paid|cancelled), total, due_date
OrderLine      order_id, kind (service|package|product|prepaid|redeem|transfer), ref_id, qty, price, discount
Payment        id, order_id, method (cash|transfer|card|alipay|prepaid|…), amount_vnd, currency, fx_rate, at
Refund         id, order_id, status (requested|approved|completed|reversed), requested_by, approved_by, completed_by, reclaim_sessions
Commission     order_line_id, staff_id, rule (percent|fixed|per_service), amount  (theo tiền thực thu) — high
Invoice        id, order_id, provider (misa_meinvoice), draft_ref, invoice_no, status, adjustment_of — high
FollowUpTask   id, customer_id, appointment_id, due_on, kind (day1|week1|revisit), status (todo|waiting|done), result (ok|issue|unreachable), attempts
Complaint      id, code (KN-xxxxxx), customer_id, type, severity, service_id, doctor_id, owner_id, status, source_message_id?
ComplaintEvent complaint_id, note, by, at — high
Encounter (lượt khám)  id, appointment_id, customer_id, doctor_id, reason, history, vitals (json),
               dx_primary_icd10, dx_secondary_icd10[], notes, status (draft|signed), signed_at, signature_ref, locked
               evidence: EMR page "15/BV1… hoàn tất là xác nhận điện tử và khóa" — high (cấu trúc 15/BV1 chi tiết: medium)
Prescription   id, encounter_id, code (mã đơn quốc gia), status (draft|confirmed|sent|error), pdf_url
PrescriptionItem  drug_id, dose_per_time, times, days, instructions
PrescriptionTemplate  icd10, items — high
ConsentForm / FormTemplate / SignedForm  template_id, customer_id, encounter_id?, signature_image, witness_id, signed_at — high
Photo          id, customer_id, encounter_id?, kind (before|after), storage_key — high
AccessLog      user_id, action (view|print|edit|…), entity, entity_id, ip, at — high
Product        id, name, unit, low_threshold, cost (theo phiếu nhập gần nhất)
Stock          product_id, warehouse_id (kho tổng | chi nhánh), qty
StockLot       product_id, warehouse_id, lot, expires_at, supplier_id
StockDoc       id, type (receipt|issue|transfer|disposal|adjust|stocktake|return), status (draft|in_transit|done), from_wh, to_wh, created_by, completed_by
StockMove      doc_id?, appointment_service_id?, product_id, delta, balance_after, by, at, is_manual — high
Attendance / Shift / LeaveRequest / LeaveBalance  — medium (HRM)
Competitor / PriceObservation / ContentBrief / Asset — medium (AI module)
```

Relationships: Organization 1-n Branch; Branch 1-n Room/Machine, Warehouse; Customer 1-n Conversation, Appointment, Order, CustomerPackage, PrepaidCard, Encounter, Photo, Complaint, FollowUpTask; Appointment 1-1 Encounter (0..1), 1-n Order; Encounter 1-n Prescription, SignedForm; Order 1-n OrderLine, Payment, Refund, Invoice; Service n-n Product qua ServiceBOM.

## Feature matrix

Xem `features.csv`. 78 dòng — must: 32, should: 25, could: 15, skip: 6.

## Out of scope (cannot or should not be cloned)

- **Thương hiệu, copy, dữ liệu mẫu, mockup** của Qub-X/Coauths — tài sản của họ (terms mục 10).
- **Kết nối đơn thuốc quốc gia** — chỉ dựng được adapter; kết nối thật cần cơ sở được cấp mã liên thông và tài khoản bác sĩ trên hệ thống của Bộ Y tế (TT 26/2025/TT-BYT theo FAQ của họ). Đây là việc hành chính của từng phòng khám, không phải tính năng clone được.
- **Ký số / VNeID / sinh trắc** — tích hợp qua nhà cung cấp CA được cấp phép; ta không phát hành chữ ký.
- **Hợp chuẩn TT 13/2025** — tự khai "đúng Thông tư" là tuyên bố pháp lý; phần mềm của ta phải tự đối chiếu văn bản gốc + được thẩm định, không suy ra từ marketing của họ.
- **Tài khoản kênh chat** (Zalo OA/ZBS, Meta, WhatsApp Business, LINE, Kakao, WeChat) — mỗi kênh cần đăng ký/duyệt app riêng của ta; phí do nhà cung cấp thu.
- **Khách hàng tham chiếu, mạng lưới đối tác** (MISA, CA…) — quan hệ thương mại của họ.
- **Dữ liệu giá đối thủ** của module AI — thu thập web của bên thứ ba có rủi ro pháp lý; không làm.

## Size

Screens 36, flows 10, entities ~40. Hard parts:
1. **Omni-channel**: 9 API kênh khác nhau, webhook, cửa sổ trả lời 24h, tin mẫu đã duyệt, quy trình duyệt app từng nền tảng.
2. **EMR có giá trị pháp lý**: ký số qua CA, khóa/sửa bổ sung (amend), nhật ký truy cập, liên thông đơn thuốc quốc gia, mẫu 15/BV1 chính xác.
3. **Tiền chính xác nhiều chi nhánh**: gói/shot/thẻ trả trước mở khóa theo tiền đã trả, công nợ, hoàn tiền có duyệt + đảo, hoa hồng theo thực thu, hóa đơn điện tử MISA + điều chỉnh, ngoại tệ.

Size: **XL — cần thu hẹp.** Đề xuất lát cắt đầu (size **L**): F02 + F03 + F06 (lịch hẹn → hồ sơ khách → bệnh án 15/BV1 + đơn thuốc (adapter giả) → đơn/gói/thanh toán), một kênh chat (Zalo OA) để sau. Kho, HRM, AI, phân tích nâng cao để giai đoạn sau.

## Liên hệ với repo CRM-DK

Recon này được chuyển vào `CRM-DK` (2026-11-24). CRM-DK hiện là "CRM Y tế HIPAA": Express + TypeScript, React + Tailwind, PostgreSQL 16, JWT + TOTP MFA, AES-256-GCM, Phase 5, 320 test (theo README). Điểm cần chốt ở `/replica-architect`:

- **Khung pháp lý lệch:** CRM-DK nhắm HIPAA (Mỹ); vòng lõi Qub-X nhắm TT 13/2025/TT-BYT, TT 26/2025 (đơn thuốc điện tử), Luật BVDLCN 2025, dữ liệu lưu tại Việt Nam. Cần chọn thị trường chính.
- **Có thể tái dùng từ CRM-DK:** xác thực + MFA, mã hóa trường nhạy cảm, audit log, backup/replication — tương ứng các dòng auth/security/privacy trong `features.csv`.
- **Thiếu so với recon:** đa chi nhánh, lịch hẹn + bảng trạng thái, POS/gói/thẻ trả trước/công nợ, bệnh án 15/BV1 + ICD-10 + đơn thuốc, hộp thư đa kênh, kho — cần đối chiếu `docs/03-erd.md` trước khi thiết kế schema.
