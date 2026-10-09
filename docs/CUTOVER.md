# Cutover: đưa schema merge lên project Supabase production

Mục tiêu: mọi user cũ của AdvanceAcademyTools dùng được app merge **mà không copy
user nào**. Thay vì chuyển user sang project mới, ta nâng chính project production của
Tools lên schema merge (`023a`–`045`) và nạp dữ liệu crawl của Career Hub vào đó. User
giữ nguyên UUID, mật khẩu, session, credits, `status`, CV Library, interview,
saved_jobs — vì họ không đi đâu cả.

Tại sao làm được:

- Prod chạy đúng `001`–`023` (+`018a`), và các file đó giống hệt từng byte với repo
  này. Phần còn thiếu đúng là `023a`–`045`.
- `023a`–`045` gần như chỉ **thêm**: bảng Career Hub, `points_ledger`,
  `reminder_sends`, cột `users.email_reminders` (default `true`), nới check
  `tool_results_tool_check` (`044`), thay hàm `handle_new_auth_user` (`043`, tương
  thích ngược). App Tools cũ vẫn chạy được trên schema mới, nên không cần downtime.
- Career Hub không có user để ánh xạ: 1 auth user, `coach_company_meta` và
  `outreach_emails` đều 0 dòng (dump 2026-09-23).

**Không có `--single-transaction`.** `033` có `create index concurrently`, còn
`040`/`041` tự `begin/commit`. Lưới an toàn là backup ở bước 0 cộng `ON_ERROR_STOP`.

Mọi lệnh dưới đây viết cho **fish**.
psql/pg_dump phải từ bản 15 trở lên (máy này đang có 18.6).

```fish
# Supabase → Project Settings → Database → Connection string → Session pooler
set PROD REF_CUA_PROD       # thay bằng ref thật
set PROD_HOST aws-0-REGION.pooler.supabase.com
set STG mfohgcwviupeklfyvzfo
set STG_HOST aws-0-eu-west-2.pooler.supabase.com

function prod; psql -h $PROD_HOST -p 5432 -U postgres.$PROD -d postgres -W $argv; end
function stg;  psql -h $STG_HOST  -p 5432 -U postgres.$STG  -d postgres -W $argv; end

echo "$PROD | $PROD_HOST | $STG | $STG_HOST"   # cả bốn phải có giá trị
```

Biến và hàm chỉ sống trong terminal đã chạy khối trên: mở terminal mới thì phải chạy
lại. Biến chưa set thì fish thay `postgres.$PROD` bằng **rỗng** (không phải
`postgres.`), các tham số bị lệch, và pg_dump báo `too many command-line arguments
(first is "postgres")`.

---

## 0. Backup prod

```fish
pg_dump -h $PROD_HOST -p 5432 -U postgres.$PROD -d postgres -W \
        -Fc -f ~/aatools-prod-(date +%F).dump
```

File này nằm **ngoài repo**, không commit vì có dữ liệu thật. Định dạng `-Fc` để
`pg_restore` được từng bảng riêng lẻ khi cần.

Ghi lại số liệu để so sánh ở bước 7:

```fish
prod -c "select status, tier, count(*) from public.users group by 1,2 order by 1,2;"
```

## 1. Kiểm tra trôi schema

Career Hub từng trôi khỏi migration (thêm 17 cột và 7 bảng chỉ có trên DB sống), nên
phải kiểm tra prod trước khi chạy gì.

```fish
echo "
-- Phải ra 0 dòng: các bảng Tools tới 023 đều có mặt
select t from unnest(array['saved_jobs','job_events','coaching_sessions','tool_results',
  'admin_actions','trial_usage','candidate_leads','cv_analysis_jobs',
  'company_additional_url']) t
where to_regclass('public.' || t) is null;

-- Phải ra 1 dòng: cột của 022 đã có
select column_name from information_schema.columns
where table_schema='public' and table_name='users' and column_name='lead_id';

-- Phải ra 0 dòng: chưa có tên bảng nào của 023a–045
select t from unnest(array['companies','jobs','contacts','crawl_runs','discovery_queries',
  'sponsor_licences','sponsor_register_imports','company_sponsorship',
  'company_sponsorship_checks','coach_company_meta','outreach_emails',
  'points_ledger','reminder_sends']) t
where to_regclass('public.' || t) is not null;

-- Phải ra 0 dòng: không có tool nào nằm ngoài check mới của 044
select distinct tool from public.tool_results
where tool not in ('cv','dream','interview','coaching','cover_letter');
" | prod
```

Nếu kết quả nào sai thì **dừng lại**, chưa sang bước 2.

Kiểm tra thêm (tuỳ chọn): diff schema của hai project để soi cột trôi trên các bảng
Tools. Khác biệt ở các bảng Career Hub là bình thường.

