# `@hypit/provider-kie`

Provider kết nối Kie.ai **Market API** cho HTTP runtime của Hypit: 15 capability generation
(seedance-2 / 2-fast / 2-mini / 2.5, minimax-h3, grok-imagine-video, grok-imagine-video-1.5-preview,
gpt-image-2, nano-banana-2, nano-banana-pro, seedream-5-lite, wan-2.7-image, wan-2.7-image-pro,
pixverse-v6) và capability đặc biệt `remove-background` của `@hypit/background-removal`.

Toàn bộ field name, enum, giới hạn byte và luật từ chối dưới đây đều **đối chiếu trực tiếp từng
trang `.md` của docs.kie.ai** (`https://docs.kie.ai/market/<model>/<route>.md`, bản MARKET dùng
envelope Market — không phải các API cũ của Kie).

## Cấu trúc

| File | Vai trò |
| --- | --- |
| `src/index.ts` | Re-export surface của package |
| `src/options.ts` | Định nghĩa `CreateKieProviderOptions`, defaults `https://api.kie.ai` / `https://upload.kie.ai` |
| `src/activation.ts` | Runtime facet `use: "@hypit/provider-kie"` (adapter qua runtime-kit) |
| `src/mapping.ts` | `kieMappings` — bảng map PORT → KIE WIRE FIELD cho 15 capability |
| `src/routes.ts` | Route selection, `kieMediaLimits`, luật từ chối theo docs, `normalize` (địa tên `@ref_N`, `thinking_mode` on/off), `packageResult` |
| `src/client.ts` | HTTP client: `createTask`, `recordInfo`, `credits`, `downloadLink`, `uploadMedia` (base64 ≤10MB / stream >10MB) |
| `src/upload.ts` | `kieMediaURLResolver` — fetch bytes theo giới hạn rồi upload, memoized theo resource |
| `src/errors.ts` | `KIE_ENVELOPE_CODES` (200→505), `KieServiceError`, `KieHttpError`, `safeKieReason`, `kieTaskFailure` |
| `src/provider.ts` | `createKieProvider`: lifecycle async start/poll/collect checkpoint-first + `readPricing` |

## Nguyên tắc xây dựng

- **Port nguồn sự thật, wire chỉ mang tên.** `assertMappingCoversPorts` yêu cầu tên capability của
  mapping trùng `model` trong bảng port của model-package, và mọi field key trùng tên port. Không có
  port nào được provider tự đặt giá trị mặc định.
- **Checkpoint-first lifecycle.** `start` compile request → `createTask` → `checkpoint({handle, receipt})`
  → pending wake; `poll` đọc `recordInfo`, map state (`waiting`/`queuing`/`generating` → pending,
  `success` → ready với `urls`, `fail` → failure giữ nguyên `failCode`/`failMsg`); `collect` tải từng
  URL (chỉ HTTPS/loopback), đưa vào `ResourceStore`, đóng gói bằng `packageResult` seal
  (image/video/audio set — remove-background trả một BlobRef đơn).
  Handle dạng `{contract: "hypit.kie-operation@1", taskId, capability, model, startedAt}`.
- **Không chạy ngửa lỗi transport.** HTTP 429/5xx/transport error đưa task về pending retry đúng
  ngưỡng `pollIntervalMs`; `operationTimeoutMs` chốt hạn; state lạ (`/disappeared/`) là FAILED, không
  treo.
- **Luật narrower-than-model ở `supports()`:** khi docs Kie hẹp hơn bề mặt model, provider từ chối
  ngay với lý do dẫn source, không tự "điều chỉnh" request.

## Trường hợp đặc biệt đã xử lý theo docs

