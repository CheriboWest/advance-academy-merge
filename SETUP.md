# Setup — chạy repo merge này lần đầu

Hướng dẫn cho người dựng môi trường (bạn + dev team). Làm theo thứ tự; mỗi bước
có cách kiểm tra đã xong chưa.

> **Không bước nào trong file này đụng vào production.** Repo cũ vẫn chạy nguyên.
> Supabase của career-hub **đã pause** (có bản dump trước khi pause);
> `AdvanceAcademyTools` vẫn chạy. Cutover là việc riêng, sau khi mọi thứ ở đây xanh.

---

## Tình trạng — 2026-09-24

Mỗi dòng kèm lệnh tự kiểm chứng, đừng tin cột trạng thái mà không chạy lại.

| # | Bước | Trạng thái | Kiểm chứng bằng |
|---|---|---|---|
| 0 | Token lộ | ✅ remote đã sang SSH, token đã hết hạn | `grep -rl github_pat_ .` chỉ khớp file này |
| 1 | Cứu RLS | ✅ `041` đã commit | `ls supabase/migrations/041_*.sql` |
| 2 | Supabase project mới | ✅ `mfohgcwviupeklfyvzfo`, eu-west-2, ES256 | `curl -s https://mfohgcwviupeklfyvzfo.supabase.co/auth/v1/.well-known/jwks.json` |
| 3 | Apply 43 migration | ✅ sạch, 2 câu verify đều 0 dòng | hai câu SQL ở cuối mục 3 |
| 4 | Tài khoản test | ⚠️ `coach1` xong (admin+approved); thiếu `coach2`, `student1`, `student2` | `select email, is_admin, status from public.users;` |
| 5 | File env | ✅ cả ba file đã đầy đủ | `grep -rn PASTE_ .env.local backend/.env backend-python/.env` → rỗng |
| 6 | Cài & chạy | ✅ ba tiến trình lên, health 200 | `curl localhost:8000/health`, `curl localhost:4000/api/health` |
| 7 | Test tự động | ✅ tsc 0 lỗi, backend 239/239, vitest 7/7, python 32/32 | các lệnh ở mục 7 |
| 7 | Smoke test tay | ❌ chưa làm — cần trình duyệt | 11 bước ở mục 7 |
| 8 | Repo GitHub | ✅ `CheriboWest/advance-academy-merge` | `git remote -v` |
| — | **Deploy Vercel** | ⚠️ frontend sống, backend chưa nối | bảng ngay dưới |
| — | **Dữ liệu** | ✅ 7.527 companies, 30.549 jobs, 24 contacts | `select count(*) from companies;` |

### Trạng thái bản deploy

```bash
url=https://advance-academy-merge-r7tn.vercel.app
curl -s -o /dev/null -w "%{http_code}\n" $url/search              # 200 — Career Hub công khai
curl -s -o /dev/null -w "%{http_code}\n" $url/companies/ecoonline # 200 — dữ liệu thật
curl -s -o /dev/null -w "%{http_code}\n" $url/login               # 200 — auth client OK
curl -s -w "\n%{http_code}\n" $url/api/account/me                 # 502 — CHƯA có backend
```

`/search` và `/companies/*` đọc thẳng Supabase từ server nên **đã chạy được bằng
dữ liệu thật trên production**, không cần đợi Fastify. Mọi thứ đi qua
`app/api/*` thì chưa.

`502` ở dòng cuối là mong đợi cho tới khi deploy Fastify: `BACKEND_URL` chưa set
nên proxy gọi vào `http://localhost:4000` ngay trong container của Vercel.

**Career Hub có deploy, chỉ chưa có lối vào từ nav** — `components/navigation.tsx`
không trỏ tới `/search` hay `/coach/*`. Vào thẳng bằng URL. Đây là hạng mục
Stage 6 ("nhóm nav Find Jobs") ở cuối file, chưa làm là cố ý.

### Còn lại, theo thứ tự

1. Tạo `coach2`, `student1`, `student2` (mục 4) — cần cho smoke test phân quyền
2. Smoke test tay, 11 bước ở mục 7, chạy trên `localhost:3000`
3. Deploy Fastify + FastAPI, rồi set `BACKEND_URL` / `NEXT_PUBLIC_API_URL` trên Vercel
4. Nối Career Hub vào nav (hạng mục Stage 6) — hiện phải gõ URL tay

