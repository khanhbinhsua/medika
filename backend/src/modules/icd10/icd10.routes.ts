import { Router } from 'express';
import { sql } from 'kysely';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import { db } from '../../db/index.js';
import { normalizeForSearch } from '../../crypto/field-encryption.js';

// Danh mục ICD-10 là dữ liệu tham chiếu công khai (không PHI) — chỉ cần đăng nhập.
export const icd10Router: Router = Router();

icd10Router.use(authenticate);

const querySchema = z.object({ q: z.string().trim().min(1).max(100) });

icd10Router.get(
  '/search',
  asyncHandler(async (req, res) => {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      res.setHeader('Cache-Control', 'no-store');
      res.json([]);
      return;
    }
    const q = parsed.data.q;
    const norm = normalizeForSearch(q); // không dấu, thường hoá
    const codePrefix = q.toUpperCase();

    const rows = await db
      .selectFrom('icd10_codes')
      .select(['code', 'name'])
      .where((eb) =>
        eb.or([
          eb('code', 'ilike', `${codePrefix}%`),
          eb('search', 'like', `%${norm}%`),
        ]),
      )
      // Mã khớp tiền tố lên trước, rồi tới khớp theo tên.
      .orderBy(sql`CASE WHEN code ILIKE ${codePrefix + '%'} THEN 0 ELSE 1 END`)
      .orderBy('code')
      .limit(20)
      .execute();

    res.setHeader('Cache-Control', 'no-store');
    res.json(rows);
  }),
);
