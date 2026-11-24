import crypto from 'node:crypto';
import { db, closeDatabase } from '../src/db/index.js';
import { searchHash } from '../src/crypto/field-encryption.js';

// Tạo nhanh một khảo sát NPS active + một lời mời cho bệnh nhân đầu tiên, in ra
// link công khai để kiểm chứng trang /survey/:token — KHÔNG cần đăng nhập staff.
async function main() {
  const patient = await db
    .selectFrom('patients')
    .select('id')
    .where('deleted_at', 'is', null)
    .where('purged_at', 'is', null)
    .orderBy('created_at', 'desc')
    .executeTakeFirst();
  if (!patient) throw new Error('Chưa có bệnh nhân nào — hãy tạo một bệnh nhân trước.');

  // 'custom' để demo nhiều câu + thang điểm tuỳ chỉnh; đổi sang 'nps'/'csat' nếu muốn.
  const kind = process.argv[2] ?? 'custom';
  const survey = await db
    .insertInto('surveys')
    .values({
      name: kind === 'custom' ? 'Khảo sát dịch vụ (demo tuỳ chỉnh)' : 'Khảo sát hài lòng (demo)',
      type: kind as 'nps' | 'csat' | 'custom',
      questions: JSON.stringify(
        kind === 'custom'
          ? [
              {
                id: 'q1',
                text: 'Bạn đánh giá chất lượng khám hôm nay thế nào?',
                type: 'scale',
                min: 1,
                max: 4,
                lowLabel: 'Kém',
                highLabel: 'Xuất sắc',
                primary: true,
                required: true,
                negativeAtOrBelow: 2,
              },
              { id: 'q2', text: 'Bạn sử dụng dịch vụ nào?', type: 'choice', options: ['Khám tổng quát', 'Nha khoa', 'Xét nghiệm'], required: true },
              { id: 'q3', text: 'Điều gì có thể cải thiện?', type: 'text' },
            ]
          : [
              { id: 'nps', text: 'Bạn có sẵn lòng giới thiệu phòng khám cho người thân?', type: 'scale', min: 0, max: 10, lowLabel: 'Rất khó', highLabel: 'Chắc chắn giới thiệu', primary: true, required: true, negativeAtOrBelow: 6 },
              { id: 'comment', text: 'Góp ý thêm (không bắt buộc)', type: 'text' },
            ],
      ),
      status: 'active',
    })
    .returning('id')
    .executeTakeFirstOrThrow();

  const token = crypto.randomBytes(24).toString('base64url');
  await db
    .insertInto('survey_invitations')
    .values({
      survey_id: survey.id,
      patient_id: patient.id,
      token_hash: searchHash(token),
      status: 'sent',
    })
    .execute();

  console.log('\n✅ Đã tạo khảo sát demo + lời mời.');
  console.log('   Survey ID :', survey.id);
  console.log('   Link demo :', `http://localhost:5173/survey/${token}\n`);
  await closeDatabase();
}

main().catch(async (e) => {
  console.error(e);
  await closeDatabase();
  process.exit(1);
});
