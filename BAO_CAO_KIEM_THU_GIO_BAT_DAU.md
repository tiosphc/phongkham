# Báo cáo kiểm thử logic giờ bắt đầu

Đã kiểm tra cú pháp `app.js` bằng `node --check` và `git diff --check`.
Đã đối chiếu migration: lần bắt đầu đầu tiên và lần tiếp tục đều dùng `clock_timestamp() + remaining_sec`; tạm dừng giữ remaining_sec; điều chỉnh và sửa chỉ định cập nhật deadline từ thời gian còn lại; reset xóa mốc bắt đầu; hoàn tất lưu finished_at. Migration không có UPDATE hàng loạt, giữ version và điều kiện xung đột hiện có.
Frontend: mẫu số thanh tiến độ chỉ là plannedSec; thanh Timeline điều trị kết thúc tại deadline lưu trong Supabase, không kéo tới giờ hiện tại khi quá giờ. Trục thời gian mở rộng theo mốc thực tế và lịch, tối đa 48 giờ.
Chưa thể xác nhận trên Supabase thật: thực thi SQL, đồng bộ hai thiết bị, hành vi Realtime, ca cũ đang chạy và lỗi SQL tại môi trường sản xuất. Cần kiểm tra các mục này sau khi chạy migration theo hướng dẫn.
File sửa: app.js. File mới: supabase_actual_start_deadline_upgrade.sql, HUONG_DAN_CAP_NHAT_GIO_BAT_DAU.md, BAO_CAO_KIEM_THU_GIO_BAT_DAU.md.