### Nạp dữ liệu — đã làm, ghi lại cách

Trích từ `~/career-hub-backup-2026-09-23.sql` ba bảng `companies`, `jobs`,
`contacts` (theo thứ tự đó, vì hai bảng sau tham chiếu `companies.id`), lọc bỏ
17 cột trôi, bọc `begin/commit`. Bỏ qua `sponsor_licences` — 139 MB và nạp lại
được bằng `run_import()`.

Hai lỗi gặp phải, cả hai đều là schema trôi chứ không phải lỗi dữ liệu:

1. `column "is_recruitment_agency" does not exist` → 17 cột chỉ có trên DB sống,
   không code nào đọc. Lọc bỏ khi nạp.
2. `invalid input syntax for type integer: "13.00"` → `023a` khai `salary_min`
   là `integer` theo `careerhub/schema.sql`, nhưng dữ liệu thật có 238 mức lương
   phần lẻ khác 0. Đã sửa `023a` sang `numeric`; DB đã dựng thì chạy:
   ```sql
   alter table public.jobs
     alter column salary_min type numeric,
     alter column salary_max type numeric;
   ```

Chuỗi gọi local đã thông: `curl localhost:3000/api/account/me` trả **401**
(`UNAUTHORIZED`) chứ không phải 502 — tức Next proxy tới được Fastify và Fastify
từ chối đúng vì thiếu token. Trên Vercel vẫn 502 cho tới khi làm xong mục 4.

---

## 0. Token đang lộ — đã xử lý, còn một nút bấm

Không liên quan merge.

`career-hub-main` từng giữ một GitHub PAT dạng chữ thường trong URL remote.
Hiện trạng:

- Remote đã đổi sang SSH, đã kiểm tra `ls-remote` chạy được.
- Token (`cheribowest-key`, fine-grained) **đã hết hạn** — không authenticate
  được nữa, nên đây không còn là sự cố khẩn.
- `AdvanceAcademyTools-main` vốn đã dùng SSH, không dính.

Còn lại: GitHub → Settings → Developer settings → Personal access tokens →
Fine-grained tokens → **Delete** `cheribowest-key`. Dọn cho gọn, không gấp.

**Xong khi:** `grep -rl github_pat_ .` chỉ còn khớp đúng file SETUP.md này.

---

## 1. Cứu RLS policy chỉ tồn tại trên DB — ĐÃ XONG (2026-09-23)

Đã dump từ career-hub trước khi pause. Kết quả nằm ở
`supabase/migrations/041_recovered_coach_rls.sql`. Phần dưới giữ lại để chạy lại
lúc cutover.

Ba điều chỉnh so với giả định ban đầu của file này:

- **Ba bảng có policy, không phải bốn.** `coach_company_meta` (4), `outreach_emails`
  (4), `jobs` (1) — tổng 9. `companies` bật RLS nhưng **không có policy nào**, nên
  không có gì để cứu; nó khớp sẵn với trạng thái mà `040` hướng tới.
- **15 bảng còn lại bật RLS mà không policy** → deny-all, chỉ service-role vào
  được. Đúng thiết kế.
- **7 bảng trên live không có trong migration nào** (`search_history`,
  `sponsor_registry_syncs`, `sponsor_registry_entries`, `company_sponsorships`,
  `company_sponsorship_matches`, `company_sponsorship_snapshots`,
  `company_sponsorship_assessments`). Không dòng code nào đụng tới — tàn dư của
  thế hệ sponsorship trước khi `029`/`030` thay thế. **Cố ý không bê sang.**
