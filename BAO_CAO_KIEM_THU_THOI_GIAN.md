# Báo cáo kiểm thử logic thời gian — 30/10/2026

## Đã kiểm thử tại máy cục bộ

- `node --check app.js` và `node --check bilingual.js`: đạt.
- Frontend trong trình duyệt với dữ liệu và thời gian máy chủ giả lập: 45 kiểm tra trạng thái/giờ kết thúc/lọc/Timeline và 18 kiểm tra luồng thao tác liên tiếp: đạt.
- Migration đã chạy trên PostgreSQL cục bộ bằng PGlite với schema gốc và một ca cũ đang chạy. Kiểm tra cột mới, deadline ca cũ không đổi, bắt đầu sớm/trễ, tạm dừng, tiếp tục, ±1 phút, hoàn tất, đặt lại và tăng version: đạt.
- API công khai của Supabase đang dùng cho website: `room`, `actual_started_at`, `deadline_at` tồn tại; `appointment_date` chưa tồn tại (HTTP 400, mã 42703). Chưa chạy migration trên dự án thật.

| # | Tình huống | Kết quả cục bộ |
|---|---|---|
| 1 | Hẹn 14:25, chưa bắt đầu lúc 14:15 | Chưa bắt đầu, 40:00, không trễ |
| 2 | Hẹn 14:25, chưa bắt đầu lúc 14:35 | Chưa bắt đầu, 40:00, trễ 10 phút |
| 3 | Bắt đầu 14:15 | Kết thúc 15:05, đồng hồ 50:00, planned 40 phút |
| 4 | Bắt đầu 14:20 | Kết thúc 15:05, đồng hồ 45:00 |
| 5 | Bắt đầu 14:25 | Kết thúc 15:05, đồng hồ 40:00 |
| 6 | Bắt đầu 14:35 | Kết thúc 15:15, đồng hồ 40:00 |
| 7 | Bắt đầu 14:45 | Kết thúc 15:25, đồng hồ 40:00 |
| 8 | Chưa bắt đầu lúc 15:10 | Vẫn chưa bắt đầu, không thuộc bộ lọc quá giờ |
| 9 | Đang chạy và qua deadline | Chuyển sang quá giờ điều trị |
| 10 | Tạm dừng | Giữ nguyên `remaining_sec` khi thời gian trôi |
| 11 | Tiếp tục | Deadline = giờ tiếp tục + thời gian còn lại; giữ `actual_started_at` |
| 12 | ±1 phút trước/sau bắt đầu | Thời lượng và deadline đổi đúng 60 giây; version tăng |
| 13 | Đặt lại rồi bắt đầu | Xóa dấu bắt đầu cũ; lần bắt đầu mới dùng công thức giờ hẹn |
| 14 | Hoàn tất | Dừng đồng hồ; ghi `finished_at`; trạng thái hoàn tất |
| 15 | Hai thiết bị cùng mở | **Cần xác minh trên Supabase thật sau triển khai**; mã Realtime không thay đổi |
| 16 | Tải lại/mở lại website | Dữ liệu được ánh xạ lại từ hàng Supabase trong thử nghiệm; **cần xác minh trên website thật** |
| 17 | Hẹn 23:50, thời lượng 40 phút | Kết thúc theo lịch 00:30 +1 ngày; hẹn 00:10 ngày sau không bị báo trễ tối hôm trước |
| 18 | Ca cũ đang chạy | Migration cục bộ giữ nguyên version, deadline, remaining, actual start, created/expires; **cần đối chiếu trên dự án thật** |

Trùng lịch hẹn được tính theo ngày giờ hẹn tuyệt đối; ca đang chạy cùng lúc được đếm riêng. Timeline phân biệt viền lịch và thanh điều trị thực tế. Bảng thời lượng kỹ thuật chỉ đọc dữ liệu danh mục, không tham gia tính trạng thái ca.

Giới hạn: Chưa có quyền SQL Editor của Supabase thật nên chưa xác minh RPC, Realtime và nhiều thiết bị trên production. Không có ca thật nào bị sửa trong quá trình kiểm thử.