```fish
pg_dump -h $PROD_HOST -U postgres.$PROD -d postgres -W --schema-only -n public > /tmp/prod.sql
pg_dump -h $STG_HOST  -U postgres.$STG  -d postgres -W --schema-only -n public > /tmp/stg.sql
diff /tmp/prod.sql /tmp/stg.sql | less
```

## 2. Bật JWT ES256 trên prod

Vào Project Settings → JWT Keys và chuyển sang khoá bất đối xứng ES256/ECC. Bước này
bắt buộc: `backend-python/app/auth.py` xác thực qua JWKS, còn
`features/career-hub/lib/coach.ts` dùng `getClaims()`. Nếu project vẫn để HS256 thì
mọi request tới FastAPI sẽ trả 401.

Khoá HS256 cũ chuyển thành "previous" và vẫn xác thực được, nên **user đang đăng nhập
không bị đăng xuất**. Chỉ revoke khoá cũ khi app Tools cũ đã ngừng chạy.

```fish
curl -s https://$PROD.supabase.co/auth/v1/.well-known/jwks.json   # "keys" phải không rỗng
```

## 3. Apply `023a`–`045`

```fish
cd supabase/migrations
begin
  printf '%s\n\n' '\set ON_ERROR_STOP on'
  for f in (LC_ALL=C command ls 0*.sql | awk '$0>="023a"')
    printf '%s\n' "\\echo '-- $f'"; cat $f; echo
  end
end > /tmp/cutover.sql
prod -f /tmp/cutover.sql
```

`LC_ALL=C` giữ `023_` đứng trước `023a`. Gặp lỗi thì dòng `-- <file>` in ra cuối cùng
chính là file hỏng. Sửa lỗi xong thì chạy lại từ file đó trở đi: đừng chạy lại cả
loạt, vì không phải file nào cũng idempotent. Các dòng `NOTICE: ... already exists,
skipping` là bình thường.

## 4. Kiểm tra RLS

```fish
prod -c "select tablename from pg_tables where schemaname='public' and rowsecurity=false;"
```

Kết quả phải là 0 dòng. Nếu có dòng nào, chạy `011_rls_hardening_sweep.sql` (file
này idempotent) rồi kiểm tra lại.

## 5. Nạp dữ liệu crawl từ staging

Staging đã giữ bản sạch: 17 cột trôi đã lọc, `salary_*` đã là `numeric`, `sector` đã
backfill. Copy thẳng từ staging, không cần trích lại từ dump của Career Hub. Thứ tự
`companies` → `jobs` → `contacts` là do pg_dump tự xếp theo khoá ngoại.

```fish
pg_dump -h $STG_HOST -p 5432 -U postgres.$STG -d postgres -W --data-only \
        -t public.companies -t public.jobs -t public.contacts \
  | prod -v ON_ERROR_STOP=1

for q in stg prod
  $q -c "select (select count(*) from companies) c, (select count(*) from jobs) j,
                (select count(*) from contacts) ct;"
end
```

Hai dòng phải khớp nhau (khoảng 7.5k / 30.5k / ≥24). Trước khi nạp, liếc qua staging
xem có company hay contact nào tạo ra để test, không đáng mang sang.

`sponsor_licences` (~140k dòng) **không copy**. Nạp lại bằng `POST /sponsors/import`
(`run_import()` trong `backend-python/app/sponsors/importer.py`) sau bước 6.

## 6. Trỏ app merge sang prod

Đổi ở local, Vercel (frontend) và Railway (backend, backend-python):

| File | Biến |
|---|---|
| `.env.local` | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| `backend/.env` | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `ADMIN_USER_IDS` |
| `backend-python/.env` | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_USER_IDS` |

**`ADMIN_USER_IDS` hiện đang chứa UUID tài khoản test của staging.** Đổi sang UUID
admin thật trên prod, hoặc để trống và dựa vào `users.is_admin`.

Sau đó build lại frontend, vì rewrite `/api/careerhub/*` được cố định lúc build.

## 7. Xác minh

- Chạy lại câu `status, tier, count(*)` ở bước 0: kết quả phải **y hệt** trước khi
  cutover.
- Đăng nhập app merge bằng một tài khoản cũ thật, dùng mật khẩu cũ. Phải thấy CV
  Library, saved jobs và credits như trước, và `/api/account/me` trả `approved`.
- Tài khoản admin vào được `/coach/*`. `/search` và `/companies/*` có dữ liệu.
  backend-python không trả 401 "Unknown token signing key".
- App AdvanceAcademyTools cũ (vẫn trỏ vào prod) vẫn đăng nhập và chạy tool bình
  thường.

## Rollback

Các bảng mới không dính gì tới dữ liệu user. Có hai cách lùi:

- Drop các bảng của `023a`–`045` cùng cột `users.email_reminders`, rồi khôi phục hàm
  `handle_new_auth_user` từ `006_auth_user_sync.sql`.
- Hoặc `pg_restore` dump ở bước 0 vào một project mới.