- **Và 17 cột trôi tương tự**, phát hiện khi nạp dữ liệu: `companies` thừa
  `is_recruitment_agency`, `size_band`, `first_source`; `jobs` thừa 14 cột
  (`description`, `is_remote`, `contract_type`, `salary_currency`,
  `salary_period`, `region`, `postcode`, `role_category`, `raw_data`,
  `expires_at`, `first_seen`, `last_seen`, `source_priority`, `updated_at`).
  Không migration nào tạo chúng, `careerhub/schema.sql` cũng không.

  Đã đối chiếu với code trước khi bỏ: crawler ghi đúng 12 cột mà `023a` tạo
  (`pipeline.py:357-371`), `summarizer.py:102` chỉ đọc `title`. Không chỗ nào
  đọc 17 cột kia. **Không tạo lại** — đừng thêm cột chết vào schema chỉ để chứa
  dữ liệu không ai đọc.

> **Nếu chạy lại: làm trước mọi thứ khác.** Project đã pause thì không mở SQL
> Editor được nữa — pause trước khi dump là tự khoá mình khỏi bản duy nhất.

**A. Sinh thẳng DDL** (cột kết quả `ddl` chính là nội dung file `041`):

```sql
select format(
         'alter table %I.%I enable row level security;',
         schemaname, tablename)
  from pg_tables
 where schemaname = 'public' and rowsecurity
 union all
select format(
         'create policy %I on %I.%I as %s for %s to %s%s%s;',
         policyname, schemaname, tablename,
         case when permissive = 'PERMISSIVE' then 'permissive' else 'restrictive' end,
         lower(cmd),
         array_to_string(roles, ', '),
         coalesce(' using (' || qual || ')', ''),
         coalesce(' with check (' || with_check || ')', ''))
  from pg_policies
 where schemaname = 'public';
```

**B. Dump thô để đối chiếu** — chạy luôn, lưu kết quả lại. Câu A có thể hụt ở
policy có biểu thức lạ; bản thô là chỗ kiểm tra khi nghi ngờ:

```sql
select tablename, policyname, permissive, cmd, roles, qual, with_check
  from pg_policies where schemaname = 'public' order by tablename, policyname;

select tablename, rowsecurity from pg_tables where schemaname = 'public';

select grantee, table_name, privilege_type
  from information_schema.role_table_grants
 where table_schema = 'public'
   and grantee in ('anon','authenticated','service_role');
```

Dán cột `ddl` của câu A vào `supabase/migrations/041_recovered_coach_rls.sql`,
rồi **commit ngay** — đây là lúc thông tin đó lần đầu có bản sao ngoài DB sống.

`041` không chép nguyên cột `ddl`: mỗi `create policy` được thêm
`drop policy if exists` phía trước cho idempotent, các dòng
`enable row level security` trùng với `023a`/`031`/`034` bị lược, và cuối file
lặp lại vòng quét RLS của `011` — vì `011` chạy trước khi bảng career-hub tồn
tại nên `crawl_runs` và `discovery_queries` không được nó phủ.

**Xong khi:** file `041_*.sql` tồn tại và chứa policy cho cả 4 bảng.

---

## 2. Tạo Supabase project staging — ĐÃ XONG (2026-09-23)

Project đang dùng:

| | |
|---|---|
| Tên | `advance-academy-merge` |
| Ref | `mfohgcwviupeklfyvzfo` |
| URL | `https://mfohgcwviupeklfyvzfo.supabase.co` |
| Region | `eu-west-2` (London) — app là CareerHub UK, dùng Reed API |
| JWT | ES256 (đã xác minh JWKS trả 1 key `"alg":"ES256"`) |
| Pooler host | `aws-0-eu-west-2.pooler.supabase.com:5432`, user `postgres.mfohgcwviupeklfyvzfo` |

Career Hub đã pause để nhường slot Free (2 active project / organization);
`AdvanceAcademyTools` vẫn chạy. Bản dump trước khi pause nằm ngoài repo ở
`~/career-hub-backup-2026-09-23.sql` — **không commit**, có dữ liệu thật.

Phần dưới giữ lại cho lần dựng project tiếp theo.

1. supabase.com → **New project**. Đặt tên gì cũng được, ví dụ `advance-academy-staging`.
2. **Bật asymmetric JWT signing key ngay** — Project Settings → JWT Keys → dùng
   ES256/ECC (không dùng legacy HS256 shared secret).

   Tại sao bắt buộc: `backend-python/app/auth.py` xác thực token qua JWKS công
   khai, và `features/career-hub/lib/coach.ts` verify chữ ký cục bộ bằng
   `getClaims()`. Nếu project còn HS256 thì **mọi request tới FastAPI sẽ 401**.

   Kiểm tra:
   ```bash
   curl -s https://<staging-ref>.supabase.co/auth/v1/.well-known/jwks.json
   ```
   Phải thấy `"keys": [ ... ]` **không rỗng**. Rỗng = chưa bật, quay lại làm.

