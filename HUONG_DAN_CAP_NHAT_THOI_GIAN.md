# Cập nhật logic giờ bắt đầu điều trị

## Thứ tự triển khai

1. Trong Supabase, sao lưu schema và ghi lại `id`, `version`, `deadline_at`, `remaining_sec`, `actual_started_at`, `created_at`, `expires_at` của các ca đang chạy. Không sửa các hàng này.
2. Mở **Supabase SQL Editor** của đúng dự án đang dùng cho `phongkhamtbvn.netlify.app`. Chạy toàn bộ file `supabase_start_time_upgrade.sql` trong một lần. File dùng transaction, thêm cột `appointment_date`, cập nhật trigger kiểm tra dữ liệu và RPC `tbvn_change_case`, rồi yêu cầu PostgREST tải lại schema. Không xóa bảng, không cập nhật ca cũ, không đổi Cron hoặc Realtime.
3. Kiểm tra cột: `select column_name from information_schema.columns where table_schema='public' and table_name='tbvn_cases' and column_name='appointment_date';`. Kiểm tra lại các ca đang chạy: `version`, `deadline_at`, `remaining_sec`, `actual_started_at`, `created_at`, `expires_at` phải bằng giá trị trước migration.
4. Tải ZIP Netlify mới lên trang. File `config.js` trong ZIP chứa **Project URL và publishable key công khai** đọc từ website đang chạy ngày 30/10/2026. Nếu đã chuyển sang dự án Supabase khác, thay hai giá trị này trước khi triển khai. Không đưa secret/service role key vào website.
5. Tải lại trang, tạo một **ca thử mới** ở giờ hẹn gần hiện tại, kiểm tra trường hợp bắt đầu sớm và trễ, rồi xóa ca thử. Kiểm tra đồng thời trên thiết bị thứ hai.

## Quy tắc mới

- Trước khi nhấn Bắt đầu: đồng hồ đứng yên ở tổng thời lượng chỉ định; trễ giờ hẹn chỉ tạo cảnh báo `Trễ bắt đầu X phút`.
- Lần Bắt đầu đầu tiên: RPC lấy `clock_timestamp()` của Supabase. `deadline_at = max(ngày giờ hẹn, giờ bắt đầu thực tế) + planned_sec`.
- Bắt đầu sớm giữ giờ kết thúc theo lịch, nên số giây còn lại có thể lớn hơn `planned_sec`. `planned_sec` không đổi.
- Tiếp tục sau tạm dừng dùng `remaining_sec`, không áp dụng lại công thức giờ hẹn. Đặt lại xóa thời điểm bắt đầu thực tế để lần Bắt đầu tiếp theo là lần đầu mới.
- Ca cũ không có `appointment_date` tiếp tục dùng **ngày tạo ca theo múi giờ Việt Nam** làm ngày hẹn suy ra. Migration không ghi đè ngày của ca cũ. Nếu một ca cũ vốn được hẹn cho ngày khác ngày tạo, cần chọn lại ngày hẹn khi sửa ca đó vì schema cũ không lưu ngày hẹn.
- Timeline trong ngày chỉ vẽ lịch hẹn của ngày hiện tại theo giờ Việt Nam và đoạn điều trị thực tế đi qua ngày hiện tại. Viền là lịch hẹn; thanh màu là khoảng từ lúc bắt đầu thực tế đến mốc kết thúc hiện tại. Ca tạm dừng chỉ có dấu bắt đầu vì database không lưu thời điểm tạm dừng để vẽ đoạn đã điều trị chính xác.

## Nếu tạo ca báo lỗi

Chạy migration SQL trước khi tải ZIP Netlify. Bản website mới gửi `appointment_date` khi tạo ca; nếu chưa có cột, Supabase trả lỗi 42703. Lỗi chi tiết được hiển thị trên website và trong Console của trình duyệt.
