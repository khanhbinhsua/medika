import { db, closeDatabase } from './index.js';
import { normalizeForSearch } from '../crypto/field-encryption.js';

/**
 * Bộ mã ICD-10 thường gặp ở phòng khám đa khoa (tên tiếng Việt). Đây là danh mục
 * KHỞI ĐẦU phục vụ tra cứu/gợi ý — phòng khám mở rộng/nhập thêm khi cần.
 */
const CODES: Array<[string, string]> = [
  // Nội tiết – chuyển hoá
  ['E11.9', 'Đái tháo đường type 2'],
  ['E10.9', 'Đái tháo đường type 1'],
  ['E11.65', 'Đái tháo đường type 2 có tăng đường huyết'],
  ['E78.5', 'Rối loạn lipid máu'],
  ['E78.0', 'Tăng cholesterol máu'],
  ['E66.9', 'Béo phì'],
  ['E03.9', 'Suy giáp'],
  ['E05.9', 'Cường giáp'],
  ['E04.9', 'Bướu giáp đơn thuần'],
  ['E86', 'Mất nước / giảm thể tích'],
  // Tim mạch
  ['I10', 'Tăng huyết áp vô căn'],
  ['I11.9', 'Bệnh tim do tăng huyết áp'],
  ['I20.9', 'Cơn đau thắt ngực'],
  ['I21.9', 'Nhồi máu cơ tim cấp'],
  ['I25.10', 'Bệnh tim thiếu máu cục bộ'],
  ['I48.91', 'Rung nhĩ'],
  ['I50.9', 'Suy tim'],
  ['I63.9', 'Nhồi máu não'],
  ['I64', 'Đột quỵ (tai biến mạch máu não)'],
  ['I83.9', 'Giãn tĩnh mạch chi dưới'],
  ['I88.9', 'Viêm hạch bạch huyết'],
  // Hô hấp
  ['J00', 'Viêm mũi họng cấp (cảm lạnh)'],
  ['J02.9', 'Viêm họng cấp'],
  ['J03.9', 'Viêm amidan cấp'],
  ['J06.9', 'Nhiễm khuẩn hô hấp trên cấp'],
  ['J11.1', 'Cúm'],
  ['J18.9', 'Viêm phổi'],
  ['J20.9', 'Viêm phế quản cấp'],
  ['J40', 'Viêm phế quản'],
  ['J44.9', 'Bệnh phổi tắc nghẽn mạn tính (COPD)'],
  ['J45.9', 'Hen phế quản'],
  ['J30.9', 'Viêm mũi dị ứng'],
  ['J32.9', 'Viêm xoang mạn'],
  ['J34.2', 'Lệch vách ngăn mũi'],
  // Tiêu hoá – gan mật
  ['K21.9', 'Trào ngược dạ dày thực quản (GERD)'],
  ['K29.7', 'Viêm dạ dày'],
  ['K25.9', 'Loét dạ dày'],
  ['K27.9', 'Loét đường tiêu hoá'],
  ['K30', 'Khó tiêu chức năng'],
  ['K52.9', 'Viêm dạ dày – ruột'],
  ['K58.9', 'Hội chứng ruột kích thích'],
  ['K59.0', 'Táo bón'],
  ['K64.9', 'Trĩ'],
  ['K80.2', 'Sỏi túi mật'],
  ['K76.0', 'Gan nhiễm mỡ'],
  ['B18.1', 'Viêm gan B mạn'],
  ['B18.2', 'Viêm gan C mạn'],
  ['A09', 'Tiêu chảy nhiễm khuẩn'],
  // Cơ xương khớp
  ['M54.5', 'Đau thắt lưng'],
  ['M54.2', 'Đau vùng cổ gáy'],
  ['M51.9', 'Bệnh đĩa đệm cột sống'],
  ['M17.9', 'Thoái hoá khớp gối'],
  ['M16.9', 'Thoái hoá khớp háng'],
  ['M15.9', 'Thoái hoá đa khớp'],
  ['M06.9', 'Viêm khớp dạng thấp'],
  ['M10.9', 'Bệnh gút (gout)'],
  ['M81.0', 'Loãng xương'],
  ['M79.7', 'Đau xơ cơ'],
  ['M25.5', 'Đau khớp'],
  // Thận – tiết niệu – sinh dục
  ['N39.0', 'Nhiễm khuẩn tiết niệu'],
  ['N30.9', 'Viêm bàng quang'],
  ['N20.0', 'Sỏi thận'],
  ['N18.9', 'Bệnh thận mạn'],
  ['N40', 'Phì đại tuyến tiền liệt'],
  ['N76.0', 'Viêm âm đạo cấp'],
  ['N92.0', 'Rong kinh'],
  ['N95.1', 'Rối loạn tiền mãn kinh'],
  ['N83.2', 'U nang buồng trứng'],
  // Thần kinh – tâm thần
  ['G43.9', 'Đau nửa đầu (migraine)'],
  ['G44.2', 'Đau đầu do căng thẳng'],
  ['G40.9', 'Động kinh'],
  ['G47.0', 'Mất ngủ'],
  ['F41.9', 'Rối loạn lo âu'],
  ['F32.9', 'Trầm cảm'],
  ['F43.2', 'Rối loạn thích ứng'],
  // Da liễu
  ['L20.9', 'Viêm da cơ địa (chàm)'],
  ['L23.9', 'Viêm da tiếp xúc dị ứng'],
  ['L30.9', 'Viêm da'],
  ['L50.9', 'Mày đay'],
  ['L40.9', 'Vảy nến'],
  ['L70.9', 'Trứng cá'],
  ['B35.9', 'Nấm da'],
  // Mắt – Tai mũi họng
  ['H10.9', 'Viêm kết mạc'],
  ['H25.9', 'Đục thuỷ tinh thể'],
  ['H40.9', 'Glôcôm (tăng nhãn áp)'],
  ['H52.1', 'Cận thị'],
  ['H66.9', 'Viêm tai giữa'],
  ['H61.2', 'Nút ráy tai'],
  ['H81.1', 'Chóng mặt tư thế kịch phát lành tính'],
  // Máu
  ['D50.9', 'Thiếu máu thiếu sắt'],
  ['D64.9', 'Thiếu máu'],
  // Nhiễm trùng
  ['U07.1', 'COVID-19'],
  ['A90', 'Sốt xuất huyết Dengue'],
  ['B54', 'Sốt rét'],
  ['B34.9', 'Nhiễm virus không xác định'],
  ['A08.4', 'Tiêu chảy do virus'],
  ['T78.4', 'Dị ứng'],
  // Triệu chứng thường gặp
  ['R50.9', 'Sốt chưa rõ nguyên nhân'],
  ['R05', 'Ho'],
  ['R07.9', 'Đau ngực'],
  ['R10.4', 'Đau bụng'],
  ['R11.0', 'Buồn nôn'],
  ['R42', 'Chóng mặt / choáng váng'],
  ['R51', 'Đau đầu'],
  ['R53.83', 'Mệt mỏi'],
  ['R60.9', 'Phù'],
  // Khám – dự phòng
  ['Z00.0', 'Khám sức khoẻ tổng quát'],
  ['Z01.4', 'Khám phụ khoa'],
  ['Z23', 'Tiêm chủng'],
  ['Z34.9', 'Theo dõi thai bình thường'],
];

async function main() {
  const rows = CODES.map(([code, name]) => ({
    code,
    name,
    search: normalizeForSearch(`${name} ${code}`),
  }));

  await db
    .insertInto('icd10_codes')
    .values(rows)
    .onConflict((oc) => oc.column('code').doUpdateSet((eb) => ({ name: eb.ref('excluded.name'), search: eb.ref('excluded.search') })))
    .execute();

  const { count } = await db
    .selectFrom('icd10_codes')
    .select((eb) => eb.fn.countAll<string>().as('count'))
    .executeTakeFirstOrThrow();
  console.log(`Đã nạp danh mục ICD-10: ${rows.length} mã (tổng trong bảng: ${count}).`);
  await closeDatabase();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