3. Ghi lại 3 giá trị ở Project Settings → API:
   - Project URL
   - `anon` public key
   - `service_role` secret key

**Xong khi:** lệnh `curl` trên trả về mảng `keys` không rỗng.

---

## 3. Apply migration — đúng thứ tự này — ĐÃ XONG (2026-09-23)

Cả 43 file đã chạy sạch trên `advance-academy-merge`, hai câu kiểm tra ở cuối
mục này đều trả 0 dòng.

**Cách nhanh hơn dán tay 43 lần.** Không file migration nào chứa meta-command
của psql, nên gộp lại chạy một lần được (đây không phải Supabase CLI — vẫn là
đúng những file SQL đó):

```bash
cd supabase/migrations
{ printf '%s\n\n' '\set ON_ERROR_STOP on'
  for f in $(LC_ALL=C ls [0-9]*.sql); do printf '%s\n' "\\echo '-- $f'"; cat "$f"; echo; done
} > /tmp/all.sql

psql -h aws-0-eu-west-2.pooler.supabase.com -p 5432 \
     -U postgres.mfohgcwviupeklfyvzfo -d postgres -W -f /tmp/all.sql
```

`LC_ALL=C` là bắt buộc — nó giữ `023_` trước `023a`, và `018_` trước `018a`.
`ON_ERROR_STOP` làm psql dừng ở lỗi đầu tiên, dòng `-- <file>` cuối cùng in ra
chính là file hỏng. Dán tay qua SQL Editor vẫn được, chỉ lâu hơn.

Rất nhiều `NOTICE: ... already exists, skipping` là **bình thường**: `002` khai
báo lại bảng mà `001` đã tạo, `024` khai báo lại cột mà `001`/`023a` đã tạo.
NOTICE ở `024` báo cột của `jobs` đã tồn tại chính là bằng chứng `023a` chạy
đúng.

```
supabase/migrations/001_*.sql  →  023_*.sql      # AdvanceAcademyTools
supabase/migrations/023a_careerhub_base.sql      # 3 bảng gốc career-hub
supabase/migrations/024_ch0001 →  038_ch0015     # career-hub (đã đánh số lại)
supabase/migrations/039_company_delete_across_both_schemas.sql
supabase/migrations/040_close_public_company_read.sql
supabase/migrations/041_recovered_coach_rls.sql  # từ bước 1
```

Ghi chú:

- **Bỏ qua `schema_May_5_2026.sql`** và `supabase/careerhub/schema.sql` — cả hai
  là bản chụp tham khảo, **không phải migration**. Chạy chúng sẽ hỏng.
- **`023a` là file mới, bắt buộc trên project trắng.** `jobs`,
  `coach_company_meta`, `outreach_emails` có trước các migration đánh số của
  career-hub, nên `024`–`039` chỉ `alter table if exists` chúng — trên DB trắng
  các lệnh đó **no-op im lặng**, và `026` mới là chỗ nổ. `023a` tạo sẵn ba bảng
  đó (không tạo `companies` — `001` đã tạo).
- `024_ch0001` cố ý viết kiểu cộng thêm (`add column if not exists`) nên nó
  chồng lên bảng `companies` mà `001` đã tạo. Đúng thiết kế, không phải lỗi.
- Tên file giữ cả số cũ (`ch0001`) vì các file đó tham chiếu nhau trong phần ghi
  chú ("requires migration 0009") — tra bằng `grep ch0009`.
- **`039` và `040` là hai file mới, chưa từng chạy trên DB thật ở đâu.** Máy
  dựng repo này không có Postgres nên chúng chưa được thực thi lần nào — chạy
  chậm và đọc kỹ thông báo lỗi nếu có. Nội dung chúng làm: `039` mở rộng
  allowlist của `delete_companies_permanently` (thiếu nó thì nút xoá công ty bên
  coach lỗi ngay lần bấm đầu); `040` gỡ policy cho `anon` đọc thẳng bảng
  `companies`.