- **GPT Image 2**: slug model **flat** (`gpt-image-2-text-to-image` / `gpt-image-2-image-to-image`)
  — không có prefix `gpt/`; i2i bắt buộc `input_urls` (≤16); aspect `auto` chỉ được 1K (còn "không
  khai báo aspect" thì chính model surface yêu cầu aspect bắt buộc nên không thể xảy ra qua provider);
  4K cấm `1:1, 3:1, 1:3, 9:21`; 2K cấm `5:4, 4:5, 3:1, 1:3, 9:21`; `background` chỉ khi resolution 1K.
- **Grok Imagine**: i2v ≤7 ảnh, ≤10MB; 1080p chỉ chạy đúng 1 ảnh; thời lượng `duration` là `number`
  (6..30s) chứ không phải chuỗi; 1.5-preview là model **flat** `grok-imagine-video-1-5-preview`
  (≤7 ảnh, ≤20MB, `duration` integer 1..15) và khi chỉ 1 ảnh, aspect_ratio phải `auto` (Kie đọc tỷ
  lệ từ ảnh — aspect khác `auto` với 1 ảnh bị từ chối; với >1 ảnh cấm `1080p`).
- **Minimax H3**: ba nhóm route `reference-to-video` / `image-to-video` / `text-to-video`;
  text route ở Kie **bắt buộc aspect_ratio**, còn frame route thì chính surface model đã cấm
  aspect đi kèm (`atMostOneOf` của model).
- **Seedance family**: `asset://{assetId}`/URL; refs image ≤9, video ≤3, audio ≤3; first/last frame
  và multimodal-reference là ba scenario loại trừ lẫn nhau (model surface đã cấm trước); `web_search`
  chỉ text-to-video. Model resolution enum đúng chuỗi Kie: `4k` chữ thường cho seedance-2.
- **Wan 2.7**: `thinking_mode` là boolean (Kie đọc nguyên trạng, chỉ áp dụng khi không có
  `input_urls` và không `enable_sequential` — model surface đã cấm cặp imageSet/extendedReasoning,
  provider chặn cặp images/extendedReasoning); 4K chỉ chạy text-to-image ở Standard Mode (reject khi
  có `input_urls` hoặc `enable_sequential: true`); >4 ảnh mỗi đợt cần `imageSet: true` (sequential
  tối đa 12 theo port `count` của model); `input_urls` ≤9 ảnh; docs không ghi cap MB → không set limit.
- **Nano Banana 2 / Pro**: model flat `nano-banana-2` / `nano-banana-pro`; image_input ≤14 (2) /
  ≤8 (pro), ≤30MB; aspect enum 15 giá trị khớp đúng dải `1:4..21:9` của model; output_format
  `png|jpeg`.
- **Seedream 5 Lite**: slug `seedream/5-lite-image-to-image` (nhánh i2i tách hẳn khỏi family
  seedream trên sitemap); i2i bắt buộc `image_urls` + aspect + quality (`basic|high|ultra`);
  `nsfw_checker` boolean được relay, `output_format` là `png|jpeg`.
- **PixVerse v6**: bốn route theo đúng trang Kie — `pixverse-v6/reference-to-video` (Fusion, image
  refs ≤7, bắt buộc prompt+refs+aspect+quality+duration, không nhận referenceVideo), `pixverse-v6/transition`
  (cặp first/last bắt buộc cả hai, không aspect), `pixverse-v6/image-to-video` (frame đơn; Kie read
  `image_urls` ≤2 ảnh ≤20MB, không aspect — `normalize()` đổi `first_frame_image_url` → `image_urls`
  sau khi chọn route), và `pixverse-v6/text-to-video` (bắt buộc aspect concreto + duration + quality).
  Fusion/t2v cấm aspect `auto`; `ref_name` do provider sinh vị trí `ref_N` (trang Fusion yêu cầu uri
  `@ref_name` trong prompt); fusion không ghi cap MB → limit entry consciously bỏ trống.
- **remove-background** (`recraft/remove-background`): input là `{image: <URL file sau upload>}`,
  media `image/jpeg|image/png|image/webp`, ≤5MB (docs còn nêu cap 16MP/4096px/256px — package chỉ
  kiểm byte; phần pixel là phạm vi chấp nhận ở phía Kie). Upload dùng
  `/api/file-base64-upload` (≤10MB) hoặc `/api/file-stream-upload` (>10MB).

## Envelope Market & lỗi

Mọi POST đi qua `/api/v1/jobs/createTask` + `recordInfo` (`/api/v1/jobs/recordInfo?taskId=`), đáp án
`{code, msg, data}` với code enum `200, 401, 402, 404, 422, 429, 433, 455, 500, 501, 505` — map vào
`KIE_ENVELOPE_CODES` (`KIE_BAD_REQUEST`, `KIE_UNAUTHORIZED`, `KIE_QUOTA`, `KIE_NOT_FOUND`,
`KIE_VALIDATION`, `KIE_RATE_LIMITED`, `KIE_SUBKEY_LIMIT`, `KIE_MAINTENANCE`, `KIE_INTERNAL`,
`KIE_GENERATION_FAILED`, `KIE_FEATURE_DISABLED`). Result URLs đọc từ
`data.response.resultUrls` (chuẩn Market), fallback `resultJson` (JSON string) như các callback page
mô tả. Pricing đọc `/api/v1/chat/credit` (data là số credit còn lại).

## Cấu hình (activation)

`CreateKieProviderOptions`: `apiKey` (credential ref), `pollIntervalMs` (default 5s),
`requestTimeoutMs` (default 300s), `operationTimeoutMs` (default 15 phút), `fetch` (inject cho test),
`baseUrl` / `uploadBaseUrl` (default Kie production), `instance` / `pool`. Facet register mọi
capability với `supports()` + async endpoint; capability `remove-background` được adapter tự phân
biệt trong `start` (không cần client viết route riêng).

## Test

```bash
node --import tsx --test --test-isolation=none packages/provider-kie/test/routes.test.ts packages/provider-kie/test/provider.test.ts
```

- `routes.test.ts`: mapping-coverage (mỗi mapping khớ port table của model), đúng route khi compile,
  mọi rejection rule bẫy đúng thông điệp, media limits theo docs.
- `provider.test.ts`: fake Kie server — registry, lifecycle checkpoint-first (start → wake → poll →
  ready → collect), failure path (`fail` state, `failCode` truyền thẳng), state không rõ, `readPricing`.
