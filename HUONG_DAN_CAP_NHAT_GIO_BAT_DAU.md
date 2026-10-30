# Cập nhật logic bắt đầu điều trị

1. Sao lưu định nghĩa hiện tại của `public.tbvn_change_case` trong Supabase SQL Editor.
2. Chạy toàn bộ `supabase_actual_start_deadline_upgrade.sql` trên dự án Supabase hiện tại. Đây là migration riêng, không chạy lại các file tạo bảng.
3. Kiểm tra ca đang chạy trước nâng cấp: `deadline_at` và `actual_started_at` không thay đổi vì migration không cập nhật hàng nào.
4. Triển khai ZIP Netlify mới lên site hiện tại bằng Netlify Deploys > Deploy manually. Không tạo site mới. Giữ `config.js` hiện có trong gói.
5. Tạo ca thử 30 phút: bắt đầu sớm/trễ; xác nhận deadline = giờ máy chủ lúc nhấn Bắt đầu + 30 phút. Kiểm tra trên hai thiết bị.

Migration phải chạy trước khi dùng nút Bắt đầu trên frontend mới. Không sửa Cron, RLS, Realtime hay dữ liệu ca cũ.