Sau khi xong, chạy đúng câu kiểm tra mà dự án vẫn dùng:

```sql
select tablename, rowsecurity from pg_tables
 where schemaname = 'public' and rowsecurity = false;
```

**Xong khi:** câu trên trả về **0 dòng**.

Câu đó không bắt được bảng *thiếu* (bảng không tồn tại thì không nằm trong
`pg_tables`), nên kiểm tra thêm:

```sql
select unnest(array['companies','jobs','coach_company_meta','outreach_emails',
                    'contacts','crawl_runs','users']) as t
except
select tablename from pg_tables where schemaname = 'public';
```

**Xong khi:** cũng **0 dòng**.

---

## 4. Tạo tài khoản test

Đừng copy `auth.users` thật sang staging. Tạo mới:

1. Supabase → Authentication → Users → **Add user** (2 coach + 2 student).
2. Với **coach**, SQL Editor:
   ```sql
   update public.users
      set is_admin = true, status = 'approved'
    where id = '<user-uuid>';
   ```
3. Với **student**:
   ```sql
   update public.users set status = 'approved' where id = '<user-uuid>';
   ```
   (`status` mặc định là `pending`; để một tài khoản ở `pending` để test màn
   hình chờ duyệt.)

> Nếu bảng `public.users` không có dòng nào sau khi tạo user: trigger
> `handle_new_auth_user` (migration `006`) chưa chạy. Chạy lại `006`.

**Xong khi:** `select id, is_admin, status from public.users;` cho thấy đúng các
tài khoản vừa tạo.

---

## 5. File env

Ba file. Copy từ `.example` rồi điền.

### a. `.env.local` (Next.js) — `cp .env.local.example .env.local`

```bash
BACKEND_URL=http://localhost:4000
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_SUPABASE_URL=https://<staging-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
NEXT_PUBLIC_QUIZ_URL=http://localhost:3001
NEXT_PUBLIC_MENTORSHIP_URL=https://advanceacademy.com/mentorship
```

### b. `backend/.env` (Fastify) — `cp backend/.env.example backend/.env`

Bắt buộc để chạy được:
```bash
PORT=4000
FRONTEND_URL=http://localhost:3000
SUPABASE_URL=https://<staging-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service_role key>
SUPABASE_ANON_KEY=<anon key>
LLM_API_KEY=<Anthropic key>
ADMIN_USER_IDS=<uuid coach 1>,<uuid coach 2>
```
Còn lại (Jina/Exa/Voyage/Groq/Adzuna/Reed…) chỉ cần khi test đúng tính năng đó.

### c. `backend-python/.env` — `cp backend-python/.env.example backend-python/.env`

```bash
SUPABASE_URL=https://<staging-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service_role key>
ANTHROPIC_API_KEY=<Anthropic key>
ALLOWED_ORIGINS=http://localhost:3000
ADMIN_USER_IDS=<uuid coach 1>,<uuid coach 2>
ADZUNA_APP_ID=<...>     # cần cho crawler
ADZUNA_APP_KEY=<...>
REED_API_KEY=<...>
RESEND_API_KEY=<...>    # cần cho gửi outreach
EMAIL_FROM=<...>
```

> **Xin Adzuna app id thứ hai.** Hai crawler dùng chung quota: Fastify gọi
> Adzuna/Reed cho Dream Company, FastAPI gọi cho crawler công ty. Free tier 250
> call/ngày. App id miễn phí, quota tính theo app id — cho mỗi service một cái.

---

## 6. Cài và chạy

```bash
npm install

# FastAPI: venv riêng
cd backend-python
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cd ..
```

Ba tiến trình, ba cửa sổ terminal:

```bash
npm run dev:frontend                          # :3000
npm run dev:backend                           # :4000
cd backend-python && .venv/bin/uvicorn app.main:app --reload --port 8000
```

**Xong khi:** cả ba khởi động không lỗi, và `curl localhost:8000/health` trả 200.

---

## 7. Kiểm tra toàn bộ

```bash
npx tsc --noEmit                                    # kỳ vọng: 0 lỗi
npm run typecheck --workspace backend               # kỳ vọng: im lặng
npm run test --workspace backend                    # kỳ vọng: 239/239
npm test                                            # vitest, kỳ vọng: 7/7
cd backend-python && for f in test_*.py; do .venv/bin/python "$f" >/dev/null || echo "FAIL $f"; done
```

> `npm run build` **không** bắt lỗi type — `next.config.mjs` có
> `typescript: { ignoreBuildErrors: true }`. Luôn chạy `npx tsc --noEmit` riêng.

### Smoke test thủ công — một phiên đăng nhập duy nhất

**Chưa đăng nhập:**
1. `/search` → tìm được công ty (không bị đá về `/login`)
2. `/companies/<slug>` → mở được trang chi tiết

**Student:**
3. `/login` → đăng nhập bằng tài khoản student
4. `/` → dashboard
5. `/jobs` → thêm một job, đổi trạng thái
6. `/coach/dashboard` → **phải bị đá về `/`**

**Coach — cùng trình duyệt, đăng nhập lại bằng tài khoản coach:**
7. `/coach/dashboard` → vào được
8. `/coach/crawler` → chạy một crawl cho 1 role + 1 thành phố
9. `/coach/companies` → xoá vĩnh viễn một công ty → **phải chạy được** (đây là
   đường mà migration `039` sửa; nếu lỗi `unhandled foreign key reference` thì
   `039` chưa được apply)
10. `/coach/sponsored-companies` → mở một công ty, thêm một contact
11. `/coach/outreach/new` → tạo một draft

**Tài khoản `pending`:** đăng nhập → gọi API bất kỳ → bị đưa về `/pending`.

---

## 8. Repo trên GitHub — ĐÃ XONG (2026-09-23)

`origin` = `git@github.com:CheriboWest/advance-academy-merge.git`, nhánh `main`.
Vercel import từ đây, root directory để trống (repo root chính là project).

Hai remote production vẫn bị khoá đường push (push URL =
`DISABLED-production-repo`), nên không thể lỡ tay đẩy nhầm — **đừng "sửa"**.

```bash
git remote -v      # origin đọc/ghi được; tools-upstream & careerhub chỉ fetch
```

---

## 9. Chống trôi trong lúc merge

Hai repo production vẫn nhận fix. Chạy hàng tuần:

```bash
git fetch tools-upstream && git merge tools-upstream/main
```

career-hub thì **không còn** `git subtree pull` được nữa: thư mục `careerhub/`
đã bị gỡ ở Stage 4, nên fix bên đó phải port tay. Đây là lý do thật để không kéo
dài giai đoạn merge.

---

## Việc còn lại (chưa làm, cố ý)

- **Cutover production** — gộp vào project thật. Trước đây mục này ghi phần khó
  là ánh xạ `coach_user_id` → `auth.users` mới. **Bản dump 2026-09-23 cho thấy
  không có gì để ánh xạ:** career-hub có đúng **1 tài khoản** `auth.users`,
  `coach_company_meta` **0 dòng**, `outreach_emails` **0 dòng**. Career-hub cũng
  không có bảng `public.users` nào (`users` trong thống kê là `auth.users`), nên
  không đụng bảng `users` của tools.

  Thứ thật sự phải mang sang là dữ liệu crawl: `companies` 7.527 dòng, `jobs`
  30.549, `contacts` 24 — không dòng nào phụ thuộc vào uuid người dùng.
  `sponsor_licences` (141.904 dòng) không cần mang: nạp lại bằng
  `run_import()` trong `backend-python/app/sponsors/importer.py`.
- **Gộp hai trang đăng nhập** — `/login` và `/coach/login` giờ dùng chung một
  phiên nên trùng nhau. Bỏ cái nào là quyết định về sản phẩm.
- **Bốn hạng mục Stage 6** — deep-link Career Hub → tracker, nhóm nav "Find
  Jobs", Cover Letter, Progress & Engagement. Hai cái cuối đã có sẵn chỗ trong
  schema (`saved_jobs.cover_letter_text`, `job_events`, `user_engagement()`).
